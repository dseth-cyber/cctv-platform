import { execFile } from 'node:child_process';
import { digestGet } from '../../lib/digest-fetch.js';

export type SnapshotFailure = 'auth_failed' | 'unreachable' | 'failed';

export class SnapshotError extends Error {
  constructor(readonly kind: SnapshotFailure) {
    super(kind);
  }
}

export interface SnapshotTarget {
  cameraId: string;
  /** Limits and login blocks apply per physical device: every channel of an NVR shares one host. */
  host: string;
  httpPort: number;
  /** Changes when the stored login changes, which lifts a login block. */
  loginKey: string;
  username: string | null;
  password: string | null;
  brand: string | null;
  channel: number;
  rtspUrl: string | null;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 8_000;
const RTSP_TIMEOUT_MS = 12_000;

const isJpeg = (b: Buffer) => b.length > 2 && b[0] === 0xff && b[1] === 0xd8;

/** Vendor still-image URL, or null when the brand has none known: those use a frame from the RTSP stream. */
export function httpSnapshotUrl(target: SnapshotTarget): string | null {
  const brand = (target.brand ?? '').toLowerCase();
  const base = `http://${target.host}:${target.httpPort}`;
  if (/hik|hilook/.test(brand)) return `${base}/ISAPI/Streaming/channels/${target.channel}02/picture`;
  if (/dahua|imou/.test(brand)) return `${base}/cgi-bin/snapshot.cgi?channel=${target.channel}`;
  return null;
}

/** Null means the device has no such endpoint; a wrong login or an unreachable device throws. */
async function fromHttp(url: string, target: SnapshotTarget): Promise<Buffer | null> {
  let res;
  try {
    res = await digestGet(url, target.username ?? '', target.password ?? '', { timeoutMs: HTTP_TIMEOUT_MS, maxBytes: MAX_IMAGE_BYTES });
  } catch {
    throw new SnapshotError('unreachable');
  }
  if (res.status === 401) throw new SnapshotError('auth_failed');
  return res.status === 200 && isJpeg(res.body) ? res.body : null;
}

/** One frame through ffmpeg: slower and heavier than HTTP, so the scheduler keeps few of these running. */
function fromRtsp(rtspUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffmpeg',
      ['-v', 'error', '-rtsp_transport', 'tcp', '-timeout', '8000000', '-i', rtspUrl, '-an', '-frames:v', '1', '-q:v', '6', '-f', 'image2pipe', '-c:v', 'mjpeg', 'pipe:1'],
      { timeout: RTSP_TIMEOUT_MS, maxBuffer: MAX_IMAGE_BYTES, encoding: 'buffer' },
      (err, stdout, stderr) => {
        if (!err && isJpeg(stdout)) return resolve(stdout);
        // The arguments carry the password, so the error itself is never passed on.
        const text = stderr?.toString() ?? '';
        if (/401|unauthorized/i.test(text)) return reject(new SnapshotError('auth_failed'));
        reject(new SnapshotError(/timed out|refused|unreachable|no route/i.test(text) || (err as any)?.killed ? 'unreachable' : 'failed'));
      },
    );
  });
}

export interface SnapshotResult {
  image: Buffer;
  usedRtsp: boolean;
}

export async function fetchSnapshot(target: SnapshotTarget, opts: { skipHttp?: boolean } = {}): Promise<SnapshotResult> {
  const url = opts.skipHttp ? null : httpSnapshotUrl(target);
  if (url) {
    const image = await fromHttp(url, target);
    if (image) return { image, usedRtsp: false };
    // The device answered, so whatever is wrong is with this one channel, e.g. a camera an NVR has lost.
    if (!target.rtspUrl) throw new SnapshotError('failed');
    try {
      return { image: await fromRtsp(target.rtspUrl), usedRtsp: true };
    } catch (err) {
      if (err instanceof SnapshotError && err.kind === 'unreachable') throw new SnapshotError('failed');
      throw err;
    }
  }
  if (!target.rtspUrl) throw new SnapshotError('failed');
  return { image: await fromRtsp(target.rtspUrl), usedRtsp: true };
}
