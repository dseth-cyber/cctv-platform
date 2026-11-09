import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAuditLog } from '../audit/audit.service.js';
import { pointRecorderAtNtp, RecorderNtpError } from './recorder-ntp.js';
import { runNtpBatch } from './recorder-ntp-bulk.js';

vi.mock('../audit/audit.service.js', () => ({ createAuditLog: vi.fn().mockResolvedValue({}) }));
vi.mock('./device-health.service.js', () => ({ checkDeviceHealthNow: vi.fn() }));
vi.mock('../../lib/bulk-job.js', () => ({ createBulkJob: vi.fn(), updateBulkJob: vi.fn() }));
vi.mock('./recorder-ntp.js', async () => {
  const real = await vi.importActual<typeof import('./recorder-ntp.js')>('./recorder-ntp.js');
  return { ...real, pointRecorderAtNtp: vi.fn() };
});

const done = (id: string) => ({ device: { id, name: `R-${id}` }, server: '192.168.30.77', minutes: 60, serverCheck: null, before: { mode: 'manual' }, after: { mode: 'NTP' } });
const actor = { id: 'u1', username: 'admin', ip: '127.0.0.1' };

describe('runNtpBatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does each recorder in turn and puts each on record', async () => {
    vi.mocked(pointRecorderAtNtp).mockImplementation(async (id: string) => done(id) as any);
    const seen: number[] = [];
    const items = await runNtpBatch(['a', 'b', 'c'], actor, async (sofar) => { seen.push(sofar.length); });
    expect(items.map((i) => i.ok)).toEqual([true, true, true]);
    expect(seen).toEqual([1, 2, 3]);
    expect(createAuditLog).toHaveBeenCalledTimes(3);
  });

  it('carries on past a recorder that refuses, and records the refusal', async () => {
    vi.mocked(pointRecorderAtNtp).mockImplementation(async (id: string) => {
      if (id === 'b') throw new RecorderNtpError('RECORDER_UNREACHABLE');
      return done(id) as any;
    });
    const items = await runNtpBatch(['a', 'b', 'c'], actor);
    expect(items.map((i) => i.code ?? 'ok')).toEqual(['ok', 'RECORDER_UNREACHABLE', 'ok']);
    expect(vi.mocked(createAuditLog).mock.calls.map(([a]) => a.description)).toContain('Recorder clock change failed (RECORDER_UNREACHABLE) by admin');
  });

  it('stops when our own NTP server is not fit, without sending to the rest', async () => {
    vi.mocked(pointRecorderAtNtp).mockImplementation(async (id: string) => {
      if (id === 'b') throw new RecorderNtpError('NTP_SERVER_NOT_SYNCED');
      return done(id) as any;
    });
    const items = await runNtpBatch(['a', 'b', 'c', 'd'], actor);
    expect(items.map((i) => i.code ?? 'ok')).toEqual(['ok', 'NTP_SERVER_NOT_SYNCED', 'SKIPPED', 'SKIPPED']);
    expect(pointRecorderAtNtp).toHaveBeenCalledTimes(2);
  });

  it('reports a recorder that no longer exists', async () => {
    vi.mocked(pointRecorderAtNtp).mockResolvedValue(null);
    expect((await runNtpBatch(['gone'], actor))[0]).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
