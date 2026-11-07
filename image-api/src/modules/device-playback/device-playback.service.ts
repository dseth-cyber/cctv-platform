import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { decrypt } from '../../lib/encryption.js';
import { logger } from '../../lib/logger.js';
import { getPrisma } from '../../lib/prisma.js';
import { MediaMtxService, PLAYBACK_PATH_PREFIX } from '../media/mediamtx.service.js';
import { RecordingsService } from '../recordings/recordings.service.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import {
  addSeconds,
  clipRanges,
  isHevc,
  playbackUrl,
  readClock,
  readMainCodec,
  RecorderError,
  searchRecordings,
  secondsBetween,
  toCompact,
  type RecorderClock,
  type RecorderLogin,
  type WallRange,
} from './hikvision-recorder.js';

import { closeFastSource, openFastSource, startFastPlaybackProxy, stopFastPlaybackProxy } from './fast-playback-proxy.js';

export type PlaybackProblem =
  | 'NOT_SUPPORTED'
  | 'DEVICE_LOGIN'
  | 'DEVICE_UNREACHABLE'
  | 'NO_RECORDING'
  | 'LIMIT_USER'
  | 'LIMIT_DEVICE'
  | 'LIMIT_TOTAL'
  | 'LIMIT_LIVE'
  | 'TRANSCODE_LIMIT'
  | 'CLIP_LIMIT'
  | 'CLIP_TOO_LONG'
  | 'DISK_FULL'
  | 'MEDIA_SERVER';

