import crypto from 'node:crypto';
import { digestGet, digestPost } from '../../lib/digest-fetch.js';

/**
 * What a Hikvision DVR/NVR offers for its own recordings. Everything here only reads: nothing changes a
 * setting on the device. Measured on a real DS-7208HQHI-K1.
 *
 * Times are "wall clock" strings (YYYY-MM-DDTHH:mm:ss) read off the recorder's own clock, the same time that
 * is burned into its picture. The recorder writes them with a trailing Z, but that Z does not mean UTC.
 */
export interface RecorderLogin {
  host: string;
  httpPort: number;
  rtspPort: number;
  username: string;
  password: string;
}

export interface WallRange {
  start: string;
  end: string;
}

export type RecorderFailure = 'login' | 'unreachable';

export class RecorderError extends Error {
  constructor(readonly kind: RecorderFailure) {
    super(kind);
  }
}

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 2_000_000;
const PAGE_SIZE = 40;
const MAX_PAGES = 12;

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`))?.[1]?.trim();
const wallMs = (wall: string) => new Date(`${wall}Z`).getTime();
const msWall = (ms: number) => new Date(ms).toISOString().slice(0, 19);

export const addSeconds = (wall: string, seconds: number) => msWall(wallMs(wall) + seconds * 1000);
export const secondsBetween = (from: string, to: string) => (wallMs(to) - wallMs(from)) / 1000;
/** The form RTSP playback asks for: 20261106T093003Z */
export const toCompact = (wall: string) => `${wall.replace(/[-:]/g, '')}Z`;

export interface RecorderClock {
  /** The recorder's clock now. */
  deviceTime: string;
  /** Positive: the recorder is ahead of this server. */
  driftSeconds: number;
}

export function parseClock(xml: string, nowMs: number): RecorderClock | null {
  const local = tag(xml, 'localTime');
  const at = local ? new Date(local).getTime() : NaN;
  if (!local || Number.isNaN(at)) return null;
  return { deviceTime: local.slice(0, 19), driftSeconds: Math.round((at - nowMs) / 1000) };
}

export function parseSearch(xml: string): { items: WallRange[]; more: boolean } {
  const items = [...xml.matchAll(/<searchMatchItem>[\s\S]*?<\/searchMatchItem>/g)].flatMap((m) => {
    const start = tag(m[0], 'startTime');
    const end = tag(m[0], 'endTime');
    return start && end ? [{ start: start.slice(0, 19), end: end.slice(0, 19) }] : [];
  });
  return { items, more: /^more$/i.test(tag(xml, 'responseStatusStrg') ?? '') };
}

/** Files of one recording touch each other; a person wants to see one continuous block. */
export function mergeRanges(items: WallRange[], maxGapSeconds = 5): WallRange[] {
  const merged: WallRange[] = [];
  for (const item of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
    const last = merged[merged.length - 1];
    if (last && secondsBetween(last.end, item.start) <= maxGapSeconds) {
      if (item.end > last.end) last.end = item.end;
    } else {
      merged.push({ ...item });
    }
  }
  return merged;
}

export function clipRanges(items: WallRange[], from: string, to: string): WallRange[] {
  return items
    .map((r) => ({ start: r.start < from ? from : r.start, end: r.end > to ? to : r.end }))
    .filter((r) => r.end > r.start);
}

function checked<T extends { status: number }>(res: T): T {
  if (res.status === 401) throw new RecorderError('login');
  return res;
}

async function get(login: RecorderLogin, path: string) {
  try {
    return checked(await digestGet(`http://${login.host}:${login.httpPort}${path}`, login.username, login.password, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES }));
  } catch (err) {
    throw err instanceof RecorderError ? err : new RecorderError('unreachable');
  }
}

export async function readClock(login: RecorderLogin): Promise<RecorderClock | null> {
  const res = await get(login, '/ISAPI/System/time');
  return res.status === 200 ? parseClock(res.body.toString(), Date.now()) : null;
}

/** The main stream's codec, or null when the recorder does not say. */
export async function readMainCodec(login: RecorderLogin, channel: number): Promise<string | null> {
  const res = await get(login, `/ISAPI/Streaming/channels/${channel}01`);
  return res.status === 200 ? tag(res.body.toString(), 'videoCodecType') ?? null : null;
}

export const isHevc = (codec: string | null) => !!codec && /265|hevc/i.test(codec);

/** Recordings of one channel in a period, merged. `complete` is false when the recorder had more than we asked for. */
export async function searchRecordings(login: RecorderLogin, channel: number, from: string, to: string): Promise<{ ranges: WallRange[]; complete: boolean }> {
  const url = `http://${login.host}:${login.httpPort}/ISAPI/ContentMgmt/search`;
  const searchId = crypto.randomUUID();
  const found: WallRange[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = '<?xml version="1.0" encoding="UTF-8"?><CMSearchDescription>'
      + `<searchID>${searchId}</searchID><trackIDList><trackID>${channel}01</trackID></trackIDList>`
      + `<timeSpanList><timeSpan><startTime>${from}Z</startTime><endTime>${to}Z</endTime></timeSpan></timeSpanList>`
      + `<maxResults>${PAGE_SIZE}</maxResults><searchResultPostion>${page * PAGE_SIZE}</searchResultPostion>`
      + '<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList></CMSearchDescription>';
    let res;
    try {
      res = checked(await digestPost(url, login.username, login.password, body, { timeoutMs: TIMEOUT_MS, maxBytes: MAX_BYTES }));
    } catch (err) {
      throw err instanceof RecorderError ? err : new RecorderError('unreachable');
    }
    if (res.status !== 200) throw new RecorderError('unreachable');
    const { items, more } = parseSearch(res.body.toString());
    found.push(...items);
    if (!more) return { ranges: mergeRanges(found), complete: true };
  }
  return { ranges: mergeRanges(found), complete: false };
}

/** Holds the login, so it must never reach a log or an API answer. */
export function playbackUrl(login: RecorderLogin, channel: number, start: string, end: string): string {
  // encodeURIComponent leaves ' ( ) * ! alone; encoded too so the URL can sit inside a command line.
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `rtsp://${enc(login.username)}:${enc(login.password)}@${login.host}:${login.rtspPort}/Streaming/tracks/${channel}01?starttime=${toCompact(start)}&endtime=${toCompact(end)}`;
}
