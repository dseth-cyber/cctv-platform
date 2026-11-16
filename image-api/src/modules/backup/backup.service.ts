import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import { createAlert } from '../alerts/alerts.service.js';
import { createAuditLog } from '../audit/audit.service.js';
import { APP_BACKUP_FILE, STORAGE_BACKUP_FILE, backupDestinations, destinationWritable, getBackupSettings, pruneBackupFiles } from './backup-settings.js';
import { execFileSync } from 'child_process';
import * as zlib from 'zlib';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';


/**
 * One database backup into the destination chosen on the backup page (default: the separate backup disk when it
 * is mounted). Plain SQL, gzip: psql of any PostgreSQL version restores it (the image's pg_dump is newer than the
 * server, and a custom-format archive would not open in the server's own pg_restore). After a good backup, this
 * app's files older than the keep period are removed there (the newest few always stay). A destination that is
 * not there or not writable fails the backup, visibly: no fallback to another disk.
 */
export async function runDatabaseBackup(options?: { trigger?: 'schedule' | 'manual' }): Promise<{ id: string; status: string; filePath?: string }> {
  const prisma = getPrisma();
  const settings = await getBackupSettings();
  const dest = backupDestinations().find((d) => d.id === settings.destination) ?? backupDestinations()[0];

  const record = await prisma.backupRecord.create({
    data: { type: 'database', status: 'running', metadata: { destination: dest.id, hostPath: dest.hostPath, trigger: options?.trigger ?? 'manual' } },
  });

  try {
    if (dest.id === 'internal') fs.mkdirSync(dest.dir, { recursive: true });
    if (!destinationWritable(dest.dir)) throw new Error(`Backup destination ${dest.hostPath} is not mounted or not writable`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(dest.dir, `pg_dump_${timestamp}.sql.gz`);

    const dbUrl = new URL(config.database.url);
    execFileSync('pg_dump', [
      `--host=${dbUrl.hostname}`,
      `--port=${dbUrl.port || 5432}`,
      `--username=${decodeURIComponent(dbUrl.username)}`,
      `--dbname=${dbUrl.pathname.slice(1)}`,
      '--no-owner',
      '--no-acl',
      '--compress=9',
      `--file=${filePath}`,
    ], {
      env: { ...process.env, PGPASSWORD: decodeURIComponent(dbUrl.password) },
      stdio: 'pipe',
      timeout: 300_000,
    });

    const stats = fs.statSync(filePath);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

    await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: 'completed', filePath, fileSize: BigInt(stats.size), checksum, completedAt: new Date() },
    });
    logger.info({ destination: dest.id, size: stats.size }, 'Database backup completed');

    await pruneOldBackups(dest.dir, settings.keepDays);
    return { id: record.id, status: 'completed', filePath };
  } catch (err: any) {
    const raw = String(err?.stderr?.toString?.() || err?.message || err);
    const friendlyMsg = raw.includes('ENOENT') && raw.includes('pg_dump')
      ? 'pg_dump not installed in container'
      : raw.includes('connection refused')
      ? 'Cannot connect to database'
      : raw.split('\n')[0].slice(0, 500);
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: 'failed', errorMessage: friendlyMsg, completedAt: new Date() },
    });
    logger.error({ err: friendlyMsg, destination: dest.id }, 'Database backup failed');
    await createAlert({
      alertType: 'storage_warning',
      severity: 'critical',
      source: 'backup_scheduler',
      title: 'Database Backup Failed',
      message: `The database backup to ${dest.hostPath} failed: ${friendlyMsg}`,
      details: { destination: dest.id, hostPath: dest.hostPath, backupRecordId: record.id },
    }).catch(() => {});
    return { id: record.id, status: 'failed' };
  }
}

/** Removes this app's backups past the keep period in one folder, marks their records expired, writes the audit log. */
async function pruneOldBackups(dir: string, keepDays: number, pattern = APP_BACKUP_FILE) {
  try {
    const { deleted } = pruneBackupFiles(dir, keepDays, new Date(), pattern);
    if (deleted.length === 0) return;
    const prisma = getPrisma();
    await prisma.backupRecord.updateMany({ where: { filePath: { in: deleted } }, data: { status: 'expired' } });
    await createAuditLog({
      action: 'backup_pruned',
      entity: 'backup',
      description: `${deleted.length} database backup file(s) older than ${keepDays} days removed`,
      metadata: { keepDays, files: deleted.map((f) => path.basename(f)) },
    }).catch(() => {});
    logger.info({ removed: deleted.length, keepDays }, 'Old database backups removed');
  } catch (err) {
    logger.warn({ err }, 'Could not remove old database backups');
  }
}

