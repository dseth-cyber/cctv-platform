import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { getPrisma } from '../../lib/prisma.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { getBackupSettings, localClock, pruneBackupFiles, saveBackupSettings, MIN_KEEP_NEWEST } from './backup-settings.js';
import { backupTick, resetBackupTick } from './backup-scheduler.js';
import { runDatabaseBackup, scanSqlDump } from './backup.service.js';

vi.mock('../system-config/system-config.service.js', () => ({ getAllConfigs: vi.fn() }));
vi.mock('./backup.service.js', async (orig) => ({ ...(await orig<any>()), runDatabaseBackup: vi.fn().mockResolvedValue({ id: 'b', status: 'completed' }) }));
vi.mock('../alerts/alerts.service.js', () => ({ createAlert: vi.fn().mockResolvedValue({}) }));
vi.mock('../audit/audit.service.js', () => ({ createAuditLog: vi.fn().mockResolvedValue({}) }));

const DAY = 86_400_000;
const cfg = (v: Record<string, any>) => vi.mocked(getAllConfigs).mockResolvedValue(Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value }])));

describe('backup settings', () => {
  let root: string;
  beforeEach(() => {
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cctv-backup-'));
    process.env.BACKUP_DIR = path.join(root, 'internal');
    fs.mkdirSync(process.env.BACKUP_DIR);
    delete process.env.BACKUP_EXTERNAL_DIR;
    resetBackupTick();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    delete process.env.BACKUP_DIR;
    delete process.env.BACKUP_EXTERNAL_DIR;
  });

  it('defaults: on, 03:00, 14 days, the separate disk when it is mounted (else the system disk)', async () => {
    cfg({});
    expect(await getBackupSettings()).toEqual({ enabled: true, time: '03:00', keepDays: 14, destination: 'internal' });
    process.env.BACKUP_EXTERNAL_DIR = root;
    expect((await getBackupSettings()).destination).toBe('external');
  });

  it('a bad stored value falls back instead of stopping backups', async () => {
    cfg({ backup_time: '25:99', backup_keep_days: 0, backup_destination: 'external', backup_enabled: false });
    expect(await getBackupSettings()).toEqual({ enabled: false, time: '03:00', keepDays: 14, destination: 'internal' });
  });

  it('refuses a destination that is not mounted, and bad values', async () => {
    const upsert = vi.fn();
    vi.mocked(getPrisma).mockReturnValue({ systemConfig: { upsert } } as any);
    await expect(saveBackupSettings({ enabled: true, time: '02:30', keepDays: 14, destination: 'external' })).rejects.toMatchObject({ code: 'DESTINATION_NOT_MOUNTED' });
    await expect(saveBackupSettings({ enabled: true, time: '2:30', keepDays: 14, destination: 'internal' })).rejects.toThrow();
    await expect(saveBackupSettings({ enabled: true, time: '02:30', keepDays: 0, destination: 'internal' })).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
    cfg({ backup_time: '02:30' });
    await saveBackupSettings({ enabled: true, time: '02:30', keepDays: 30, destination: 'internal' });
    expect(upsert).toHaveBeenCalledTimes(4);
  });

  it('local clock is read in the factory time zone', () => {
    expect(localClock(new Date('2026-11-15T19:30:00Z'), 'Asia/Bangkok')).toEqual({ hhmm: '02:30', day: '2026-11-16' });
  });

  it('prune removes only this app\'s files past the keep period, and always keeps the newest few', () => {
    const dir = process.env.BACKUP_DIR!;
    const now = Date.now();
    const make = (name: string, ageDays: number) => {
      const f = path.join(dir, name);
      fs.writeFileSync(f, 'x');
      const t = new Date(now - ageDays * DAY);
      fs.utimesSync(f, t, t);
    };
    for (let i = 0; i < 6; i++) make(`pg_dump_old-${i}.sql.gz`, 20 + i);
    make('pg_dump_new.sql.gz', 1);
    make('cctv-2026-11-01-before-rc3.dump', 40); // a host cron's dump: never ours to delete
    const r = pruneBackupFiles(dir, 14, new Date(now));
    const left = fs.readdirSync(dir).sort();
    expect(left).toContain('cctv-2026-11-01-before-rc3.dump');
    expect(left).toContain('pg_dump_new.sql.gz');
    expect(left.filter((n) => n.startsWith('pg_dump_')).length).toBe(MIN_KEEP_NEWEST);
    expect(r.deleted).toHaveLength(4);

    // Even when every backup is old (schedule stopped for weeks), the newest few stay.
    const r2 = pruneBackupFiles(dir, 1, new Date(now + 100 * DAY));
    expect(r2.deleted).toHaveLength(0);
  });

  it('the schedule runs once at the set local time, not before, not twice, not when off', async () => {
    cfg({ backup_time: '02:30' });
    expect(await backupTick(new Date('2026-11-15T19:29:00Z'))).toBe(false); // 02:29 Bangkok
    expect(await backupTick(new Date('2026-11-15T19:30:00Z'))).toBe(true);
    expect(await backupTick(new Date('2026-11-15T19:30:30Z'))).toBe(false); // same day
    expect(runDatabaseBackup).toHaveBeenCalledTimes(1);
    expect(runDatabaseBackup).toHaveBeenCalledWith({ trigger: 'schedule' });
    expect(await backupTick(new Date('2026-11-16T19:30:00Z'))).toBe(true); // next day
    cfg({ backup_time: '02:30', backup_enabled: false });
    expect(await backupTick(new Date('2026-11-17T19:30:00Z'))).toBe(false);
  });

  it('the file check reads a dump to the end and counts tables, and rejects a cut-off file', async () => {
    const sql = 'SET x;\nCREATE TABLE public.devices (id uuid);\nCOPY public.devices (id) FROM stdin;\n\\.\nCREATE TABLE public.cameras (id uuid);\n';
    const good = path.join(root, 'good.sql.gz');
    fs.writeFileSync(good, zlib.gzipSync(sql));
    expect(await scanSqlDump(good)).toEqual({ tables: 2, dataSections: 1 });
    const cut = path.join(root, 'cut.sql.gz');
    const buf = zlib.gzipSync(sql.repeat(200));
    fs.writeFileSync(cut, buf.subarray(0, Math.floor(buf.length / 2)));
    await expect(scanSqlDump(cut)).rejects.toThrow();
  });
});
