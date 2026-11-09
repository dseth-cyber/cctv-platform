import dgram from 'node:dgram';
import { isIP } from 'node:net';
import { digestGet, digestPut } from '../../lib/digest-fetch.js';
import { decrypt } from '../../lib/encryption.js';
import { getPrisma } from '../../lib/prisma.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { isRecorderBrand } from './device-health.service.js';

/**
 * Points a Hikvision recorder at our NTP server, so it keeps its own clock right from then on.
 * This is the one place the system changes a setting on a recorder, and only its clock source, with the
 * owner's permission (2026-11-09). Nothing runs it on a timer: a person presses the button for each recorder.
 */

/** Bangkok, written the way Hikvision writes it (the sign is the other way round from UTC+7). */
export const RECORDER_TIME_ZONE = 'CST-7:00:00';
/** Further than this from the NTP server, this server's own clock is wrong and nothing is sent. */
const MAX_SERVER_OFFSET_MS = 5_000;
const TIMEOUT_MS = 8_000;
const NTP_EPOCH_OFFSET_S = 2_208_988_800;

export type NtpRefusal = 'NTP_NOT_SET' | 'NOT_SUPPORTED' | 'NTP_SERVER_UNREACHABLE' | 'NTP_SERVER_NOT_SYNCED' | 'SERVER_CLOCK_OFF' | 'RECORDER_REFUSED' | 'RECORDER_UNREACHABLE';

export class RecorderNtpError extends Error {
  constructor(readonly code: NtpRefusal, readonly details: Record<string, unknown> = {}) {
    super(code);
  }
}

export interface NtpAnswer {
  stratum: number;
  leap: number;
  /** How far the NTP server's time is from this server's clock. */
  offsetMs: number;
}

/** Reads the parts of an NTP reply we need. t0 and t3: this server's clock when asking and when the reply came. */
export function parseNtpReply(reply: Buffer, t0: number, t3: number): NtpAnswer | null {
  if (reply.length < 48) return null;
  const seconds = reply.readUInt32BE(40) - NTP_EPOCH_OFFSET_S;
  const fraction = reply.readUInt32BE(44) / 2 ** 32;
  const serverMs = (seconds + fraction) * 1000;
  return { leap: reply[0] >> 6, stratum: reply[1], offsetMs: Math.round(serverMs - (t0 + t3) / 2) };
}

export function askNtp(host: string, port = 123, timeoutMs = 3000): Promise<NtpAnswer | null> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket(isIP(host) === 6 ? 'udp6' : 'udp4');
    const done = (answer: NtpAnswer | null) => {
      clearTimeout(timer);
      socket.close();
      resolve(answer);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    const request = Buffer.alloc(48);
    request[0] = 0x23; // version 4, client
    let t0 = 0;
    socket.on('message', (msg) => done(parseNtpReply(msg, t0, Date.now())));
    socket.on('error', () => done(null));
    t0 = Date.now();
    socket.send(request, port, host, (err) => { if (err) done(null); });
  });
}

/**
 * Whether the NTP server is fit to hand out time. Stratum 10 and up is a server keeping time on its own clock
 * (it still keeps the recorders in step with each other, but nobody has checked it against real time).
 */
export function ntpRefusal(answer: NtpAnswer | null): NtpRefusal | null {
  if (!answer) return 'NTP_SERVER_UNREACHABLE';
  if (answer.leap === 3 || answer.stratum < 1 || answer.stratum >= 10) return 'NTP_SERVER_NOT_SYNCED';
  if (Math.abs(answer.offsetMs) > MAX_SERVER_OFFSET_MS) return 'SERVER_CLOCK_OFF';
  return null;
}

const NS = 'version="1.0" xmlns="http://www.hikvision.com/ver20/XMLSchema"';
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1]?.trim() ?? null;
const escapeXml = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function ntpServerXml(address: string, minutes: number): string {
  const where = isIP(address)
    ? `<addressingFormatType>ipaddress</addressingFormatType><ipAddress>${escapeXml(address)}</ipAddress>`
    : `<addressingFormatType>hostname</addressingFormatType><hostName>${escapeXml(address)}</hostName>`;
  return `<?xml version="1.0" encoding="UTF-8"?><NTPServer ${NS}><id>1</id>${where}<portNo>123</portNo><synchronizeInterval>${Math.round(minutes)}</synchronizeInterval></NTPServer>`;
}