export class PlaybackError extends Error {
  constructor(readonly code: PlaybackProblem, readonly statusCode: number, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}

export interface PlaybackLimits {
  perUser: number;
  perDevice: number;
  total: number;
  transcodes: number;
  clipMinutes: number;
  liveTotal: number;
}

interface Session {
  id: string;
  userId: string;
  cameraId: string;
  deviceId: string;
  path: string | null;
  transcoded: boolean;
  speed: number;
  fastSourceId: string | null;
  createdAt: number;
  lifetimeMs: number;
}

const SESSION_WINDOW_SECONDS = 30 * 60;
const IDLE_MS = 45_000;
const SWEEP_MS = 15_000;
const TIMELINE_CACHE_MS = 30_000;
const LOGIN_BLOCK_MS = 30 * 60_000;
const MAX_CLIPS_AT_ONCE = 2;
/** No bitrate is known ahead of a clip: assume this much so the disk check can only err on the safe side. */
const CLIP_BYTES_PER_SECOND = 1_000_000;
const CLIP_FILE_PREFIX = 'dvrclip_';

const sessions = new Map<string, Session>();
const runningClips = new Map<string, string>(); // clip id -> device id
const clipJobs = new Map<string, { controller: AbortController; finished: Promise<void> }>();
const timelineCache = new Map<string, { at: number; value: unknown }>();
const loginBlockedUntil = new Map<string, number>();
let sweeper: NodeJS.Timeout | null = null;

/** The first limit a new session would break, or null. Pure so the ceilings can be tested on their own. */
export function checkSessionLimits(
  open: Array<Pick<Session, 'userId' | 'deviceId' | 'transcoded'>>,
  next: { userId: string; deviceId: string },
  limits: Pick<PlaybackLimits, 'perUser' | 'perDevice' | 'total'>,
  clipsOnDevice = 0,
): PlaybackProblem | null {
  if (open.length >= limits.total) return 'LIMIT_TOTAL';
  if (open.filter((s) => s.deviceId === next.deviceId).length + clipsOnDevice >= limits.perDevice) return 'LIMIT_DEVICE';
  if (open.filter((s) => s.userId === next.userId).length >= limits.perUser) return 'LIMIT_USER';
  return null;
}

/** Each 720p transcode took about half a core on the real DVR's H.265, so a setting cannot exceed one per two cores. */
export function effectiveTranscodeLimit(configured: number, cpuCount: number): number {
  return Math.min(configured, Math.max(1, Math.floor(cpuCount / 2)));
}

async function readLimits(): Promise<PlaybackLimits> {
  const c = await getAllConfigs();
  const num = (key: string, fallback: number) => Number(c[key]?.value ?? fallback);
  return {
    perUser: num('playback_max_sessions_per_user', 2),
    perDevice: num('playback_max_sessions_per_device', 2),
    total: num('playback_max_sessions_total', 16),
    transcodes: effectiveTranscodeLimit(num('playback_max_transcodes', 2), os.cpus().length),
    clipMinutes: num('playback_clip_max_minutes', 30),
    liveTotal: num('live_max_streams_total', 64),
  };
}

interface Target {
  cameraId: string;
  cameraName: string;
  deviceId: string;
  channel: number;
  login: RecorderLogin;
  loginKey: string;
}

/** Null when this camera's recordings cannot be read from its recorder (only Hikvision is known so far). */
async function findTarget(cameraId: string): Promise<Target | null> {
  const camera = await getPrisma().camera.findUnique({
    where: { id: cameraId },
    select: {
      id: true,
      name: true,
      channelNumber: true,
      device: { select: { id: true, brand: true, ipAddress: true, httpPort: true, rtspPort: true, username: true, passwordEncrypted: true } },
    },
  });
  const d = camera?.device;
  if (!camera || !d?.ipAddress || !d.passwordEncrypted || camera.channelNumber === null || !/hik|hilook/i.test(d.brand ?? '')) return null;
  return {
    cameraId: camera.id,
    cameraName: camera.name,
    deviceId: d.id,
    channel: camera.channelNumber,
    login: { host: d.ipAddress, httpPort: d.httpPort ?? 80, rtspPort: d.rtspPort, username: d.username ?? '', password: decrypt(d.passwordEncrypted) },
    loginKey: `${d.id}:${d.passwordEncrypted}`,
  };
}

/** A wrong login is not repeated: a recorder locks its account after a few. */
async function askRecorder<T>(target: Target, ask: () => Promise<T>): Promise<T> {
  if ((loginBlockedUntil.get(target.loginKey) ?? 0) > Date.now()) {
    throw new PlaybackError('DEVICE_LOGIN', 409, 'The recorder refused its login; update it on the device page');
  }
  try {
    return await ask();
  } catch (err) {
    if (err instanceof RecorderError && err.kind === 'login') {
      loginBlockedUntil.set(target.loginKey, Date.now() + LOGIN_BLOCK_MS);
      throw new PlaybackError('DEVICE_LOGIN', 409, 'The recorder refused its login; update it on the device page');
    }
    if (err instanceof RecorderError) throw new PlaybackError('DEVICE_UNREACHABLE', 503, 'The recorder cannot be reached');
    throw err;
  }
}

/**
 * A recorder's times are its own wall clock. The playback page draws Bangkok wall time, so expressing them
 * as Bangkok instants puts every block where the recorder's own picture says it is.
 */
const wallToIso = (wall: string) => new Date(`${wall}+07:00`).toISOString();
const shiftIso = (iso: string, seconds: number) => new Date(new Date(iso).getTime() + seconds * 1000).toISOString();

export async function getDeviceTimeline(cameraId: string, date: string) {
  const target = await findTarget(cameraId);
  if (!target) return { supported: false as const };

  const cacheKey = `${cameraId}|${date}`;
  const cached = timelineCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TIMELINE_CACHE_MS) return cached.value;

  const from = `${date}T00:00:00`;
  const to = `${date}T23:59:59`;
  const { clock, found } = await askRecorder(target, async () => ({
    clock: await readClock(target.login),
    found: await searchRecordings(target.login, target.channel, from, to),
  }));
  const ranges = clipRanges(found.ranges, from, to);
  const drift = clock?.driftSeconds ?? 0;

  // Incidents carry server time; on this timeline they belong at the time the recorder's clock showed.
  let incidents: any[] = [];
  try {
    const server: any = await RecordingsService.getTimelineAvailability(cameraId, date);
    incidents = (server?.incidents ?? []).map((i: any) => ({ ...i, startTime: shiftIso(i.startTime, drift), endTime: shiftIso(i.endTime, drift) }));
  } catch (err) {
    logger.debug({ cameraId, err: err instanceof Error ? err.message : String(err) }, 'No incidents for the device timeline');
  }

