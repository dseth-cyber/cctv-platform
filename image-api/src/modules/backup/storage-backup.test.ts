import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { getPrisma } from '../../lib/prisma.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import { correctEmptyCompletedBackups, runStorageBackup } from './backup.service.js';
import { pruneBackupFiles, STORAGE_BACKUP_FILE } from './backup-settings.js';

vi.mock('../system-config/system-config.service.js', () => ({ getAllConfigs: vi.fn() }));
vi.mock('../alerts/alerts.service.js', () => ({ createAlert: vi.fn().mockResolvedValue({}) }));
vi.mock('../audit/audit.service.js', () => ({ createAuditLog: vi.fn().mockResolvedValue({}) }));

describe('storage backup (bug from #005: 0-byte "completed" file on the system volume)', () => {
  let root: string;
  let updates: any[];
  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-sbk-'));
    process.env.BACKUP_DIR = path.join(root, 'internal');
    process.env.BACKUP_EXTERNAL_DIR = path.join(root, 'external');
    fs.mkdirSync(process.env.BACKUP_DIR);
    fs.mkdirSync(process.env.BACKUP_EXTERNAL_DIR);
    vi.mocked(getAllConfigs).mockResolvedValue({ backup_destination: { value: 'external' } } as any);
    updates = [];
    vi.mocked(getPrisma).mockReturnValue({
      backupRecord: {
        create: vi.fn().mockResolvedValue({ id: 'rec' }),
        update: vi.fn(async ({ data }: any) => { updates.push(data); return data; }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as any);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_EXTERNAL_DIR;
  });

  const provider = (files: Record<string, string>) => vi.spyOn(storageRouter, 'getDefault').mockReturnValue({
    async *list() { yield* Object.keys(files); },
    getBuffer: async (k: string) => Buffer.from(files[k]),
  } as any);

  it('no files: recorded as skipped, no file written anywhere', async () => {
    provider({});
    const r = await runStorageBackup();
    expect(r.status).toBe('skipped');
    expect(updates.at(-1)).toMatchObject({ status: 'skipped' });
    expect(fs.readdirSync(process.env.BACKUP_DIR!)).toEqual([]);
    expect(fs.readdirSync(process.env.BACKUP_EXTERNAL_DIR!)).toEqual([]);
  });

  it('files: one real gzip in the chosen destination, not the system volume', async () => {
    provider({ 'a.jpg': 'AAA', 'dir/b.png': 'BBBBB' });
    const r = await runStorageBackup();
    expect(r.status).toBe('completed');
    expect(r.filePath!.startsWith(process.env.BACKUP_EXTERNAL_DIR!)).toBe(true);
    expect(fs.readdirSync(process.env.BACKUP_DIR!)).toEqual([]);
    const text = zlib.gunzipSync(fs.readFileSync(r.filePath!)).toString();
    expect(text).toBe('a.jpg\t3\nAAAdir/b.png\t5\nBBBBB');
    expect(updates.at(-1)).toMatchObject({ status: 'completed' });
    expect(Number(updates.at(-1).fileSize)).toBeGreaterThan(0);
  });

  it('a destination that is not there fails, without falling back to another disk', async () => {
    fs.rmSync(process.env.BACKUP_EXTERNAL_DIR!, { recursive: true });
    provider({ 'a.jpg': 'AAA' });
    const r = await runStorageBackup();
    expect(r.status).toBe('failed');
    expect(fs.readdirSync(process.env.BACKUP_DIR!)).toEqual([]);
  });

  it('storage and database backups are pruned separately', () => {
    const dir = process.env.BACKUP_DIR!;
    const old = new Date(Date.now() - 40 * 86_400_000);
    for (let i = 0; i < 5; i++) {
      for (const n of [`storage_backup_${i}.bin.gz`, `pg_dump_${i}.sql.gz`]) {
        fs.writeFileSync(path.join(dir, n), 'x');
        fs.utimesSync(path.join(dir, n), old, old);
      }
    }
    pruneBackupFiles(dir, 14, new Date(), STORAGE_BACKUP_FILE);
    const left = fs.readdirSync(dir);
    expect(left.filter((n) => n.startsWith('storage_backup_'))).toHaveLength(3);
    expect(left.filter((n) => n.startsWith('pg_dump_'))).toHaveLength(5);
  });

  it('startup puts right the empty backups old versions called completed, and only those', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    vi.mocked(getPrisma).mockReturnValue({ backupRecord: { updateMany } } as any);
    expect(await correctEmptyCompletedBackups()).toBe(3);
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: { status: 'completed', OR: [{ fileSize: BigInt(0) }, { fileSize: null }] },
      data: { status: 'failed' },
    });
  });
});
