import { describe, it, expect } from 'vitest';
import { SnapshotScheduler, type SchedulerSettings } from './snapshot-scheduler.js';
import { SnapshotError, type SnapshotTarget } from './snapshot-sources.js';
import { computeSnapshotAdvice } from './snapshot-advice.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const settings = (over: Partial<SchedulerSettings> = {}): SchedulerSettings => ({
  refreshSeconds: 30, deviceConcurrency: 2, globalConcurrency: 8, rtspConcurrency: 2, cacheBytes: 1024 * 1024, ...over,
});

function target(id: string, host = 'nvr-1'): { id: string; target: SnapshotTarget } {
  return { id, target: { cameraId: id, host, httpPort: 80, loginKey: `key-${host}`, username: 'u', password: 'p', brand: 'Hikvision', channel: 1, rtspUrl: 'rtsp://x' } };
}

function harness(fetcher: (t: SnapshotTarget, o: { skipHttp?: boolean }) => Promise<any>, s: Partial<SchedulerSettings> = {}) {
  let clock = 1_000_000;
  const current = settings(s);
  const scheduler = new SnapshotScheduler(fetcher, () => current, () => clock);
  return { scheduler, advance: (ms: number) => { clock += ms; }, settings: current };
}

describe('SnapshotScheduler', () => {
  it('a camera with its own refresh is fetched on that period; the rest follow the system value', async () => {
    const calls: Record<string, number> = { fast: 0, slow: 0 };
    const { scheduler, advance } = harness(async (t) => { calls[t.cameraId]++; return { image: JPEG, usedRtsp: false }; }, { refreshSeconds: 30 });
    const fast = target('fast', 'nvr-a');
    fast.target.refreshSeconds = 10;
    const slow = target('slow', 'nvr-b');
    const look = () => scheduler.request([fast, slow]);
    look();
    await sleep(5);
    for (let s = 0; s < 3; s++) { // 3 x 10 s, the page still open
      advance(10_000);
      look();
      await sleep(5);
    }
    expect(calls.fast).toBe(4);
    expect(calls.slow).toBe(2); // first fetch, then once at 30 s
  });

  it('never exceeds the per-device or overall limit, however many cameras are on screen', async () => {
    const running = new Map<string, number>();
    let peakHost = 0;
    let peakTotal = 0;
    let total = 0;
    const { scheduler } = harness(async (t) => {
      running.set(t.host, (running.get(t.host) ?? 0) + 1);
      total++;
      peakHost = Math.max(peakHost, running.get(t.host)!);
      peakTotal = Math.max(peakTotal, total);
      await sleep(5);
      running.set(t.host, running.get(t.host)! - 1);
      total--;
      return { image: JPEG, usedRtsp: false };
    }, { deviceConcurrency: 3, globalConcurrency: 8 });

    const cams = Array.from({ length: 300 }, (_, i) => target(`c${i}`, `nvr-${i % 8}`));
    scheduler.request(cams);
    for (let waited = 0; scheduler.stats().samples < 300 && waited < 5000; waited += 20) await sleep(20);

    expect(peakHost).toBeLessThanOrEqual(3);
    expect(peakTotal).toBeLessThanOrEqual(8);
    expect(scheduler.stats().samples).toBe(300);
  });

  it('fetches nothing nobody is looking at', async () => {
    let calls = 0;
    const { scheduler, advance } = harness(async () => { calls++; return { image: JPEG, usedRtsp: false }; });
    scheduler.request([target('a')]);
    await sleep(5);
    expect(calls).toBe(1);

    advance(31_000); // due again, but the page has gone away
    scheduler.pump();
    await sleep(5);
    expect(calls).toBe(1);
  });

  it('waits for the refresh period and shares one fetch between viewers', async () => {
    let calls = 0;
    const { scheduler, advance } = harness(async () => { calls++; return { image: JPEG, usedRtsp: false }; });
    scheduler.request([target('a')]);
    scheduler.request([target('a')]);
    await sleep(5);
    scheduler.request([target('a')]);
    await sleep(5);
    expect(calls).toBe(1);

    advance(30_001);
    scheduler.request([target('a')]);
    await sleep(5);
    expect(calls).toBe(2);
  });

  it('stops trying a whole device at the first wrong login, until the block ends or the login changes', async () => {
    let calls = 0;
    const { scheduler, advance } = harness(async () => { calls++; throw new SnapshotError('auth_failed'); }, { deviceConcurrency: 1 });
    const cams = Array.from({ length: 16 }, (_, i) => target(`c${i}`));
    scheduler.request(cams);
    await sleep(20);
    expect(calls).toBe(1);

    advance(29 * 60_000);
    expect(scheduler.request(cams).c5.state).toBe('auth_failed');
    await sleep(10);
    expect(calls).toBe(1);

    const newLogin = { ...cams[3], target: { ...cams[3].target, loginKey: 'new-password' } };
    scheduler.request([newLogin]);
    await sleep(10);
    expect(calls).toBe(2);
  });

  it('rests a device that keeps failing and leaves the others working', async () => {
    const attempts: Record<string, number> = {};
    const { scheduler, advance } = harness(async (t) => {
      attempts[t.host] = (attempts[t.host] ?? 0) + 1;
      if (t.host === 'dead') throw new SnapshotError('unreachable');
      return { image: JPEG, usedRtsp: false };
    }, { deviceConcurrency: 1, refreshSeconds: 10 });

    const dead = Array.from({ length: 20 }, (_, i) => target(`d${i}`, 'dead'));
    const alive = Array.from({ length: 5 }, (_, i) => target(`a${i}`, 'alive'));
    const out = scheduler.request([...dead, ...alive]);
    await sleep(30);
    expect(attempts.dead).toBe(5); // then the breaker opens
    expect(attempts.alive).toBe(5);
    expect(out).toBeDefined();

    advance(30_000); // still inside the rest period
    scheduler.request(dead);
    await sleep(10);
    expect(attempts.dead).toBe(5);
    expect(scheduler.request(dead).d0.state).toBe('unreachable');
  });

  it('reports every camera of a device being rested as unreachable, not as behind', async () => {
    let down = false;
    const { scheduler, advance } = harness(async () => {
      if (down) throw new SnapshotError('unreachable');
      return { image: JPEG, usedRtsp: false };
    }, { deviceConcurrency: 1, refreshSeconds: 10 });
    const cams = Array.from({ length: 8 }, (_, i) => target(`c${i}`, 'nvr'));
    scheduler.request(cams);
    await sleep(40);

    down = true;
    advance(11_000);
    scheduler.request(cams);
    await sleep(40);
    advance(25_000);
    const out = scheduler.request(cams);
    expect(Object.values(out).every((s) => s.state === 'unreachable')).toBe(true);
    expect(scheduler.stats().behind).toBe(false);
  });

  it('keeps showing the last good image, with its real time, when a camera starts failing', async () => {
    let fail = false;
    const { scheduler, advance } = harness(async () => {
      if (fail) throw new SnapshotError('unreachable');
      return { image: JPEG, usedRtsp: false };
    });
    scheduler.request([target('a')]);
    await sleep(5);
    const firstTime = scheduler.image('a')!.capturedAt;

    fail = true;
    advance(31_000);
    scheduler.request([target('a')]);
    await sleep(5);
    const status = scheduler.request([target('a')]).a;
    expect(status).toMatchObject({ state: 'unreachable', capturedAt: firstTime });
    expect(scheduler.image('a')!.capturedAt).toBe(firstTime);
  });

  it('holds memory to the cache limit by dropping the images asked for longest ago', async () => {
    const big = Buffer.alloc(400 * 1024, 1);
    const { scheduler, advance } = harness(async () => ({ image: big, usedRtsp: false }), { cacheBytes: 1024 * 1024, deviceConcurrency: 8 });
    for (let i = 0; i < 5; i++) {
      scheduler.request([target(`c${i}`)]);
      await sleep(3);
      advance(1000);
    }
    expect(scheduler.stats().cacheBytes).toBeLessThanOrEqual(1024 * 1024);
    expect(scheduler.image('c0')).toBeNull();
    expect(scheduler.image('c4')).not.toBeNull();
  });

  it('remembers a device has no still-image URL and limits the heavy RTSP fallback', async () => {
    const skip: boolean[] = [];
    let rtspNow = 0;
    let rtspPeak = 0;
    const { scheduler } = harness(async (_t, o) => {
      skip.push(Boolean(o.skipHttp));
      if (o.skipHttp) {
        rtspNow++;
        rtspPeak = Math.max(rtspPeak, rtspNow);
        await sleep(5);
        rtspNow--;
      }
      return { image: JPEG, usedRtsp: true };
    }, { deviceConcurrency: 8, globalConcurrency: 8, rtspConcurrency: 2 });

    scheduler.request([target('first')]);
    await sleep(5);
    scheduler.request(Array.from({ length: 10 }, (_, i) => target(`c${i}`)));
    await sleep(80);

    expect(skip[0]).toBe(false);
    expect(skip.slice(1).every(Boolean)).toBe(true);
    expect(rtspPeak).toBeLessThanOrEqual(2);
  });

  it('survives a fetcher that throws something unexpected', async () => {
    const { scheduler } = harness(async () => { throw new TypeError('boom'); });
    scheduler.request([target('a')]);
    await sleep(5);
    expect(scheduler.request([target('a')]).a.state).toBe('failed');
    expect(scheduler.stats().active).toBe(0);
  });

  it('holds its limits with slow devices and 1000 cameras', async () => {
    let peak = 0;
    let now = 0;
    const { scheduler, advance } = harness(async () => {
      now++;
      peak = Math.max(peak, now);
      await sleep(20);
      now--;
      return { image: JPEG, usedRtsp: false };
    }, { deviceConcurrency: 4, globalConcurrency: 16, refreshSeconds: 10 });
    const cams = Array.from({ length: 1000 }, (_, i) => target(`c${i}`, `nvr-${i % 16}`));
    const started = performance.now();
    scheduler.request(cams);
    const firstRequestMs = performance.now() - started;
    await sleep(100);
    advance(1000);
    const stats = scheduler.stats();

    expect(peak).toBeLessThanOrEqual(16);
    expect(stats.active).toBeLessThanOrEqual(16);
    expect(firstRequestMs).toBeLessThan(200);
  });
});

