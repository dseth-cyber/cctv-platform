import { storageRouter } from './storage/storage-router.js';
import { logger } from './logger.js';
import { updateBulkJob } from './bulk-job.js';

export interface DeletableFileRef {
  id: string;
  imageId?: string;
  objectKey: string;
  storageProviderId: string | null;
  fileSizeBytes: bigint | number;
}

export interface FileDeletionResult {
  succeededFileIds: string[];
  failedImageIds: Set<string>;
  deletedBytes: number;
  errors: number;
}

// How many storage-delete calls run in parallel per chunk. Sequential (concurrency=1)
// is what the old code did and is why a few-thousand-file batch could take many minutes;
// this stays modest so we don't hammer SeaweedFS/S3 with thousands of simultaneous
// connections.
const CONCURRENCY = 10;

// Deletes every file's backing object from storage (tolerating "already gone"), reporting
// progress into the given bulk job as it goes. Returns which fileIds were actually
// confirmed removed (or already absent) from storage — callers must only delete the
// corresponding Postgres rows for *those* ids, never the whole input list unconditionally.
// Doing otherwise is exactly how DB rows end up pointing at storage objects that no
// longer exist (or vice versa) — see incident_2026-08-06.
export async function deleteFilesWithProgress(
  jobId: string,
  files: DeletableFileRef[],
): Promise<FileDeletionResult> {
  const succeededFileIds: string[] = [];
  const failedImageIds = new Set<string>();
  let done = 0;
  let deletedBytes = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const chunk = files.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (file) => {
      try {
        const provider = file.storageProviderId
          ? storageRouter.get(file.storageProviderId)
          : storageRouter.getDefault();
        try {
          await provider.delete(file.objectKey);
        } catch (err: any) {
          if (!err.message?.includes('Not Found')) throw err;
        }
        succeededFileIds.push(file.id);
        deletedBytes += Number(file.fileSizeBytes);
      } catch (err) {
        errors++;
        if (file.imageId) failedImageIds.add(file.imageId);
        logger.error({ err, fileId: file.id }, 'Failed to delete file from storage during bulk job');
      } finally {
        done++;
      }
    }));

    await updateBulkJob(jobId, { done, deletedBytes, errors });
  }

  return { succeededFileIds, failedImageIds, deletedBytes, errors };
}
