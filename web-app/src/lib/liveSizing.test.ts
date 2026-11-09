import { describe, expect, it } from 'vitest';
import { liveOnlySizing } from './liveSizing';

const base = { cameras: 103, viewers: 1, streamsPerViewer: 16, conversions: 0, mainKbps: 2048, subKbps: 512 };

describe('liveOnlySizing', () => {
  it('matches what was measured: one 4x4 wall on 103 cameras uses about a fifth of one thread', () => {
    const r = liveOnlySizing(base);
    expect(r.sessions).toBe(16);
    expect(r.threadsUsed).toBeGreaterThan(0.15);
    expect(r.threadsUsed).toBeLessThan(0.25);
    expect(r.threadsFromEstimate).toBe(0);
  });

  it('sizes 500 cameras with 10 people on 4x4 walls and 2 conversions at 16 threads (8 cores/16 threads), 16 GB, 1 GbE', () => {
    const r = liveOnlySizing({ ...base, cameras: 500, viewers: 10, conversions: 2 });
    expect(r.sessions).toBe(160);
    expect(r.recommendedThreads).toBe(16);
    expect(r.recommendedRamGb).toBe(16);
    expect(r.nic).toBe('1 GbE');
    expect(r.egressMbps).toBeCloseTo(97.3, 0);
  });

  it('pulls at most one copy of each camera from the recorders', () => {
    const r = liveOnlySizing({ ...base, cameras: 10, viewers: 5 });
    expect(r.pulledStreams).toBe(10);
    expect(r.ingressMbps).toBeLessThan(r.egressMbps);
  });

  it('nobody watching needs only the health checks', () => {
    const r = liveOnlySizing({ ...base, cameras: 500, viewers: 0 });
    expect(r.sessions).toBe(0);
    expect(r.ingressMbps).toBe(0);
    expect(r.threadsUsed).toBeLessThan(0.2);
  });
});
