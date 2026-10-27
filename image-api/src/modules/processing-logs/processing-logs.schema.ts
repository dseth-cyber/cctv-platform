import { z } from 'zod';

export const processingLogSearchSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.string().max(32).optional(),
  jobType: z.string().max(32).optional(),
  q: z.string().max(256).optional(),
  sort: z.enum(['queuedAt', 'startedAt', 'completedAt', 'duration', 'jobType', 'status', 'workerId', 'imageId']).default('queuedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const retryJobSchema = z.object({
  imageId: z.string().uuid().optional(),
});

export type ProcessingLogSearchInput = z.infer<typeof processingLogSearchSchema>;
export type RetryJobInput = z.infer<typeof retryJobSchema>;
