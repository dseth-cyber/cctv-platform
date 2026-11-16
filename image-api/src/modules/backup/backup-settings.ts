import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { getAllConfigs } from '../system-config/system-config.service.js';

/**
 * Where database backups can go. The app never mounts a disk itself: a destination is a folder the deployment
 * already mounted into this container (docker-compose.prod.yml), and the web page only picks between them.
 *  - internal: the backup-data volume (on the system disk)
 *  - external: BACKUP_EXTERNAL_DIR, e.g. a separate HDD mounted from BACKUP_HOST_DIR on the host
 */
export type BackupDestinationId = 'internal' | 'external';

export interface BackupDestination {
  id: BackupDestinationId;
  dir: string;
  /** What the person sees: the path on the host when known, not the path inside the container. */
  hostPath: string;
}

export function internalBackupDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
}

export function backupDestinations(): BackupDestination[] {
  const list: BackupDestination[] = [{ id: 'internal', dir: internalBackupDir(), hostPath: 'volume backup-data' }];
  const ext = process.env.BACKUP_EXTERNAL_DIR;
  if (ext) list.push({ id: 'external', dir: ext, hostPath: process.env.BACKUP_HOST_DIR || ext });
  return list;
}

/** A destination is usable when its folder exists and this process can write to it. */
export function destinationWritable(dir: string): boolean {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** The time zone the backup time is read in (the factory's local time). */
export function backupTimeZone(): string {
  return process.env.APP_TIME_ZONE || 'Asia/Bangkok';
}

export interface BackupSettings {
  enabled: boolean;
  /** HH:MM in backupTimeZone() */
  time: string;
  keepDays: number;
  destination: BackupDestinationId;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MIN_KEEP_NEWEST = 3;

export const backupSettingsSchema = z.object({
  enabled: z.boolean(),
  time: z.string().regex(TIME_RE, 'time must be HH:MM'),
  keepDays: z.number().int().min(1).max(365),
  destination: z.enum(['internal', 'external']),
});

/** Saved values, falling back to the defaults; a bad stored value never stops backups (it falls back too). */
export async function getBackupSettings(): Promise<BackupSettings> {
  const c = await getAllConfigs();
  const time = String(c.backup_time?.value ?? '03:00');
  const keepDays = Number(c.backup_keep_days?.value ?? 14);
  const wanted = String(c.backup_destination?.value ?? '');
  const ids = backupDestinations().map((d) => d.id);
  const destination: BackupDestinationId = (ids as string[]).includes(wanted)
    ? (wanted as BackupDestinationId)
    : ids.includes('external') ? 'external' : 'internal';
  return {
    enabled: c.backup_enabled?.value !== false && c.backup_enabled?.value !== 'false',
    time: TIME_RE.test(time) ? time : '03:00',
    keepDays: Number.isInteger(keepDays) && keepDays >= 1 && keepDays <= 365 ? keepDays : 14,
    destination,
  };
}

export class BackupSettingsError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function saveBackupSettings(input: unknown): Promise<BackupSettings> {
  const parsed = backupSettingsSchema.parse(input);
  const dest = backupDestinations().find((d) => d.id === parsed.destination);
  if (!dest) throw new BackupSettingsError('DESTINATION_NOT_MOUNTED', 'This destination is not mounted on this server');
  if (!destinationWritable(dest.dir)) throw new BackupSettingsError('DESTINATION_NOT_WRITABLE', 'The system cannot write to this destination');
  const prisma = getPrisma();
  const rows: Array<[string, string, string]> = [
    ['backup_enabled', String(parsed.enabled), 'boolean'],
    ['backup_time', parsed.time, 'string'],
    ['backup_keep_days', String(parsed.keepDays), 'number'],
    ['backup_destination', parsed.destination, 'string'],
  ];
  for (const [key, value, valueType] of rows) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value, valueType, category: 'backup', description: `Database backup setting (${key})` },
    });
  }
  return getBackupSettings();
}

/** "HH:MM" and "YYYY-MM-DD" of a moment in the given time zone. */
export function localClock(now: Date, timeZone: string): { hhmm: string; day: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const hour = parts.hour === '24' ? '00' : parts.hour;
  return { hhmm: `${hour}:${parts.minute}`, day: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Backup files this app writes (old plain-SQL name and the current custom-format name). Nothing else is touched. */
export const APP_BACKUP_FILE = /^(pg_dump_.+\.sql\.gz|cctv-db-.+\.dump)$/;

export interface PruneResult { deleted: string[]; kept: number }

/**
 * Deletes this app's backup files older than keepDays in one folder, but always keeps the newest MIN_KEEP_NEWEST,
 * so a stopped schedule can never age every backup away. Files the app did not write (e.g. a host cron's dumps)
 * are never touched.
 */
export function pruneBackupFiles(dir: string, keepDays: number, now = new Date()): PruneResult {
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((n) => APP_BACKUP_FILE.test(n));
  } catch {
    return { deleted: [], kept: 0 };
  }
  const files = names
    .map((n) => ({ name: n, full: path.join(dir, n), mtime: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  const cutoff = now.getTime() - keepDays * 86_400_000;
  const deleted: string[] = [];
  files.forEach((f, i) => {
    if (i < MIN_KEEP_NEWEST || f.mtime >= cutoff) return;
    fs.rmSync(f.full, { force: true });
    deleted.push(f.full);
  });
  return { deleted, kept: files.length - deleted.length };
}
