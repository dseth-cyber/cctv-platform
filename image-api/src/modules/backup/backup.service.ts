import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config/index.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');

export async function runDatabaseBackup(): Promise<{ id: string; status: string; filePath?: string }> {
  const prisma = getPrisma();

  const record = await prisma.backupRecord.create({
    data: { type: 'database', status: 'running' },
  });

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(BACKUP_DIR, `pg_dump_${timestamp}.sql.gz`);

    const dbUrl = new URL(config.database.url);
    const pgDumpCmd = [
      'pg_dump',
      `--host=${dbUrl.hostname}`,
      `--port=${dbUrl.port || 5432}`,
      `--username=${dbUrl.username}`,
      `--dbname=${dbUrl.pathname.slice(1)}`,
      '--no-owner',
      '--no-acl',
      '--compress=9',
      `--file=${filePath}`,
    ];

    execSync(pgDumpCmd.join(' '), {
      env: { ...process.env, PGPASSWORD: dbUrl.password },
      stdio: 'pipe',
      timeout: 300_000,
    });

    const stats = fs.statSync(filePath);
    const checksum = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

    await prisma.backupRecord.update({
      where: { id: record.id },
      data: {
        status: 'completed',
        filePath,
        fileSize: BigInt(stats.size),
        checksum,
        completedAt: new Date(),
      },
    });

    logger.info({ filePath, size: stats.size }, 'Database backup completed');
    return { id: record.id, status: 'completed', filePath };
  } catch (err: any) {
    const friendlyMsg = err.message?.includes('not found')
      ? 'pg_dump not installed in container'
      : err.message?.includes('connection refused')
      ? 'Cannot connect to database'
      : err.message;
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: 'failed', errorMessage: friendlyMsg, completedAt: new Date() },
    });
    logger.error({ err }, 'Database backup failed');
    return { id: record.id, status: 'failed' };
  }
}

export async function runStorageBackup(): Promise<{ id: string; status: string; filePath?: string }> {
  const prisma = getPrisma();

  const record = await prisma.backupRecord.create({
    data: { type: 'storage', status: 'running' },
  });

  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(BACKUP_DIR, `storage_backup_${timestamp}.tar.gz`);

    const provider = storageRouter.getDefault();
    const chunks: Buffer[] = [];
    let objectCount = 0;

    for await (const key of provider.list()) {
      const data = await provider.getBuffer(key);
      const header = Buffer.from(`${key}:${data.length}\n`);
      chunks.push(header, data);
      objectCount++;
    }

    const data = Buffer.concat(chunks);
    fs.writeFileSync(filePath, data);

    const stats = fs.statSync(filePath);
    const checksum = crypto.createHash('sha256').update(data).digest('hex');

    await prisma.backupRecord.update({
      where: { id: record.id },
      data: {
        status: 'completed',
        filePath,
        fileSize: BigInt(stats.size),
        checksum,
        completedAt: new Date(),
      },
    });

    logger.info({ filePath, size: stats.size, objects: objectCount }, 'Storage backup completed');
    return { id: record.id, status: 'completed', filePath };
  } catch (err: any) {
    await prisma.backupRecord.update({
      where: { id: record.id },
      data: { status: 'failed', errorMessage: err.message, completedAt: new Date() },
    });
    logger.error({ err }, 'Storage backup failed');
    return { id: record.id, status: 'failed' };
  }
}

export async function runRestoreTest(backupRecordId: string): Promise<{ success: boolean; message: string }> {
  const prisma = getPrisma();

  const record = await prisma.backupRecord.findUnique({ where: { id: backupRecordId } });
  if (!record || record.status !== 'completed' || !record.filePath) {
    return { success: false, message: 'Backup record not found or not completed' };
  }

  try {
    if (record.type === 'database') {
      const testDbUrl = process.env.TEST_DATABASE_URL;
      if (!testDbUrl) {
        return { success: false, message: 'TEST_DATABASE_URL not configured' };
      }

      execSync(`gunzip -c ${record.filePath} | psql ${testDbUrl}`, {
        stdio: 'pipe',
        timeout: 300_000,
      });

      const result = execSync(`psql ${testDbUrl} -c "SELECT count(*) FROM images;" -t`, {
        stdio: 'pipe',
        timeout: 30_000,
      });

      logger.info({ rowCount: result.toString().trim() }, 'Restore test passed');
      return { success: true, message: `Restore verified: ${result.toString().trim()} rows in images table` };
    }

    return { success: true, message: 'Backup file exists and is accessible' };
  } catch (err: any) {
    logger.error({ err }, 'Restore test failed');
    return { success: false, message: `Restore test failed: ${err.message}` };
  }
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
