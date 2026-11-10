import { SnapshotError, type SnapshotFailure, type SnapshotResult, type SnapshotTarget } from './snapshot-sources.js';

export interface SchedulerSettings {
  refreshSeconds: number;
  deviceConcurrency: number;
  globalConcurrency: number;
  rtspConcurrency: number;
  cacheBytes: number;
}

export type SnapshotState = 'ok' | 'waiting' | 'no_source' | SnapshotFailure;

export interface CameraSnapshotStatus {
  state: SnapshotState;
  /** Epoch ms of the image held for this camera, which may be older than `state`. */
  capturedAt: number | null;
  /** The period this camera is refreshed on (its own level, or the system value). */
  refreshSeconds: number;
}

interface CameraEntry {
  target: SnapshotTarget | null;
  image: Buffer | null;
  capturedAt: number | null;
  lastDemandAt: number;
  nextDueAt: number;
  failures: number;
  lastFailure: SnapshotFailure | null;
  inFlight: boolean;
}

interface HostEntry {
  active: number;
  consecutiveFailures: number;
  openUntil: number;
  openPeriodMs: number;
  /** login key -> when it may be tried again */
  loginBlockedUntil: Map<string, number>;
  httpUnsupported: boolean;
}

/** The camera's own refresh (camera > group > DVR/NVR) or else the system value. */
const periodSeconds = (entry: CameraEntry, settings: SchedulerSettings) => entry.target?.refreshSeconds ?? settings.refreshSeconds;

/** A camera stops being fetched this long after the last page that wanted it. */
export const DEMAND_TTL_MS = 30_000;
const IMAGE_TTL_MS = 10 * 60_000;
const MAX_CAMERA_BACKOFF_MS = 10 * 60_000;
// One failed login per half hour stays far below what makes Hikvision-family devices lock an account.
const LOGIN_BLOCK_MS = 30 * 60_000;
const HOST_FAILURES_TO_OPEN = 5;
const HOST_OPEN_MIN_MS = 60_000;
const HOST_OPEN_MAX_MS = 10 * 60_000;

/**
 * Fetches still images only for cameras someone is looking at, within fixed limits per device and
 * overall. Falling behind makes images older, never more work: a camera is queued once at most and
 * memory is capped by evicting the images nobody has asked for lately. A wrong login stops that
 * device at once; a device that keeps failing is rested instead of hammered.
 */
export class SnapshotScheduler {
  private cameras = new Map<string, CameraEntry>();
  private hosts = new Map<string, HostEntry>();
  private active = 0;
  private rtspActive = 0;
  private cacheBytes = 0;
  private avgMs: number | null = null;
  private avgBytes: number | null = null;
  private samples = 0;
  private recentDone: number[] = [];