/**
 * Backs up the files in the default storage provider (the local disk since MinIO left) into the destination chosen
 * on the backup page, as one gzip stream: per file a line "<key>\t<bytes>\n" then the bytes. Streamed, never held in
 * memory whole. CCTV keeps no files there today, so most runs find none: that is recorded as `skipped` with no file
 * written, never as a 0-byte "completed" backup. A destination that is not there fails, visibly.
 */
export async function runStorageBackup(): Promise<{ id: string; status: string; filePath?: string; message?: string }> {
  const prisma = getPrisma();
  const settings = await getBackupSettings();
  const dest = backupDestinations().find((d) => d.id === settings.destination) ?? backupDestinations()[0];
  const record = await prisma.backupRecord.create({
    data: { type: 'storage', status: 'running', metadata: { destination: dest.id, hostPath: dest.hostPath } },
  });

  let filePath: string | null = null;
  try {
    if (dest.id === 'internal') fs.mkdirSync(dest.dir, { recursive: true });
    if (!destinationWritable(dest.dir)) throw new Error(`Backup destination ${dest.hostPath} is not mounted or not writable`);

    const provider = storageRouter.getDefault();
    const keys: string[] = [];
    for await (const key of provider.list()) keys.push(key);
    if (keys.length === 0) {
      const message = 'Nothing to back up: the storage has no files';
      await prisma.backupRecord.update({ where: { id: record.id }, data: { status: 'skipped', errorMessage: message, completedAt: new Date() } });
      logger.info({ destination: dest.id }, 'Storage backup skipped: no files');
      return { id: record.id, status: 'skipped', message };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    filePath = path.join(dest.dir, `storage_backup_${timestamp}.bin.gz`);
    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(filePath);
    const done = new Promise<void>((resolve, reject) => {
      out.on('finish', () => resolve());
      out.on('error', reject);
      gzip.on('error', reject);
    });
    gzip.pipe(out);
    const write = (chunk: Buffer | string) => new Promise<void>((resolve) => { if (gzip.write(chunk)) resolve(); else gzip.once('drain', () => resolve()); });
    for (const key of keys) {
      const data = await provider.getBuffer(key);
      await write(`${key}\t${data.length}\n`);
      await write(data);
    }
    gzip.end();
    await done;

    const checksum = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    const size = fs.statSync(filePath).size;
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: 'completed', filePath, fileSize: BigInt(size), checksum, completedAt: new Date(), metadata: { destination: dest.id, hostPath: dest.hostPath, objects: keys.length } },
    });
    logger.info({ destination: dest.id, size, objects: keys.length }, 'Storage backup completed');
    await pruneOldBackups(dest.dir, settings.keepDays, STORAGE_BACKUP_FILE);
    return { id: record.id, status: 'completed', filePath };
  } catch (err: any) {
    if (filePath) fs.rmSync(filePath, { force: true });
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: 'failed', errorMessage: String(err?.message || err).slice(0, 500), completedAt: new Date() },
    });
    logger.error({ err: err?.message, destination: dest.id }, 'Storage backup failed');
    return { id: record.id, status: 'failed' };
  }
}

/**
 * Checks that a backup file is whole and holds the database: the gzip stream reads to the end and the dump
 * creates tables and loads their data. Not a full restore (that is the drill in DEPLOY_PRODUCTION.md step 8,
 * which also checks the encrypted values with verify-secrets).
 */