/** No localTime: in NTP mode the recorder takes it from the server, and sending one would set the clock by hand. */
export function ntpTimeXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Time ${NS}><timeMode>NTP</timeMode><timeZone>${RECORDER_TIME_ZONE}</timeZone></Time>`;
}

/** What a recorder's clock settings say, for the audit log and to undo by hand. */
export function readTimeSettings(timeXml: string, ntpXml: string) {
  return {
    mode: tag(timeXml, 'timeMode'),
    timeZone: tag(timeXml, 'timeZone'),
    localTime: tag(timeXml, 'localTime'),
    ntpServer: tag(ntpXml, 'ipAddress') || tag(ntpXml, 'hostName') || null,
    ntpMinutes: Number(tag(ntpXml, 'synchronizeInterval')) || null,
  };
}

/** A recorder answers a change with a ResponseStatus: 1 is done, 7 is done once it restarts. */
export function recorderAccepted(status: number, body: string): boolean {
  if (status !== 200) return false;
  const code = tag(body, 'statusCode');
  return code === null || code === '1' || code === '7';
}

export async function pointRecorderAtNtp(deviceId: string) {
  const configs = await getAllConfigs();
  const server = String(configs.device_ntp_server?.value ?? '').trim();
  const minutes = Number(configs.device_ntp_sync_minutes?.value ?? 60);
  if (!server) throw new RecorderNtpError('NTP_NOT_SET');

  const device = await getPrisma().device.findUnique({ where: { id: deviceId } });
  if (!device) return null;
  if (!isRecorderBrand(device.brand) || !device.passwordEncrypted) throw new RecorderNtpError('NOT_SUPPORTED');

  // The recorders will believe this server, so check it first: it must answer and agree with real time.
  const answer = await askNtp(server);
  const refusal = ntpRefusal(answer);
  if (refusal) throw new RecorderNtpError(refusal, { server, stratum: answer?.stratum ?? null, offsetMs: answer?.offsetMs ?? null });

  const base = `http://${device.ipAddress}:${device.httpPort ?? 80}`;
  const password = decrypt(device.passwordEncrypted);
  const username = device.username ?? '';
  const opts = { timeoutMs: TIMEOUT_MS, maxBytes: 200_000 };
  const call = async <T>(task: () => Promise<T>) => {
    try {
      return await task();
    } catch {
      throw new RecorderNtpError('RECORDER_UNREACHABLE');
    }
  };
  const read = async () => {
    const [time, ntp] = await call(() => Promise.all([digestGet(`${base}/ISAPI/System/time`, username, password, opts), digestGet(`${base}/ISAPI/System/time/ntpServers/1`, username, password, opts)]));
    if (time.status !== 200 || ntp.status !== 200) throw new RecorderNtpError('RECORDER_REFUSED', { step: 'read', status: time.status === 200 ? ntp.status : time.status });
    return readTimeSettings(time.body.toString(), ntp.body.toString());
  };

  const before = await read();
  // The server first, then the mode: should the second step fail, the recorder still keeps its own time.
  const putServer = await call(() => digestPut(`${base}/ISAPI/System/time/ntpServers/1`, username, password, ntpServerXml(server, minutes), opts));
  if (!recorderAccepted(putServer.status, putServer.body.toString())) {
    throw new RecorderNtpError('RECORDER_REFUSED', { step: 'ntp_server', status: putServer.status, before });
  }
  const putMode = await call(() => digestPut(`${base}/ISAPI/System/time`, username, password, ntpTimeXml(), opts));
  if (!recorderAccepted(putMode.status, putMode.body.toString())) {
    throw new RecorderNtpError('RECORDER_REFUSED', { step: 'time_mode', status: putMode.status, before });
  }
  const after = await read();
  return { device: { id: device.id, name: device.name }, server, minutes, serverCheck: answer, before, after };
}
