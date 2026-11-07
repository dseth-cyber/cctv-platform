import crypto from 'node:crypto';
import net from 'node:net';
import { logger } from '../../lib/logger.js';
import type { RecorderLogin } from './hikvision-recorder.js';

// MediaMTX cannot ask a recorder for a speed, and a player keeps to the timestamps it is given. So MediaMTX pulls
// from here instead: this asks the recorder for the speed and squeezes the timestamps to match. Reached only over
// the compose network; the port is not published, and a random ticket stands in for the recorder's login.
const PORT = Number(process.env.FAST_PLAYBACK_PORT || 8559);
const HOST_FOR_MEDIAMTX = process.env.FAST_PLAYBACK_HOST || 'image-api';
const UPSTREAM_TIMEOUT_MS = 8000;
const KEEPALIVE_MS = 20_000;
/** From here on only whole pictures are sent: the browser cannot decode every frame of a recording this fast. */
const KEYFRAMES_ONLY_FROM = 8;

export const FAST_SPEEDS = [2, 5, 8, 16] as const;

export const isHevcCodecName = (codec: string) => /265|hevc/i.test(codec);

/** Whether this RTP packet belongs to a whole picture or the settings needed to decode one. */
export function carriesKeyframeData(payload: Buffer, hevc: boolean): boolean {
  if (payload.length === 0) return false;
  if (hevc) {
    const type = (payload[0] >> 1) & 0x3f;
    if (type === 48) return true; // aggregated settings
    const nal = type === 49 ? payload[2] & 0x3f : type;
    return (nal >= 16 && nal <= 21) || (nal >= 32 && nal <= 34);
  }
  const type = payload[0] & 0x1f;
  if (type === 24) return true; // aggregated settings
  const nal = type === 28 ? payload[1] & 0x1f : type;
  return nal === 5 || nal === 7 || nal === 8;
}

/** Makes a recording sent at `speed` read as one playing in real time. Sequence numbers stay unbroken when packets are left out. */
export class FastRtpRewriter {
  private first: number | null = null;
  private previous = 0;
  private elapsed = 0;
  private sequence = 0;
  private readonly hevc: boolean;
  private readonly keyframesOnly: boolean;

  constructor(private readonly speed: number, codec: string, private readonly payloadType: number | null = null) {
    this.hevc = isHevcCodecName(codec);
    this.keyframesOnly = speed >= KEYFRAMES_ONLY_FROM;
  }

  rewrite(packet: Buffer): Buffer | null {
    if (packet.length < 12) return null;
    // Recorders mix in packets of their own, which are not video and whose clock is not the video's.
    if (this.payloadType !== null && (packet[1] & 0x7f) !== this.payloadType) return null;
    const headerLength = 12 + (packet[0] & 0x0f) * 4;
    if (packet.length <= headerLength) return null;
    if (this.keyframesOnly && !carriesKeyframeData(packet.subarray(headerLength), this.hevc)) return null;

    const timestamp = packet.readUInt32BE(4);
    if (this.first === null) {
      this.first = timestamp;
    } else {
      const delta = (timestamp - this.previous) >>> 0;
      if (delta < 0x80000000) this.elapsed += delta;
    }
    this.previous = timestamp;

    const out = Buffer.from(packet);
    out.writeUInt32BE((this.first + Math.floor(this.elapsed / this.speed)) >>> 0, 4);
    out.writeUInt16BE(this.sequence, 2);
    this.sequence = (this.sequence + 1) & 0xffff;
    return out;
  }
}

