import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildChannelRtspUrl, findDeviceTemplate, getDeviceTemplates } from '../devices/devices.service.js';
import { probeTcpEndpoint } from './camera-probe.service.js';

const execFileAsync = promisify(execFile);

export interface DetectInput {
  ipAddress: string;
  username: string;
  password: string | null;
  /** 'auto' (or blank) tries every vendor pattern; a brand name is tried first. */
  brand?: string | null;
  port?: number | null;
  channel?: number | null;
}

export interface VideoInfo {
  codec: string | null;
  width: number | null;
  height: number | null;
}

export type DetectResult =
  | { status: 'found'; brand: string; port: number; channel: number; video: VideoInfo | null }
  | { status: 'unreachable'; ports: number[] }
  | { status: 'auth_failed'; port: number }
  | { status: 'not_found'; port: number; tried: string[] };

export type StreamProbe = (url: string) => Promise<{ ok: true; video: VideoInfo | null } | { ok: false; unauthorized: boolean }>;

/**
 * Opens the stream with ffprobe (RTSP DESCRIBE + SETUP) — this proves the address, path and
 * credentials together. The URL carries credentials, so it is never logged or returned.
 */
export const ffprobeStream: StreamProbe = async (url) => {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-rtsp_transport', 'tcp', '-timeout', '5000000',
      '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', url,
    ], { timeout: 10_000 });
    const s = JSON.parse(stdout)?.streams?.[0];
    return { ok: true, video: s ? { codec: s.codec_name ?? null, width: s.width ?? null, height: s.height ?? null } : null };
  } catch (err: any) {
    const text = `${err?.stderr ?? ''}`;
    return { ok: false, unauthorized: /401|unauthorized/i.test(text) };
  }
};

/**
 * Finds the vendor URL pattern a camera answers to. Ports the vendor desktop apps show (Hikvision
 * 8000, Dahua 37777, XM 34567) are SDK ports, not RTSP, so 554 is always tried as well.
 *
 * Stops after the second 401 on patterns that send the credentials as userinfo: most cameras check
 * the login before the path, so that means the username/password is wrong — and Hikvision-family
 * cameras lock the account after ~5 failed logins, so it must not keep guessing. One 401 is
 * tolerated because some RTSP servers (MediaMTX among them) also answer 401 for an unknown path.
 */
export async function detectCameraStream(
  input: DetectInput,
  probe: StreamProbe = ffprobeStream,
  // Stays under nginx's 60 s API proxy timeout even when every pattern hangs.
  budgetMs = 45_000,
): Promise<DetectResult> {
  const deadline = Date.now() + budgetMs;
  const channel = input.channel ?? 1;
  const ports = [...new Set([input.port ?? 554, 554])];

  const open: number[] = [];
  for (const port of ports) {
    if ((await probeTcpEndpoint(input.ipAddress, port, 3000)).reachable) open.push(port);
  }
  if (open.length === 0) return { status: 'unreachable', ports };
  const port = open[0];

  const hint = input.brand && input.brand !== 'auto' ? findDeviceTemplate(input.brand).brand : null;
  const order = ['Hikvision', 'Dahua', 'Uniview', 'Hanwha', 'Tiandy', 'Xiongmai', 'Generic'];
  const brands = [...new Set([...(hint ? [hint] : []), ...order])]
    .filter((b) => getDeviceTemplates().some((t) => t.brand === b));

  const tried: string[] = [];
  let unauthorized = 0;
  for (const brand of brands) {
    if (Date.now() > deadline) break;
    tried.push(brand);
    const url = buildChannelRtspUrl(brand, input.ipAddress, port, channel, input.username || null, input.password, 'main');
    const result = await probe(url);
    if (result.ok) return { status: 'found', brand, port, channel, video: result.video };
    const credsInUserinfo = !/\{username\}|\{password\}/.test(findDeviceTemplate(brand).mainStreamPattern);
    if (result.unauthorized && credsInUserinfo && input.username && ++unauthorized >= 2) return { status: 'auth_failed', port };
  }
  return { status: 'not_found', port, tried };
}
