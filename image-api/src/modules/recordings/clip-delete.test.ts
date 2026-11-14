import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { createAuditLog } from '../audit/audit.service.js';
import { trashClip, restoreClip, deleteExpiredClips, purgeTrashedClips, clipQuarantineDir, ClipCancelError } from './clip-cancel.js';

vi.mock('../audit/audit.service.js', () => ({ createAuditLog: vi.fn().mockResolvedValue({}) }));
vi.mock('../alerts/alerts.service.js', () => ({ createAlert: vi.fn().mockResolvedValue({}) }));
vi.mock('../device-playback/device-playback.service.js', () => ({ cancelDeviceClip: vi.fn().mockResolvedValue(false) }));
vi.mock('./export-queue.js', () => ({ defaultExportQueue: { cancel: vi.fn().mockResolvedValue(true) } }));

const DAY = 86_400_000;
const NOW = new Date('2026-11-14T00:00:00Z');

/** A tiny in-memory recording_clips table: enough of Prisma for the trash paths. */
function fakeClips(rows: any[]) {
  const table = rows.map((r) => ({ legalHold: false, filePath: null, exportedBy: 'alice', status: 'COMPLETED', deletedAt: null, deletedBy: null, title: r.id, cameraId: 'cam', ...r }));
  const test = (value: any, cond: any) => {
    if (cond === null) return value === null || value === undefined;
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('lt' in cond) return value != null && value < cond.lt;
      if ('notIn' in cond) return !cond.notIn.includes(value);
      if ('not' in cond) return cond.not === null ? value != null : value !== cond.not;
    }
    return value === cond;
  };
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([k, v]) => test(row[k], v));
  const recordingClip = {
    findUnique: vi.fn(async ({ where }: any) => table.find((r) => r.id === where.id) ?? null),
    findMany: vi.fn(async ({ where }: any) => table.filter((r) => matches(r, where))),
    count: vi.fn(async ({ where }: any) => table.filter((r) => matches(r, where)).length),
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hit = table.filter((r) => matches(r, where));
      for (const h of hit) Object.assign(h, data);
      return { count: hit.length };
    }),
    update: vi.fn(async ({ where, data }: any) => Object.assign(table.find((r) => r.id === where.id)!, data)),
    deleteMany: vi.fn(async ({ where }: any) => {
      const hit = table.filter((r) => matches(r, where));
      for (const h of hit) table.splice(table.indexOf(h), 1);
      return { count: hit.length };
    }),
  };
  vi.mocked(getPrisma).mockReturnValue({ recordingClip } as any);
  return table;
}