export async function runRestoreTest(backupRecordId: string): Promise<{ success: boolean; message: string }> {
  const prisma = getPrisma();
  const record = await prisma.backupRecord.findUnique({ where: { id: backupRecordId } });
  if (!record || record.status !== 'completed' || !record.filePath) {
    return { success: false, message: 'Backup record not found or not completed' };
  }
  if (record.type !== 'database') {
    return fs.existsSync(record.filePath)
      ? { success: true, message: 'Backup file exists and is accessible' }
      : { success: false, message: 'Backup file is missing' };
  }
  try {
    const counts = await scanSqlDump(record.filePath);
    if (record.checksum) {
      const sum = crypto.createHash('sha256').update(fs.readFileSync(record.filePath)).digest('hex');
      if (sum !== record.checksum) return { success: false, message: 'Checksum does not match: the file changed after the backup' };
    }
    if (counts.tables === 0) return { success: false, message: 'The file reads, but it creates no tables' };
    logger.info(counts, 'Backup file check passed');
    return { success: true, message: `File complete: ${counts.tables} tables, ${counts.dataSections} with data (checksum ok). Full restore drill: runbook step 8` };
  } catch (err: any) {
    logger.error({ err: err?.message }, 'Backup file check failed');
    return { success: false, message: `Backup file is damaged or unreadable: ${String(err?.message || err).slice(0, 200)}` };
  }
}

/** Streams a gzip SQL dump to the end, counting CREATE TABLE and COPY ... FROM stdin sections. */
export function scanSqlDump(file: string): Promise<{ tables: number; dataSections: number }> {
  return new Promise((resolve, reject) => {
    let tables = 0;
    let dataSections = 0;
    let tail = '';
    const gunzip = zlib.createGunzip();
    gunzip.on('data', (chunk: Buffer) => {
      const text = tail + chunk.toString('utf8');
      const lines = text.split('\n');
      tail = lines.pop() ?? '';
      for (const line of lines) {
        if (line.startsWith('CREATE TABLE ')) tables++;
        else if (line.startsWith('COPY ') && line.endsWith('FROM stdin;')) dataSections++;
      }
    });
    gunzip.on('end', () => resolve({ tables, dataSections }));
    gunzip.on('error', reject);
    const input = fs.createReadStream(file);
    input.on('error', reject);
    input.pipe(gunzip);
  });
}

export async function getBackupStatus() {
  const prisma = getPrisma();

  const [latestDb, latestStorage, stats] = await Promise.all([
    prisma.backupRecord.findFirst({
      where: { type: 'database' },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.backupRecord.findFirst({
      where: { type: { in: ['storage', 'minio'] } },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.backupRecord.groupBy({
      by: ['type', 'status'],
      _count: { id: true },
    }),
  ]);

  const byType: Record<string, { total: number; completed: number; failed: number; running: number }> = {};
  for (const s of stats) {
    if (!byType[s.type]) byType[s.type] = { total: 0, completed: 0, failed: 0, running: 0 };
    byType[s.type].total += s._count.id;
    if (s.status === 'completed') byType[s.type].completed += s._count.id;
    else if (s.status === 'failed') byType[s.type].failed += s._count.id;
    else if (s.status === 'running') byType[s.type].running += s._count.id;
  }

  return {
    database: latestDb ? {
      id: latestDb.id,
      status: latestDb.status,
      filePath: latestDb.filePath,
      fileSize: latestDb.fileSize ? Number(latestDb.fileSize) : null,
      startedAt: latestDb.startedAt.toISOString(),
      completedAt: latestDb.completedAt?.toISOString() ?? null,
      errorMessage: latestDb.errorMessage,
    } : null,
    storage: latestStorage ? {
      id: latestStorage.id,
      status: latestStorage.status,
      filePath: latestStorage.filePath,
      fileSize: latestStorage.fileSize ? Number(latestStorage.fileSize) : null,
      startedAt: latestStorage.startedAt.toISOString(),
      completedAt: latestStorage.completedAt?.toISOString() ?? null,
      errorMessage: latestStorage.errorMessage,
    } : null,
    byType,
  };
}

export async function listBackupRecords(params: { page?: number; limit?: number; type?: string }) {
  const prisma = getPrisma();
  const { page = 1, limit = 50, type } = params;

  const where: Record<string, any> = {};
  if (type) where.type = type;

  const [total, rows] = await Promise.all([
    prisma.backupRecord.count({ where }),
    prisma.backupRecord.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    data: rows.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      filePath: r.filePath,
      fileSize: r.fileSize ? Number(r.fileSize) : null,
      checksum: r.checksum,
      startedAt: r.startedAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      errorMessage: r.errorMessage,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
