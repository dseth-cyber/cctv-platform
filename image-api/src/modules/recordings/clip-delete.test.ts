import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { createAuditLog } from '../audit/audit.service.js';
import { deleteClip, deleteExpiredClips, ClipCancelError } from './clip-cancel.js';

vi.mock('../audit/audit.service.js', () => ({ createAuditLog: vi.fn().mockResolvedValue({}) }));
vi.mock('../device-playback/device-playback.service.js', () => ({ cancelDeviceClip: vi.fn().mockResolvedValue(false) }));
vi.mock('./export-queue.js', () => ({ defaultExportQueue: { cancel: vi.fn().mockResolvedValue(true) } }));

const DAY = 86_400_000;
const NOW = new Date('2026-11-14T00:00:00Z');

/** A tiny in-memory recording_clips table: enough of Prisma for the delete paths. */
function fakeClips(rows: any[]) {
  const table = rows.map((r) => ({ legalHold: false, filePath: null, exportedBy: 'alice', status: 'COMPLETED', ...r }));
  const matches = (row: any, where: any = {}) => Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('lt' in v) return row[k] < v.lt;
      if ('notIn' in v) return !v.notIn.includes(row[k]);
      if ('not' in v) return row[k] !== v.not;
    }
    return row[k] === v;
  });
  const recordingClip = {
    findUnique: vi.fn(async ({ where }: any) => table.find((r) => r.id === where.id) ?? null),
    findMany: vi.fn(async ({ where }: any) => table.filter((r) => matches(r, where))),
    count: vi.fn(async ({ where }: any) => table.filter((r) => matches(r, where)).length),
    deleteMany: vi.fn(async ({ where }: any) => {
      const hit = table.filter((r) => matches(r, where));
      for (const h of hit) table.splice(table.indexOf(h), 1);
      return { count: hit.length };
    }),
  };
  vi.mocked(getPrisma).mockReturnValue({ recordingClip } as any);
  return table;
}

describe('Evidence clip delete and expiry', () => {
  let root: string;
  let clipsDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-clips-'));
    process.env.RECORDINGS_DIR = root;
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

  it('the person who asked for a finished clip deletes it with its file', async () => {
    const table = fakeClips([{ id: 'c1', filePath: file('a.mp4') }]);
    const out = await deleteClip('c1', { username: 'alice', role: 'operator' });
    expect(out.cancelled).toBe(false);
    expect(table).toHaveLength(0);
    expect(fs.existsSync(path.join(clipsDir, 'a.mp4'))).toBe(false);
  });

  it('an administrator may delete anyone\'s clip; another operator may not', async () => {
    fakeClips([{ id: 'c1', filePath: file('a.mp4') }]);
    await expect(deleteClip('c1', { username: 'bob', role: 'operator' })).rejects.toMatchObject({ code: 'NOT_YOURS', statusCode: 403 });
    expect(fs.existsSync(path.join(clipsDir, 'a.mp4'))).toBe(true);
    expect((await deleteClip('c1', { username: 'root', role: 'admin' })).cancelled).toBe(false);
  });

  it('a clip on Legal Hold is never deleted, even by an administrator', async () => {
    const table = fakeClips([{ id: 'c1', filePath: file('a.mp4'), legalHold: true }]);
    const err = await deleteClip('c1', { username: 'root', role: 'admin' }).catch((e) => e);
    expect(err).toBeInstanceOf(ClipCancelError);
    expect(err.code).toBe('LEGAL_HOLD');
    expect(table).toHaveLength(1);
    expect(fs.existsSync(path.join(clipsDir, 'a.mp4'))).toBe(true);
  });

  it('a file another clip still uses stays on disk', async () => {
    const shared = file('shared.mp4');
    const table = fakeClips([{ id: 'c1', filePath: shared }, { id: 'c2', filePath: shared }]);
    await deleteClip('c1', { username: 'alice' });
    expect(table.map((r) => r.id)).toEqual(['c2']);
    expect(fs.existsSync(path.join(clipsDir, 'shared.mp4'))).toBe(true);
  });

  it('a clip still being made is cancelled, not reported as deleted', async () => {
    const table = fakeClips([{ id: 'c1', status: 'PROCESSING' }]);
    const out = await deleteClip('c1', { username: 'alice' });
    expect(out.cancelled).toBe(true);
    expect(table).toHaveLength(0);
  });

  it('expiry deletes finished clips past the cutoff, keeps Legal Hold, in-progress and recent ones, and audits once', async () => {
    const old = new Date(NOW.getTime() - 100 * DAY);
    const table = fakeClips([
      { id: 'old', createdAt: old, filePath: file('old.mp4'), title: 'old' },
      { id: 'old-failed', createdAt: old, status: 'FAILED', title: 'failed' },
      { id: 'old-held', createdAt: old, legalHold: true, filePath: file('held.mp4') },
      { id: 'old-running', createdAt: old, status: 'PROCESSING' },
      { id: 'recent', createdAt: new Date(NOW.getTime() - 10 * DAY), filePath: file('recent.mp4') },
    ]);
    const result = await deleteExpiredClips(90, NOW);
    expect(result).toEqual({ deleted: 2, skippedLegalHold: 1, errors: 0 });
    expect(table.map((r) => r.id).sort()).toEqual(['old-held', 'old-running', 'recent']);
    expect(fs.existsSync(path.join(clipsDir, 'old.mp4'))).toBe(false);
    expect(fs.existsSync(path.join(clipsDir, 'held.mp4'))).toBe(true);
    expect(fs.existsSync(path.join(clipsDir, 'recent.mp4'))).toBe(true);
    expect(createAuditLog).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createAuditLog).mock.calls[0][0]).toMatchObject({ action: 'clips_expired_deleted' });
  });

  it('0 days keeps every clip', async () => {
    const table = fakeClips([{ id: 'old', createdAt: new Date(0) }]);
    expect(await deleteExpiredClips(0, NOW)).toEqual({ deleted: 0, skippedLegalHold: 0, errors: 0 });
    expect(table).toHaveLength(1);
    expect(getPrisma).not.toHaveBeenCalled();
  });
});