describe('Evidence clips: trash, restore, expiry, purge', () => {
  let root: string;
  let clipsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-clips-'));
    process.env.RECORDINGS_DIR = root;
    delete process.env.RECORDINGS_QUARANTINE_DIR;
    clipsDir = path.join(root, 'clips');
    fs.mkdirSync(clipsDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.RECORDINGS_DIR;
  });

  const file = (name: string) => {
    fs.writeFileSync(path.join(clipsDir, name), 'mp4');
    return `/recordings/clips/${name}`;
  };
  const inClips = (name: string) => fs.existsSync(path.join(clipsDir, name));
  const inQuarantine = (name: string) => fs.existsSync(path.join(clipQuarantineDir(), name));

  it('the owner trashes a finished clip: the row is marked, the file moves to quarantine, nothing is deleted', async () => {
    const table = fakeClips([{ id: 'c1', filePath: file('a.mp4') }]);
    await trashClip('c1', { username: 'alice', role: 'operator' });
    expect(table[0]).toMatchObject({ deletedBy: 'alice' });
    expect(table[0].deletedAt).toBeInstanceOf(Date);
    expect(inClips('a.mp4')).toBe(false);
    expect(inQuarantine('a.mp4')).toBe(true);
  });

  it('restore brings the file and the clip back', async () => {
    const table = fakeClips([{ id: 'c1', filePath: file('a.mp4') }]);
    await trashClip('c1', { username: 'alice' });
    await restoreClip('c1', { username: 'alice' });
    expect(table[0]).toMatchObject({ deletedAt: null, deletedBy: null });
    expect(inClips('a.mp4')).toBe(true);
    expect(inQuarantine('a.mp4')).toBe(false);
  });

  it('an administrator may trash anyone\'s clip; another operator may not', async () => {
    fakeClips([{ id: 'c1', filePath: file('a.mp4') }]);
    await expect(trashClip('c1', { username: 'bob', role: 'operator' })).rejects.toMatchObject({ code: 'NOT_YOURS', statusCode: 403 });
    expect(inClips('a.mp4')).toBe(true);
    await trashClip('c1', { username: 'root', role: 'admin' });
    expect(inQuarantine('a.mp4')).toBe(true);
  });

  it('a clip on Legal Hold is never trashed, even by an administrator', async () => {
    const table = fakeClips([{ id: 'c1', filePath: file('a.mp4'), legalHold: true }]);
    const err = await trashClip('c1', { username: 'root', role: 'admin' }).catch((e) => e);
    expect(err).toBeInstanceOf(ClipCancelError);
    expect(err.code).toBe('LEGAL_HOLD');
    expect(table[0].deletedAt).toBeNull();
    expect(inClips('a.mp4')).toBe(true);
  });

  it('a clip still being made is not trashed (it is cancelled instead)', async () => {
    fakeClips([{ id: 'c1', status: 'PROCESSING' }]);
    await expect(trashClip('c1', { username: 'alice' })).rejects.toMatchObject({ code: 'IN_PROGRESS' });
  });

  it('a file another clip still uses stays where it is', async () => {
    const shared = file('shared.mp4');
    const table = fakeClips([{ id: 'c1', filePath: shared }, { id: 'c2', filePath: shared }]);
    await trashClip('c1', { username: 'alice' });
    expect(table.find((r) => r.id === 'c1')!.deletedAt).toBeInstanceOf(Date);
    expect(inClips('shared.mp4')).toBe(true);
  });

  it('expiry trashes finished clips past the cutoff, keeps Legal Hold, in-progress, recent and already-trashed ones, and audits once', async () => {
    const old = new Date(NOW.getTime() - 100 * DAY);
    const table = fakeClips([
      { id: 'old', createdAt: old, filePath: file('old.mp4') },
      { id: 'old-failed', createdAt: old, status: 'FAILED' },
      { id: 'old-held', createdAt: old, legalHold: true, filePath: file('held.mp4') },
      { id: 'old-running', createdAt: old, status: 'PROCESSING' },
      { id: 'recent', createdAt: new Date(NOW.getTime() - 10 * DAY), filePath: file('recent.mp4') },
    ]);
    const result = await deleteExpiredClips(90, NOW);
    expect(result).toEqual({ deleted: 2, skippedLegalHold: 1, errors: 0 });
    expect(table.filter((r) => r.deletedAt).map((r) => r.id).sort()).toEqual(['old', 'old-failed']);
    expect(table.find((r) => r.id === 'old')!.deletedBy).toBe('system:clips_retention_days');
    expect(table).toHaveLength(5); // nothing deleted for good
    expect(inQuarantine('old.mp4')).toBe(true);
    expect(inClips('held.mp4')).toBe(true);
    expect(inClips('recent.mp4')).toBe(true);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createAuditLog).mock.calls[0][0]).toMatchObject({ action: 'clips_expired_trashed' });
  });

  it('0 days keeps every clip', async () => {
    const table = fakeClips([{ id: 'old', createdAt: new Date(0) }]);
    expect(await deleteExpiredClips(0, NOW)).toEqual({ deleted: 0, skippedLegalHold: 0, errors: 0 });
    expect(table[0].deletedAt).toBeNull();
  });

  it('purge deletes for good only what sat in the trash past the grace period, never a clip held while there', async () => {
    const table = fakeClips([
      { id: 'long-gone', filePath: '/recordings/clips/gone.mp4', deletedAt: new Date(NOW.getTime() - 8 * DAY) },
      { id: 'just-trashed', filePath: '/recordings/clips/recent.mp4', deletedAt: new Date(NOW.getTime() - 1 * DAY) },
      { id: 'held-in-trash', filePath: '/recordings/clips/held.mp4', deletedAt: new Date(NOW.getTime() - 30 * DAY), legalHold: true },
      { id: 'live', filePath: file('live.mp4') },
    ]);
    fs.mkdirSync(clipQuarantineDir(), { recursive: true });
    for (const n of ['gone.mp4', 'recent.mp4', 'held.mp4']) fs.writeFileSync(path.join(clipQuarantineDir(), n), 'mp4');

    expect(await purgeTrashedClips(7, NOW)).toEqual({ purged: 1, errors: 0 });
    expect(table.map((r) => r.id).sort()).toEqual(['held-in-trash', 'just-trashed', 'live']);
    expect(inQuarantine('gone.mp4')).toBe(false);
    expect(inQuarantine('recent.mp4')).toBe(true);
    expect(inQuarantine('held.mp4')).toBe(true);
    expect(inClips('live.mp4')).toBe(true);
    expect(vi.mocked(createAuditLog).mock.calls[0][0]).toMatchObject({ action: 'clip_purge' });
  });
});
