import { z } from 'zod';

export const workerUploadSchema = z.object({
  imageId: z.string().uuid(),
  fileType: z.string().min(1).max(32),
  objectKey: z.string().min(1),
  storageProviderId: z.string().uuid(),
  fileSizeBytes: z.number().int().nonnegative(),
  checksumSha256: z.string().length(64).optional(),
  mimeType: z.string().optional(),
});

export type WorkerUploadInput = z.infer<typeof workerUploadSchema>;