/** The video part of a recorder's description. Audio has no place at these speeds. */
export function videoOnlySdp(sdp: string): { sdp: string; control: string; codec: string; payloadType: number | null } | null {
  const [session, ...medias] = sdp.split(/\r?\n(?=m=)/);
  const video = medias.find((m) => m.startsWith('m=video'));
  if (!video) return null;
  const lines = video.split(/\r?\n/).filter(Boolean);
  const control = lines.find((l) => l.startsWith('a=control:'))?.slice('a=control:'.length) ?? 'trackID=1';
  const rtpmap = video.match(/a=rtpmap:(\d+)\s+([^/\s]+)/);
  const codec = rtpmap?.[2] ?? '';
  const kept = lines.map((l) => (l.startsWith('a=control:') ? 'a=control:trackID=1' : l));
  const head = session.split(/\r?\n/).filter((l) => l && !l.startsWith('a=control:') && !l.startsWith('a=range:'));
  return { sdp: `${[...head, 'a=control:*', ...kept].join('\r\n')}\r\n`, control, codec, payloadType: rtpmap ? Number(rtpmap[1]) : null };
}

interface Ticket {
  login: RecorderLogin;
  channel: number;
  /** Recorder clock, compact form. */
  start: string;
  end: string;
  speed: number;
}

const tickets = new Map<string, Ticket>();
let server: net.Server | null = null;

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

function digestHeader(method: string, uri: string, challenge: string, login: RecorderLogin): string {
  const get = (k: string) => (challenge.match(new RegExp(`${k}="([^"]*)"`)) ?? [])[1];
  const realm = get('realm');
  const nonce = get('nonce');
  const ha1 = md5(`${login.username}:${realm}:${login.password}`);
  const ha2 = md5(`${method}:${uri}`);
  const base = `Digest username="${login.username}", realm="${realm}", nonce="${nonce}", uri="${uri}"`;
  if (/qop=/.test(challenge)) {
    const cnonce = crypto.randomBytes(8).toString('hex');
    return `${base}, qop=auth, nc=00000001, cnonce="${cnonce}", response="${md5(`${ha1}:${nonce}:00000001:${cnonce}:auth:${ha2}`)}"`;
  }
  return `${base}, response="${md5(`${ha1}:${nonce}:${ha2}`)}"`;
}

interface RtspAnswer {
  status: number;
  head: string;
  body: string;
}

/** Reads one socket carrying RTSP answers or requests with interleaved binary frames between them. */
function rtspReader(onMessage: (text: { head: string; body: string }) => void, onFrame: (channel: number, data: Buffer) => void) {
  let buffer: Buffer = Buffer.alloc(0);
  return (chunk: Buffer) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
    for (;;) {
      if (buffer.length === 0) return;
      if (buffer[0] === 0x24) {
        if (buffer.length < 4) return;
        const length = buffer.readUInt16BE(2);
        if (buffer.length < 4 + length) return;
        onFrame(buffer[1], buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
        continue;
      }
      const headEnd = buffer.indexOf('\r\n\r\n');
      if (headEnd === -1) return;
      const head = buffer.subarray(0, headEnd).toString();
      const length = Number((head.match(/content-length:\s*(\d+)/i) ?? [])[1] ?? 0);
      if (buffer.length < headEnd + 4 + length) return;
      const body = buffer.subarray(headEnd + 4, headEnd + 4 + length).toString();
      buffer = buffer.subarray(headEnd + 4 + length);
      onMessage({ head, body });
    }
  };
}

/** The connection to the recorder. Holds its login, so nothing from here is ever logged. */
class Recorder {
  private socket: net.Socket;
  private cseq = 0;
  private session: string | null = null;
  private challenge: string | null = null;
  private waiting: ((answer: RtspAnswer) => void) | null = null;
  private keepalive: NodeJS.Timeout | null = null;
  readonly uri: string;

  constructor(private readonly ticket: Ticket, onFrame: (channel: number, data: Buffer) => void, onClose: () => void) {
    const { login, channel, start, end } = ticket;
    this.uri = `rtsp://${login.host}:${login.rtspPort}/Streaming/tracks/${channel}01?starttime=${start}&endtime=${end}`;
    this.socket = net.connect(login.rtspPort, login.host);
    this.socket.setNoDelay(true);
    const read = rtspReader(({ head, body }) => {
      const waiting = this.waiting;
      this.waiting = null;
      waiting?.({ status: Number(head.split(' ')[1]), head, body });
    }, onFrame);
    this.socket.on('data', read);
    this.socket.on('error', () => this.socket.destroy());
    this.socket.on('close', onClose);
  }