  constructor(
    private readonly fetcher: (target: SnapshotTarget, opts: { skipHttp?: boolean }) => Promise<SnapshotResult>,
    private readonly getSettings: () => SchedulerSettings,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records that these cameras are on someone's screen and returns what is known about them. */
  request(targets: { id: string; target: SnapshotTarget | null }[]): Record<string, CameraSnapshotStatus> {
    const now = this.now();
    const out: Record<string, CameraSnapshotStatus> = {};
    for (const { id, target } of targets) {
      const entry = this.cameras.get(id) ?? this.newEntry(now);
      entry.target = target;
      entry.lastDemandAt = now;
      this.cameras.set(id, entry);
      out[id] = this.statusOf(entry, now);
    }
    this.pump();
    return out;
  }

  image(id: string): { image: Buffer; capturedAt: number } | null {
    const entry = this.cameras.get(id);
    return entry?.image && entry.capturedAt ? { image: entry.image, capturedAt: entry.capturedAt } : null;
  }

  /** Starts whatever is due and allowed. Cheap with nothing demanded; safe to call often. */
  pump(): void {
    const now = this.now();
    const settings = this.getSettings();
    const due = [...this.cameras.values()]
      .filter((e) => !e.inFlight && e.target && e.nextDueAt <= now && now - e.lastDemandAt <= DEMAND_TTL_MS)
      // The oldest image goes first so a slow device cannot starve the others.
      .sort((a, b) => (a.capturedAt ?? 0) - (b.capturedAt ?? 0));
    for (const entry of due) {
      if (this.active >= settings.globalConcurrency) return;
      const target = entry.target!;
      const host = this.hostOf(target.host);
      if (host.active >= settings.deviceConcurrency || host.openUntil > now) continue;
      if ((host.loginBlockedUntil.get(target.loginKey) ?? 0) > now) continue;
      void this.run(entry, target, host, settings);
    }
  }

  /** Drops what nobody has asked for lately and holds the image cache to its limit. */
  sweep(): void {
    const now = this.now();
    for (const [id, entry] of this.cameras) {
      if (entry.inFlight || now - entry.lastDemandAt <= IMAGE_TTL_MS) continue;
      this.cacheBytes -= entry.image?.length ?? 0;
      this.cameras.delete(id);
    }
    this.enforceCacheLimit();
  }

  stats() {
    const now = this.now();
    const demanded = [...this.cameras.values()].filter((e) => now - e.lastDemandAt <= DEMAND_TTL_MS);
    const { refreshSeconds } = this.getSettings();
    const periodOf = (e: CameraEntry) => e.target?.refreshSeconds ?? refreshSeconds;
    this.recentDone = this.recentDone.filter((t) => now - t <= 60_000);
    return {
      demanded: demanded.length,
      active: this.active,
      waiting: demanded.filter((e) => e.target && !e.inFlight && e.nextDueAt <= now).length,
      oldestImageSeconds: demanded.reduce((max, e) => (e.capturedAt ? Math.max(max, (now - e.capturedAt) / 1000) : max), 0),
      // Twice the refresh period means images are arriving late, not that anything is failing.
      behind: demanded.some((e) => e.capturedAt && now - e.capturedAt > periodOf(e) * 2000 && this.statusOf(e, now).state === 'ok'),
      imagesPerMinute: this.recentDone.length,
      cacheBytes: this.cacheBytes,
      avgMs: this.avgMs,
      avgBytes: this.avgBytes,
      samples: this.samples,
    };
  }

  private newEntry(now: number): CameraEntry {
    return { target: null, image: null, capturedAt: null, lastDemandAt: now, nextDueAt: 0, failures: 0, lastFailure: null, inFlight: false };
  }

  private hostOf(name: string): HostEntry {
    let host = this.hosts.get(name);
    if (!host) {
      host = { active: 0, consecutiveFailures: 0, openUntil: 0, openPeriodMs: HOST_OPEN_MIN_MS, loginBlockedUntil: new Map(), httpUnsupported: false };
      this.hosts.set(name, host);
    }
    return host;
  }

  private statusOf(entry: CameraEntry, now: number): CameraSnapshotStatus {
    let state: SnapshotState;
    if (!entry.target) state = 'no_source';
    else if ((this.hosts.get(entry.target.host)?.loginBlockedUntil.get(entry.target.loginKey) ?? 0) > now) state = 'auth_failed';
    // A device being rested is down for all its cameras, including those that have an older image.
    else if ((this.hosts.get(entry.target.host)?.openUntil ?? 0) > now) state = 'unreachable';
    else if (entry.lastFailure) state = entry.lastFailure;
    else state = entry.capturedAt ? 'ok' : 'waiting';
    return { state, capturedAt: entry.capturedAt, refreshSeconds: periodSeconds(entry, this.getSettings()) };
  }

  private async run(entry: CameraEntry, target: SnapshotTarget, host: HostEntry, settings: SchedulerSettings) {
    const needsRtsp = host.httpUnsupported;
    // RTSP frames spawn ffmpeg; past this limit they simply wait their turn on a later pump.
    if (needsRtsp && this.rtspActive >= settings.rtspConcurrency) return;
    entry.inFlight = true;
    host.active++;
    this.active++;
    if (needsRtsp) this.rtspActive++;
    const startedAt = this.now();
    let usedRtsp = needsRtsp;
    try {
      const result = await this.fetcher(target, { skipHttp: host.httpUnsupported });
      usedRtsp = result.usedRtsp;
      this.onSuccess(entry, host, result, startedAt, settings);
    } catch (err) {
      this.onFailure(entry, target, host, err instanceof SnapshotError ? err.kind : 'failed', settings);
    } finally {
      entry.inFlight = false;
      host.active--;
      this.active--;
      if (needsRtsp) this.rtspActive--;
      if (!needsRtsp && usedRtsp) host.httpUnsupported = true;
      this.pump();
    }
  }

  private onSuccess(entry: CameraEntry, host: HostEntry, result: SnapshotResult, startedAt: number, settings: SchedulerSettings) {
    const now = this.now();
    this.cacheBytes += result.image.length - (entry.image?.length ?? 0);
    entry.image = result.image;
    entry.capturedAt = now;
    entry.failures = 0;
    entry.lastFailure = null;
    entry.nextDueAt = now + periodSeconds(entry, settings) * 1000;
    host.consecutiveFailures = 0;
    host.openPeriodMs = HOST_OPEN_MIN_MS;
    const elapsed = now - startedAt;
    this.avgMs = this.avgMs === null ? elapsed : this.avgMs * 0.9 + elapsed * 0.1;
    this.avgBytes = this.avgBytes === null ? result.image.length : this.avgBytes * 0.9 + result.image.length * 0.1;
    this.samples++;
    this.recentDone.push(now);
    this.enforceCacheLimit();
  }

  private onFailure(entry: CameraEntry, target: SnapshotTarget, host: HostEntry, kind: SnapshotFailure, settings: SchedulerSettings) {
    const now = this.now();
    entry.lastFailure = kind;
    entry.failures++;
    entry.nextDueAt = now + Math.min(MAX_CAMERA_BACKOFF_MS, periodSeconds(entry, settings) * 1000 * 2 ** entry.failures);
    if (kind === 'auth_failed') {
      host.loginBlockedUntil.set(target.loginKey, now + LOGIN_BLOCK_MS);
      return;
    }
    // One bad channel says nothing about the device: resting it would stop the channels that work.
    if (kind === 'failed') return;
    if (++host.consecutiveFailures >= HOST_FAILURES_TO_OPEN) {
      host.openUntil = now + host.openPeriodMs;
      host.openPeriodMs = Math.min(HOST_OPEN_MAX_MS, host.openPeriodMs * 2);
      host.consecutiveFailures = 0;
    }
  }

  private enforceCacheLimit() {
    const limit = this.getSettings().cacheBytes;
    if (this.cacheBytes <= limit) return;
    const byDemand = [...this.cameras.values()].filter((e) => e.image).sort((a, b) => a.lastDemandAt - b.lastDemandAt);
    for (const entry of byDemand) {
      if (this.cacheBytes <= limit) return;
      this.cacheBytes -= entry.image!.length;
      entry.image = null;
      entry.capturedAt = null;
    }
  }
}
