import fs from 'node:fs';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { APP_BACKUP_FILE, backupDestinations, destinationWritable } from './backup-settings.js';

/**
 * What lives on which disk, for the backup page: recordings + clips, and each backup destination.
 * Read-only. Disks are told apart by the device id of the folder, so two folders on one disk say so.
 */
export interface DiskUse {
  id: 'recordings' | 'backup_internal' | 'backup_external';
  hostPath: string;
  available: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  usedPercent: number | null;
  /** What this system keeps there (bytes), as far as it knows. */
  contents: { recordingsBytes?: number; clipsBytes?: number; backupBytes?: number; backupFiles?: number };
  /** Other entries on the same physical disk/filesystem. */
  sameDiskAs: string[];
  device: number | null;
}

function measure(dir: string): { totalBytes: number; freeBytes: number; usedPercent: number; device: number } | null {
  try {
    const s = fs.statfsSync(dir);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    return { totalBytes, freeBytes, usedPercent: totalBytes > 0 ? Math.round(((totalBytes - freeBytes) / totalBytes) * 1000) / 10 : 0, device: fs.statSync(dir).dev };
  } catch {
    return null;
  }
}

function backupFilesIn(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!APP_BACKUP_FILE.test(name) && !name.endsWith('.dump')) continue;
      try { bytes += fs.statSync(path.join(dir, name)).size; files++; } catch { /* vanished */ }
    }
  } catch { /* unreadable */ }
  return { bytes, files };
}

export async function diskOverview(): Promise<DiskUse[]> {
  const prisma = getPrisma();
  const recordingsDir = process.env.RECORDINGS_DIR || path.resolve(process.cwd(), 'recordings');
  const [rec, clips] = await Promise.all([
    prisma.cameraRecording.aggregate({ _sum: { fileSizeBytes: true } }).catch(() => null),
    prisma.recordingClip.aggregate({ _sum: { fileSizeBytes: true }, where: { deletedAt: null } }).catch(() => null),
  ]);

  const entries: DiskUse[] = [];
  const m = measure(recordingsDir);
  entries.push({
    id: 'recordings',
    hostPath: process.env.RECORDINGS_HOST_DIR || recordingsDir,
    available: !!m,
    totalBytes: m?.totalBytes ?? null, freeBytes: m?.freeBytes ?? null, usedPercent: m?.usedPercent ?? null, device: m?.device ?? null,
    contents: { recordingsBytes: Number(rec?._sum.fileSizeBytes ?? 0), clipsBytes: Number(clips?._sum.fileSizeBytes ?? 0) },
    sameDiskAs: [],
  });
  for (const d of backupDestinations()) {
    const dm = measure(d.dir);
    const files = backupFilesIn(d.dir);
    entries.push({
      id: d.id === 'internal' ? 'backup_internal' : 'backup_external',
      hostPath: d.hostPath,
      available: !!dm && destinationWritable(d.dir),
      totalBytes: dm?.totalBytes ?? null, freeBytes: dm?.freeBytes ?? null, usedPercent: dm?.usedPercent ?? null, device: dm?.device ?? null,
      contents: { backupBytes: files.bytes, backupFiles: files.files },
      sameDiskAs: [],
    });
  }
  for (const e of entries) {
    e.sameDiskAs = e.device === null ? [] : entries.filter((o) => o !== e && o.device === e.device).map((o) => o.id);
  }
  return entries;
}