  pause() {
    this.socket.pause();
  }

  resume() {
    this.socket.resume();
  }

  send(method: string, target: string, headers: Record<string, string> = {}): Promise<RtspAnswer> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`The recorder did not answer ${method}`)), UPSTREAM_TIMEOUT_MS);
      const go = (authorization: string | null) => {
        this.cseq += 1;
        const lines = [
          `${method} ${target} RTSP/1.0`,
          `CSeq: ${this.cseq}`,
          'User-Agent: cctv-fast-playback',
          ...(this.session ? [`Session: ${this.session}`] : []),
          ...(authorization ? [`Authorization: ${authorization}`] : []),
          ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
        ];
        this.waiting = (answer) => {
          const offered = answer.head.match(/www-authenticate:\s*(Digest[^\r\n]*)/i);
          if (answer.status === 401 && offered && !authorization) {
            this.challenge = offered[1];
            go(digestHeader(method, target, this.challenge, this.ticket.login));
            return;
          }
          clearTimeout(timer);
          resolve(answer);
        };
        this.socket.write(`${lines.join('\r\n')}\r\n\r\n`);
      };
      go(this.challenge ? digestHeader(method, target, this.challenge, this.ticket.login) : null);
    });
  }

  async describe() {
    const answer = await this.send('DESCRIBE', this.uri, { Accept: 'application/sdp' });
    if (answer.status !== 200) throw new Error(`The recorder answered DESCRIBE with ${answer.status}`);
    const video = videoOnlySdp(answer.body);
    if (!video) throw new Error('The recorder described no video');
    return video;
  }

  async setup(control: string) {
    const target = control.startsWith('rtsp://') ? control : `${this.uri.split('?')[0]}/${control}`;
    const answer = await this.send('SETUP', target, { Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1' });
    if (answer.status !== 200) throw new Error(`The recorder answered SETUP with ${answer.status}`);
    this.session = (answer.head.match(/session:\s*([^;\r\n]+)/i) ?? [])[1]?.trim() ?? null;
  }

  async play() {
    const answer = await this.send('PLAY', this.uri, { Range: 'npt=0-', Scale: this.ticket.speed.toFixed(3) });
    if (answer.status !== 200) throw new Error(`The recorder answered PLAY with ${answer.status}`);
    this.keepalive = setInterval(() => void this.send('GET_PARAMETER', this.uri).catch(() => this.socket.destroy()), KEEPALIVE_MS);
    this.keepalive.unref();
  }

  close() {
    if (this.keepalive) clearInterval(this.keepalive);
    this.keepalive = null;
    const closing = this.session ? this.send('TEARDOWN', this.uri).catch(() => {}) : Promise.resolve();
    void closing.finally(() => this.socket.destroy());
    setTimeout(() => this.socket.destroy(), 1000).unref();
  }
}

/** One MediaMTX pull. It speaks to this as if this were the recorder. */
function serve(client: net.Socket) {
  client.setNoDelay(true);
  let recorder: Recorder | null = null;
  let rewriter: FastRtpRewriter | null = null;
  let codec = '';
  let payloadType: number | null = null;
  let control = '';
  let clientChannel = 0;
  const sessionId = crypto.randomBytes(8).toString('hex');
  let queue = Promise.resolve();

  const answer = (cseq: string, status = '200 OK', extra: string[] = [], body = '') => {
    const lines = [`RTSP/1.0 ${status}`, `CSeq: ${cseq}`, ...extra, ...(body ? [`Content-Length: ${Buffer.byteLength(body)}`] : [])];
    client.write(`${lines.join('\r\n')}\r\n\r\n${body}`);
  };

  const onRecorderFrame = (channel: number, data: Buffer) => {
    // The recorder's clock reports describe times this no longer sends, so only video goes on.
    if (channel !== 0 || !rewriter) return;
    const out = rewriter.rewrite(data);
    if (!out) return;
    const frame = Buffer.alloc(4 + out.length);
    frame[0] = 0x24;
    frame[1] = clientChannel;
    frame.writeUInt16BE(out.length, 2);
    out.copy(frame, 4);
    if (!client.write(frame)) recorder?.pause();
  };
  client.on('drain', () => recorder?.resume());

  const handle = async (head: string) => {
    const [requestLine] = head.split('\r\n');
    const [method, url] = requestLine.split(' ');
    const cseq = (head.match(/cseq:\s*(\d+)/i) ?? [])[1] ?? '0';
    const ticketId = url?.split('/')[3]?.split('?')[0] ?? '';
    const ticket = tickets.get(ticketId);
    if (!ticket) return answer(cseq, '404 Not Found');
    try {
      switch (method) {
        case 'OPTIONS':
          return answer(cseq, '200 OK', ['Public: OPTIONS, DESCRIBE, SETUP, PLAY, GET_PARAMETER, TEARDOWN']);
        case 'DESCRIBE': {
          recorder = new Recorder(ticket, onRecorderFrame, () => client.destroy());
          const video = await recorder.describe();
          control = video.control;
          codec = video.codec;
          payloadType = video.payloadType;
          return answer(cseq, '200 OK', ['Content-Type: application/sdp', `Content-Base: rtsp://${HOST_FOR_MEDIAMTX}:${PORT}/${ticketId}/`], video.sdp);
        }
        case 'SETUP': {
          if (!recorder) return answer(cseq, '455 Method Not Valid in This State');
          clientChannel = Number((head.match(/interleaved=(\d+)/i) ?? [])[1] ?? 0);
          await recorder.setup(control);
          return answer(cseq, '200 OK', [`Transport: RTP/AVP/TCP;unicast;interleaved=${clientChannel}-${clientChannel + 1}`, `Session: ${sessionId};timeout=60`]);
        }
        case 'PLAY': {
          if (!recorder) return answer(cseq, '455 Method Not Valid in This State');
          rewriter = new FastRtpRewriter(ticket.speed, codec, payloadType);
          await recorder.play();
          return answer(cseq, '200 OK', [`Session: ${sessionId}`, 'Range: npt=0.000-']);
        }
        case 'TEARDOWN':
          answer(cseq, '200 OK', [`Session: ${sessionId}`]);
          client.end();
          return undefined;
        default:
          return answer(cseq, '200 OK', [`Session: ${sessionId}`]);
      }
    } catch (err) {
      logger.warn({ reason: err instanceof Error ? err.message : 'failed' }, 'Fast playback could not reach the recorder');
      answer(cseq, '502 Bad Gateway');
      client.destroy();
      return undefined;
    }
  };

  // Requests run one at a time, in order. What MediaMTX sends back about the video is not needed.
  client.on('data', rtspReader(({ head }) => {
    queue = queue.then(() => handle(head));
  }, () => {}));
  client.on('error', () => client.destroy());
  client.on('close', () => recorder?.close());
}

export function startFastPlaybackProxy() {
  if (server) return;
  server = net.createServer(serve);
  server.on('error', (err) => logger.error({ reason: err.message }, 'Fast playback proxy failed'));
  server.listen(PORT, '0.0.0.0');
}

export function stopFastPlaybackProxy() {
  server?.close();
  server = null;
  tickets.clear();
}

/** A source for MediaMTX to pull. Holds no login: the ticket only means something to this process. */
export function openFastSource(ticket: Ticket): { id: string; url: string } {
  const id = crypto.randomBytes(16).toString('hex');
  tickets.set(id, ticket);
  return { id, url: `rtsp://${HOST_FOR_MEDIAMTX}:${PORT}/${id}` };
}

export function closeFastSource(id: string | null | undefined) {
  if (id) tickets.delete(id);
}
