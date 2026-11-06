import fs from 'node:fs/promises';
import path from 'node:path';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';

/** A stored file path, as a real path inside the recordings folder. Null for anything outside it. */
export function recordingFileOnDisk(stored: string | null | undefined, recordingsDir: string): string | null {
  if (!stored) return null;
  const base = path.resolve(recordingsDir);
  const relative = stored.replace(/^(\.?\/)?recordings\//, '');
  const resolved = path.resolve(base, relative);
  const inside = path.relative(base, resolved);
  return !inside || inside.startsWith('..') || path.isAbsolute(inside) ? null : resolved;
}

const recordingsDir = () => process.env.RECORDINGS_DIR || path.resolve(process.cwd(), 'recordings');

export interface DeletionImpact {
  clips: number;
  recordings: number;
  bytes: number;
  /** Clips and recordings under Legal Hold. While any exists, the camera holding it cannot be deleted. */
  legalHold: number;
  /** The cameras those holds are on. */
  heldCameraIds: string[];
  /** Kept in the audit log, since the clips themselves will be gone. */
  clipRecords: Array<{ title: string; sha256: string | null; bytes: number }>;
  files: string[];
}

/** What permanently deleting these cameras takes with it. */
export async function cameraDeletionImpact(ids: string[]): Promise<DeletionImpact> {
  const prisma = getPrisma();
  const [clips, recordings] = await Promise.all([
    prisma.recordingClip.findMany({
      where: { cameraId: { in: ids } },
      select: { cameraId: true, title: true, filePath: true, fileSizeBytes: true, sha256Hash: true, legalHold: true },
    }),
    prisma.cameraRecording.findMany({
      where: { cameraId: { in: ids } },
      select: { cameraId: true, filePath: true, fileSizeBytes: true, legalHold: true },
    }),
  ]);
  const held = [...clips, ...recordings].filter((row) => row.legalHold);
  const dir = recordingsDir();
  return {
    clips: clips.length,
    recordings: recordings.length,
    bytes: [...clips, ...recordings].reduce((sum, row) => sum + Number(row.fileSizeBytes ?? 0), 0),
    legalHold: held.length,
    heldCameraIds: [...new Set(held.map((row) => row.cameraId))],
    clipRecords: clips.map((c) => ({ title: c.title, sha256: c.sha256Hash, bytes: Number(c.fileSizeBytes ?? 0) })),
    files: [...clips, ...recordings].map((row) => recordingFileOnDisk(row.filePath, dir)).filter((f): f is string => !!f),
  };
}

/** Removes what the database no longer points to. A file that cannot be removed is reported, not hidden. */
export async function removeRecordingFiles(files: string[]) {
  let removed = 0;
  const failed: string[] = [];
  for (const file of files) {
    try {
      await fs.unlink(file);
      removed++;
    } catch (err: any) {
      if (err?.code === 'ENOENT') continue;
      failed.push(path.basename(file));
      logger.warn({ file: path.basename(file), code: err?.code }, 'Could not remove a deleted camera\'s file');
    }
  }
  return { removed, failed };
}
