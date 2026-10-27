import { z } from 'zod';

export const imageSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(5000).default(20),
  cameraId: z.string().uuid().optional(),
  status: z.enum(['pending', 'queued', 'processing', 'completed', 'failed', 'deleted', 'archived']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().max(256).optional(),
  checksumMd5: z.string().length(32).optional(),
  // Filter by lock state. Sent as a string query param, so accept 'true'/'false'
  // explicitly rather than z.coerce.boolean() (which turns "false" into true).
  locked: z.enum(['true', 'false']).optional(),
  tagKey: z.string().max(128).optional(),
  tagValue: z.string().max(256).optional(),
  // P52 — filter captures by the production run covering their capturedAt.
  customer: z.string().max(255).optional(),
  jobType: z.string().max(128).optional(),
  orderNo: z.string().max(128).optional(),
  partNo: z.string().max(128).optional(),
  line: z.string().max(128).optional(),
  sort: z.enum(['capturedAt', 'fileSizeBytes', 'status', 'createdAt', 'originalFilename', 'cameraName', 'source', 'processedFileSizeBytes']).default('capturedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const updateMetadataSchema = z.object({
  status: z.enum(['pending', 'queued', 'processing', 'completed', 'failed', 'deleted', 'archived']).optional(),
  errorMessage: z.string().optional(),
  error_message: z.string().optional(),
  tiffMetadata: z.record(z.unknown()).optional(),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  bitDepth: z.number().int().positive().optional(),
  colorSpace: z.string().max(32).optional(),
  compressionType: z.string().max(64).optional(),
  compressionRatio: z.number().min(0).max(100).optional(),
});

export const registerImageSchema = z.object({
  cameraId: z.string().uuid(),
  originalFilename: z.string().min(1).max(512),
  fileSizeBytes: z.number().int().nonnegative(),
  checksumMd5: z.string().length(32).optional(),
  checksumSha256: z.string().length(64).optional(),
  status: z.enum(['pending', 'queued', 'processing', 'completed', 'failed', 'deleted', 'archived']).default('pending'),
  capturedAt: z.string().datetime(),
});

export const processingResultFileSchema = z.object({
  fileType: z.string().min(1).max(32),
  fileSizeBytes: z.number().int().nonnegative(),
  mimeType: z.string().optional(),
  objectKey: z.string().min(1),
  bucket: z.string().default('images'),
  storageClass: z.enum(['hot', 'warm', 'cold']).default('hot'),
  storageProviderId: z.string().uuid().optional(),
});

export const processingResultSchema = z.object({
  status: z.enum(['completed', 'failed']).default('completed'),
  widthPx: z.number().int().positive().optional(),
  heightPx: z.number().int().positive().optional(),
  bitDepth: z.number().int().positive().optional(),
  colorSpace: z.string().max(32).optional(),
  compressionType: z.string().max(64).optional(),
  compressionRatio: z.number().min(0).max(100).optional(),
  checksumSha256: z.string().length(64).optional(),
  processedAt: z.string().datetime().optional(),
  tiffMetadata: z.record(z.unknown()).optional(),
  files: z.array(processingResultFileSchema).optional(),
});

export const updateTagsSchema = z.record(z.string().min(1).max(256));

export const imageResponseSchema = z.object({
  id: z.string(),
  cameraId: z.string().nullable(),
  originalFilename: z.string(),
  fileSizeBytes: z.number(),
  checksumSha256: z.string().nullable(),
  checksumMd5: z.string().nullable(),
  status: z.string(),
  widthPx: z.number().nullable(),
  heightPx: z.number().nullable(),
  bitDepth: z.number().nullable(),
  colorSpace: z.string().nullable(),
  compressionType: z.string().nullable(),
  compressionRatio: z.number().nullable(),
  capturedAt: z.string(),
  ingestedAt: z.string(),
  processedAt: z.string().nullable(),
  retentionUntil: z.string().nullable(),
  files: z.array(z.object({
    id: z.string(),
    fileType: z.string(),
    fileSizeBytes: z.number(),
    mimeType: z.string().nullable(),
    storageClass: z.string(),
  })),
  tags: z.array(z.object({
    key: z.string(),
    value: z.string(),
  })),
});

export const imageSummarySchema = z.object({
  id: z.string(),
  cameraId: z.string().nullable(),
  cameraName: z.string(),
  originalFilename: z.string(),
  fileSizeBytes: z.number(),
  status: z.string(),
  widthPx: z.number().nullable(),
  heightPx: z.number().nullable(),
  capturedAt: z.string(),
  thumbnailUrl: z.string().nullable(),
  processedFileSizeBytes: z.number().nullable(),
});

export type ImageSearchInput = z.infer<typeof imageSearchSchema>;
export type UpdateMetadataInput = z.infer<typeof updateMetadataSchema>;
export type RegisterImageInput = z.infer<typeof registerImageSchema>;
export type ProcessingResultInput = z.infer<typeof processingResultSchema>;
