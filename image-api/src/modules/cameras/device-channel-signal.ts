import { digestGet } from '../../lib/digest-fetch.js';
import { decrypt } from '../../lib/encryption.js';
import { logger } from '../../lib/logger.js';
import { parseLoginLock } from '../device-playback/hikvision-recorder.js';

/** no_signal: an analog input with no picture. recorder_lost_camera: an NVR cannot reach its IP camera. */
export type ChannelProblem = 'no_signal' | 'recorder_lost_camera';

export interface SignalDevice {
  id: string;
  brand: string | null;
  ipAddress: string | null;
  httpPort: number | null;
  username: string | null;
  passwordEncrypted: string | null;
}

const TIMEOUT_MS = 5_000;
const MAX_BYTES = 500_000;
const LOGIN_BLOCK_MS = 30 * 60_000;
const AT_ONCE = 8;

/** A wrong login is not retried until it changes or the block ends, so this check cannot lock the account. */
const loginBlockedUntil = new Map<string, number>();

/** The latest answer from each recorder. Forgotten as soon as a recorder cannot answer. */
const latest = new Map<string, Map<number, ChannelProblem>>();

/**
 * A recorder streams its "NO VIDEO" picture to anyone who opens the channel, so a stream that starts
 * is no proof the camera came back.
 */
export function isKnownNoSignal(deviceId: string | null | undefined, channel: number | null | undefined): boolean {
  return !!deviceId && channel != null && !!latest.get(deviceId)?.has(channel);
}

const blocks = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}[ >][\\s\\S]*?</${name}>`, 'g'))].map((m) => m[0]);
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1]?.trim();

/** Analog inputs: the recorder describes a channel with no camera picture as resDesc "NO VIDEO". */
export function parseAnalogNoVideo(xml: string): number[] {
  return blocks(xml, 'VideoInputChannel')
    .filter((b) => /^no\s*video$/i.test(tag(b, 'resDesc') ?? ''))
    .map((b) => Number(tag(b, 'id')))
    .filter(Number.isInteger);
}

/** IP channels of an NVR. */
export function parseIpChannelsOffline(xml: string): number[] {
  return blocks(xml, 'InputProxyChannelStatus')
    .filter((b) => tag(b, 'online') === 'false')
    .map((b) => Number(tag(b, 'id')))
    .filter(Number.isInteger);
}

async function readDevice(device: SignalDevice): Promise<Map<number, ChannelProblem> | null> {
  const key = `${device.id}:${device.passwordEncrypted}`;
  if ((loginBlockedUntil.get(key) ?? 0) > Date.now()) return null;

  const password = decrypt(device.passwordEncrypted as string);
  const base = `http://${device.ipAddress}:${device.httpPort ?? 80}`;
  const found = new Map<number, ChannelProblem>();
  let answered = false;
  for (const [path, parse, problem] of [
    ['/ISAPI/System/Video/inputs/channels', parseAnalogNoVideo, 'no_signal'],
    ['/ISAPI/ContentMgmt/InputProxy/channels/status', parseIpChannelsOffline, 'recorder_lost_camera'],
  ] as const) {
    const res = await digestGet(`${base}${path}`, device.username ?? '', password, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES });
    if (res.status === 401) {
      const unlockSeconds = parseLoginLock(res.body.toString());
      loginBlockedUntil.set(key, Date.now() + (unlockSeconds === null ? LOGIN_BLOCK_MS : Math.max(unlockSeconds * 1000 + 60_000, 60_000)));
      logger.warn({ deviceId: device.id }, 'Recorder refused the login: channel signal check paused');
      return null;
    }
    if (res.status === 200) {
      answered = true;
      parse(res.body.toString()).forEach((ch) => found.set(ch, problem));
    }
  }
  return answered ? found : null;
}

/**
 * Channels each recorder itself reports as having no picture. A recorder that cannot be asked is simply
 * left out: "not known" must never turn a working camera offline. Only Hikvision is known; other brands
 * keep the network check alone.
 */
export async function readChannelsWithoutSignal(devices: Array<SignalDevice | null | undefined>): Promise<Map<string, Map<number, ChannelProblem>>> {
  const unique = new Map<string, SignalDevice>();
  for (const d of devices) {
    if (d?.ipAddress && d.passwordEncrypted && /hik|hilook/i.test(d.brand ?? '')) unique.set(d.id, d);
  }
  const queue = [...unique.values()];
  const result = new Map<string, Map<number, ChannelProblem>>();
  const worker = async () => {
    for (let d = queue.shift(); d; d = queue.shift()) {
      try {
        const channels = await readDevice(d);
        if (channels) result.set(d.id, channels);
        if (channels) latest.set(d.id, channels);
        else latest.delete(d.id);
      } catch (err) {
        latest.delete(d.id);
        logger.debug({ deviceId: d.id, err: err instanceof Error ? err.message : String(err) }, 'Channel signal check failed');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker));
  return result;
}