  const value = {
    supported: true as const,
    source: 'device' as const,
    cameraId,
    cameraName: target.cameraName,
    date,
    timezone: 'device-clock',
    totalRecordedSeconds: ranges.reduce((sum, r) => sum + secondsBetween(r.start, r.end), 0),
    totalRecordedBytes: 0,
    segmentsCount: ranges.length,
    continuousBlocks: ranges.map((r) => ({ startTime: wallToIso(r.start), endTime: wallToIso(r.end), durationSeconds: secondsBetween(r.start, r.end) })),
    gaps: [],
    incidents,
    complete: found.complete,
    clock: clock ? { deviceTime: clock.deviceTime, driftSeconds: clock.driftSeconds } : null,
  };
  if (timelineCache.size > 500) timelineCache.clear();
  timelineCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

function directPathConfig(source: string) {
  return { source, sourceOnDemand: true, sourceOnDemandStartTimeout: '15s', sourceOnDemandCloseAfter: '5s', rtspTransport: 'tcp', record: false, runOnReady: '', runOnNotReady: '' };
}

/** Runs inside the MediaMTX container, the only place allowed to publish. Quiet: ffmpeg's errors print the source URL. */
function transcodePathConfig(source: string, name: string) {
  const command = `ffmpeg -hide_banner -loglevel quiet -rtsp_transport tcp -i "${source}" -an -vf scale=-2:720 -c:v libx264 -preset veryfast -tune zerolatency -g 50 -b:v 1500k -f rtsp rtsp://localhost:8554/${name}`;
  return { source: 'publisher', runOnDemand: command, runOnDemandStartTimeout: '20s', runOnDemandCloseAfter: '5s', record: false, runOnReady: '', runOnNotReady: '' };
}

async function closeSessionPath(session: Session) {
  closeFastSource(session.fastSourceId);
  if (session.path) await MediaMtxService.removeStreamPath(session.path);
}

export async function closePlaybackSession(id: string, userId: string): Promise<boolean> {
  const session = sessions.get(id);
  if (!session || session.userId !== userId) return false;
  sessions.delete(id);
  await closeSessionPath(session);
  return true;
}

export async function openPlaybackSession(userId: string, input: { cameraId: string; start: string; canPlayH265: boolean; speed?: number }) {
  const target = await findTarget(input.cameraId);
  if (!target) throw new PlaybackError('NOT_SUPPORTED', 400, 'This camera has no recorder whose recordings can be read');

  // Moving the playhead replaces the viewer's session on this camera, it does not add one.
  for (const s of [...sessions.values()]) {
    if (s.userId === userId && s.cameraId === input.cameraId) {
      sessions.delete(s.id);
      await closeSessionPath(s);
    }
  }

  const limits = await readLimits();
  const liveNow = await MediaMtxService.countWebrtcSessions();
  if (liveNow !== null && liveNow >= limits.liveTotal) {
    throw new PlaybackError('LIMIT_LIVE', 429, 'The server is at its limit for video streams');
  }
  const clipsOnDevice = [...runningClips.values()].filter((d) => d === target.deviceId).length;
  const problem = checkSessionLimits([...sessions.values()], { userId, deviceId: target.deviceId }, limits, clipsOnDevice);
  if (problem) throw new PlaybackError(problem, 429, `Playback limit reached: ${problem}`, { limits: { perUser: limits.perUser, perDevice: limits.perDevice, total: limits.total } });

  // A recording sent this fast costs the recorder many times the usual, so each recorder serves one at a time.
  const speed = input.speed ?? 1;
  if (speed > 1 && [...sessions.values()].some((s) => s.deviceId === target.deviceId && s.speed > 1)) {
    throw new PlaybackError('LIMIT_DEVICE', 429, 'This recorder is already serving a fast playback');
  }

  // Holds the place during the checks below, so requests arriving together cannot pass the limit together.
  const id = crypto.randomUUID();
  const session: Session = {
    id,
    userId,
    cameraId: target.cameraId,
    deviceId: target.deviceId,
    path: null,
    transcoded: false,
    speed,
    fastSourceId: null,
    createdAt: Date.now(),
    lifetimeMs: (SESSION_WINDOW_SECONDS + 60) * 1000,
  };
  sessions.set(id, session);

  try {
    const end = addSeconds(input.start, SESSION_WINDOW_SECONDS);
    const { codec, found } = await askRecorder(target, async () => ({
      codec: await readMainCodec(target.login, target.channel),
      found: await searchRecordings(target.login, target.channel, input.start, addSeconds(input.start, 60)),
    }));
    if (found.ranges.length === 0) throw new PlaybackError('NO_RECORDING', 404, 'The recorder has nothing recorded at this time');

    const transcode = isHevc(codec) && !input.canPlayH265;
    if (transcode) {
      const running = [...sessions.values()].filter((s) => s.transcoded).length;
      if (running >= limits.transcodes) {
        throw new PlaybackError('TRANSCODE_LIMIT', 429, 'Every conversion slot for browsers without H.265 is in use', { limit: limits.transcodes });
      }
      session.transcoded = true;
    }

    const name = `${PLAYBACK_PATH_PREFIX}${id.replace(/-/g, '')}`;
    let source = playbackUrl(target.login, target.channel, input.start, end);
    if (speed > 1) {
      const fast = openFastSource({ login: target.login, channel: target.channel, start: toCompact(input.start), end: toCompact(end), speed });
      session.fastSourceId = fast.id;
      source = fast.url;
    }
    const res = await MediaMtxService.apiFetch(`/v3/config/paths/add/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(transcode ? transcodePathConfig(source, name) : directPathConfig(source)),
    });
    if (!res.ok) throw new PlaybackError('MEDIA_SERVER', 502, 'The media server would not open this playback');
    session.path = name;

    const urls = MediaMtxService.getStreamUrls(name, MediaMtxService.generateStreamToken(name, userId, SESSION_WINDOW_SECONDS + 300));
    return { sessionId: id, webrtcWhepUrl: urls.webrtcWhepUrl, start: input.start, end, codec, transcoded: transcode, speed };
  } catch (err) {
    sessions.delete(id);
    closeFastSource(session.fastSourceId);
    throw err;
  }
}

async function hasViewers(name: string): Promise<boolean> {
  try {
    const res = await MediaMtxService.apiFetch(`/v3/paths/get/${name}`);
    if (!res.ok) return false;
    return (((await res.json()) as any)?.readers?.length ?? 0) > 0;
  } catch {
    return true; // cannot tell: leave it for the next round
  }
}

/** A closed tab sends no goodbye: a session nobody watches is ended here, so the recorder gets its slot back. */
export async function sweepPlaybackSessions(now = Date.now()) {
  for (const session of [...sessions.values()]) {
    if (!session.path) continue;
    const age = now - session.createdAt;
    if (age > session.lifetimeMs || (age > IDLE_MS && !(await hasViewers(session.path)))) {
      sessions.delete(session.id);
      await closeSessionPath(session);
    }
  }
}

/** After a restart nothing here knows the paths and clip jobs of the previous run. */
async function cleanUpAfterRestart() {
  try {
    const res = await MediaMtxService.apiFetch('/v3/config/paths/list?itemsPerPage=1000');
    if (res.ok) {
      const items = (((await res.json()) as any)?.items ?? []) as Array<{ name: string }>;
      for (const { name } of items) if (name.startsWith(PLAYBACK_PATH_PREFIX)) await MediaMtxService.removeStreamPath(name);
    }
  } catch (err) {
    logger.debug({ err: err instanceof Error ? err.message : String(err) }, 'Could not list old playback paths');
  }
  await getPrisma().recordingClip.updateMany({
    where: { status: { in: ['QUEUED', 'PROCESSING'] }, filePath: { startsWith: `/recordings/clips/${CLIP_FILE_PREFIX}` } },
    data: { status: 'FAILED', description: 'Export interrupted by a server restart' },
  });
}

export function startDevicePlayback() {
  if (sweeper) return;
  startFastPlaybackProxy();
  void cleanUpAfterRestart().catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'Playback clean-up failed'));
  sweeper = setInterval(() => void sweepPlaybackSessions().catch(() => {}), SWEEP_MS);
  sweeper.unref();
}

export function stopDevicePlayback() {
  stopFastPlaybackProxy();
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

function run(cmd: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ failed: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, signal }, (err, stdout) => resolve({ failed: !!err, out: String(stdout) }));
  });
}

export async function startDeviceClip(
  username: string,
  input: { cameraId: string; start: string; end: string; title: string; incidentId?: string; legalHold?: boolean },
) {
  const target = await findTarget(input.cameraId);
  if (!target) throw new PlaybackError('NOT_SUPPORTED', 400, 'This camera has no recorder whose recordings can be read');

  const seconds = secondsBetween(input.start, input.end);
  const limits = await readLimits();
  if (seconds <= 0 || seconds > limits.clipMinutes * 60) {
    throw new PlaybackError('CLIP_TOO_LONG', 400, `A clip from a recorder can cover at most ${limits.clipMinutes} minutes`, { maxMinutes: limits.clipMinutes });
  }
  if (runningClips.size >= MAX_CLIPS_AT_ONCE) throw new PlaybackError('CLIP_LIMIT', 429, 'Other clips are being copied; try again when they finish');

  const onDevice = [...sessions.values()].filter((s) => s.deviceId === target.deviceId).length
    + [...runningClips.values()].filter((d) => d === target.deviceId).length;
  if (onDevice >= limits.perDevice) throw new PlaybackError('LIMIT_DEVICE', 429, 'This recorder is already serving its limit of recordings');

  const clipsDir = RecordingsService.getClipsDir();
  const freeBytes = RecordingsService.getFreeBytes(clipsDir);
  if (freeBytes !== null && seconds * CLIP_BYTES_PER_SECOND * 1.1 > freeBytes) {
    throw new PlaybackError('DISK_FULL', 507, 'Not enough disk space on the server for this clip');
  }

  // A run is taken before the first wait, so two requests together cannot both pass the limits above.
  const clipId = crypto.randomUUID();
  runningClips.set(clipId, target.deviceId);
  try {
    const { codec, found, clock } = await askRecorder(target, async () => ({
      codec: await readMainCodec(target.login, target.channel),
      clock: await readClock(target.login),
      found: await searchRecordings(target.login, target.channel, input.start, input.end),
    }));
    const covered = clipRanges(found.ranges, input.start, input.end);
    if (covered.length === 0) throw new PlaybackError('NO_RECORDING', 404, 'The recorder has nothing recorded in this period');

    const filename = `${CLIP_FILE_PREFIX}${input.cameraId.slice(0, 8)}_${input.start.replace(/[-:]/g, '')}_${clipId.slice(0, 8)}.mp4`;
    const clip = await getPrisma().recordingClip.create({
      data: {
        id: clipId,
        cameraId: input.cameraId,
        incidentId: input.incidentId,
        title: input.title,
        description: 'Copied from the recorder HDD',
        startTime: new Date(wallToIso(covered[0].start)),
        endTime: new Date(wallToIso(covered[covered.length - 1].end)),
        durationSeconds: covered.reduce((sum, r) => sum + secondsBetween(r.start, r.end), 0),
        filePath: `/recordings/clips/${filename}`,
        format: 'mp4',
        status: 'PROCESSING',
        hasPreBuffer: false,
        preBufferSeconds: 0,
        postBufferSeconds: 0,
        legalHold: input.legalHold ?? false,
        chainOfCustody: [],
        downloadUrl: `/api/v1/recordings/clips/download/${filename}`,
        exportedBy: username,
      },
    });

    const controller = new AbortController();
    const { signal } = controller;
    const finished = copyClip({ target, clipId, input, covered, codec, clock, filename, clipsDir, username, signal })
      .catch(async (err) => {
        if (signal.aborted) {
          fs.rmSync(path.join(clipsDir, filename), { force: true });
          return;
        }
        logger.warn({ clipId, reason: err instanceof Error ? err.message : 'failed' }, 'Clip from the recorder failed');
        await getPrisma().recordingClip.update({ where: { id: clipId }, data: { status: 'FAILED', description: err instanceof Error ? err.message : 'Export failed' } });
      })
      .catch((err) => logger.warn({ clipId, reason: err instanceof Error ? err.message : 'failed' }, 'Could not record the outcome of a clip'))
      .finally(() => {
        runningClips.delete(clipId);
        clipJobs.delete(clipId);
      });
    clipJobs.set(clipId, { controller, finished });

    return { ...clip, fileSizeBytes: null };
  } catch (err) {
    runningClips.delete(clipId);
    throw err;
  }
}

/** Stops a copy and waits until it has cleaned up, which also gives the recorder its slot back. False when none is running. */
export async function cancelDeviceClip(clipId: string): Promise<boolean> {
  const job = clipJobs.get(clipId);
  if (!job) return false;
  job.controller.abort();
  await job.finished;
  return true;
}

async function copyClip(job: {
  signal: AbortSignal;
  target: Target;
  clipId: string;
  input: { start: string; end: string };
  covered: WallRange[];
  codec: string | null;
  clock: RecorderClock | null;
  filename: string;
  clipsDir: string;
  username: string;
}) {
  const { target, input, covered } = job;
  const fullPath = path.join(job.clipsDir, job.filename);
  const partial = `${fullPath}.partial`;
  const seconds = secondsBetween(input.start, input.end);
  const source = playbackUrl(target.login, target.channel, input.start, input.end);
  // The recorder sends a recording in real time, so a clip takes about as long as it lasts.
  // Video is copied untouched; its G.711 audio has no place in an MP4, so only the audio is converted.
  const result = await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'quiet', '-rtsp_transport', 'tcp', '-timeout', '15000000',
    '-i', source, '-t', String(seconds), '-c:v', 'copy', ...(isHevc(job.codec) ? ['-tag:v', 'hvc1'] : []), '-c:a', 'aac',
    '-movflags', '+faststart', '-f', 'mp4', partial,
  ], (seconds + 120) * 1000, job.signal);

  try {
    // A stopped ffmpeg leaves a playable partial file: that is not the clip the person asked for.
    job.signal.throwIfAborted();
    if (result.failed && !(fs.existsSync(partial) && fs.statSync(partial).size > 0)) {
      throw new Error('The recorder did not deliver this recording');
    }
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', partial], 30_000, job.signal);
    job.signal.throwIfAborted();
    const measured = Number(probe.out.trim());
    if (probe.failed || !Number.isFinite(measured) || measured <= 0) throw new Error('The copied file is not playable');
    fs.renameSync(partial, fullPath);
  } finally {
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
  }

  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(fullPath), hash, { signal: job.signal });
  const sha256Hash = hash.digest('hex');
  const size = fs.statSync(fullPath).size;
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', fullPath], 30_000, job.signal);
  const measuredSeconds = Number(probe.out.trim());
  job.signal.throwIfAborted();

  await getPrisma().recordingClip.update({
    where: { id: job.clipId },
    data: {
      status: 'COMPLETED',
      durationSeconds: measuredSeconds,
      fileSizeBytes: BigInt(size),
      sha256Hash,
      description: measuredSeconds < seconds * 0.9 ? `Copied from the recorder HDD; ${Math.round(measuredSeconds)} s of the ${Math.round(seconds)} s requested` : 'Copied from the recorder HDD',
      chainOfCustody: [{
        timestamp: new Date().toISOString(),
        action: 'export_from_recorder',
        performedBy: job.username,
        sha256: sha256Hash,
        fileSizeBytes: size,
        source: 'recorder_hdd',
        deviceId: target.deviceId,
        channel: target.channel,
        requestedStart: input.start,
        requestedEnd: input.end,
        // The clip's times are the recorder's clock, which is also what its picture shows.
        timesAre: 'recorder_clock',
        recorderClockAheadOfServerSeconds: job.clock?.driftSeconds ?? null,
        videoCodec: job.codec,
        videoCopied: true,
        audioConverted: 'aac',
        measuredSeconds,
        recordedRanges: covered.map((r) => ({ start: r.start, end: r.end })),
        keyframeAligned: true,
      }],
    },
  });
}