describe('computeSnapshotAdvice', () => {
  const base = { refreshSeconds: 30, deviceConcurrency: 3, globalConcurrency: 16, avgMs: 400, avgBytes: 46 * 1024, samples: 100 };

  it('uses this system\'s own measurements once it has them', () => {
    expect(computeSnapshotAdvice({ ...base, cameras: 300, busiestDeviceCameras: 64 })).toMatchObject({
      source: 'measured', imagesPerSecond: 10, bandwidthMbps: 3.8, keepsUp: true,
    });
  });

  it('says when the estimate is an assumption', () => {
    expect(computeSnapshotAdvice({ ...base, cameras: 1, busiestDeviceCameras: 1, samples: 2 }).source).toBe('assumed');
  });

  it('names what limits a setting that cannot keep up, and a refresh that can', () => {
    const advice = computeSnapshotAdvice({ ...base, refreshSeconds: 10, cameras: 300, busiestDeviceCameras: 128, avgMs: 500 });
    expect(advice.keepsUp).toBe(false);
    expect(advice.limitedBy).toBe('device');
    expect(advice.achievableSeconds).toBe(22);
    expect(advice.recommendedRefreshSeconds).toBe(30);
  });

  it('handles a system with no cameras', () => {
    expect(computeSnapshotAdvice({ ...base, cameras: 0, busiestDeviceCameras: 0 })).toMatchObject({ imagesPerSecond: 0, keepsUp: true, recommendedRefreshSeconds: 10 });
  });

  it('keeps fetching the working channels of a device when some of its channels keep failing', async () => {
    const attempts: Record<string, number> = {};
    const { scheduler, advance } = harness(async (t) => {
      attempts[t.cameraId] = (attempts[t.cameraId] ?? 0) + 1;
      if (Number(t.cameraId.slice(1)) >= 3) throw new SnapshotError('failed');
      return { image: JPEG, usedRtsp: false };
    }, { refreshSeconds: 10 });

    const channels = Array.from({ length: 8 }, (_, i) => target(`c${i}`, 'nvr'));
    for (let round = 0; round < 8; round++) {
      scheduler.request(channels);
      await sleep(10);
      advance(11_000);
    }
    const out = scheduler.request(channels);
    expect(attempts.c0).toBeGreaterThan(3);
    expect(out.c0.state).toBe('ok');
    expect(out.c5.state).toBe('failed');
  });
});
