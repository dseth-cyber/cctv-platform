import { z } from 'zod';

const cleanupModeEnum = z.enum(['retention_only', 'retention_watermark', 'circular', 'read_only', 'manual']);

export const createRetentionPolicySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  rawRetentionDays: z.number().int().min(1).max(36500),
  processedRetentionDays: z.number().int().min(1).max(36500),
  thumbnailRetentionDays: z.number().int().min(1).max(36500),
  archiveRawDays: z.number().int().min(1).nullable().optional(),
  archiveEnabled: z.boolean().default(false),
  coldStorageClass: z.enum(['hot', 'warm', 'cold']).default('cold'),
  cleanupMode: cleanupModeEnum.default('retention_only'),
  deleteOrder: z.array(z.enum(['thumbnail', 'processed', 'raw'])).default(['thumbnail', 'processed', 'raw']),
  allowEmergencyCleanup: z.boolean().default(false),
  isDefault: z.boolean().default(false),
});

export const updateRetentionPolicySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  rawRetentionDays: z.number().int().min(1).max(36500).optional(),
  processedRetentionDays: z.number().int().min(1).max(36500).optional(),
  thumbnailRetentionDays: z.number().int().min(1).max(36500).optional(),
  archiveRawDays: z.number().int().min(1).nullable().optional(),
  archiveEnabled: z.boolean().optional(),
  coldStorageClass: z.enum(['hot', 'warm', 'cold']).optional(),
  cleanupMode: cleanupModeEnum.optional(),
  deleteOrder: z.array(z.enum(['thumbnail', 'processed', 'raw'])).optional(),
  allowEmergencyCleanup: z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export type CreateRetentionPolicyInput = z.infer<typeof createRetentionPolicySchema>;
export type UpdateRetentionPolicyInput = z.infer<typeof updateRetentionPolicySchema>;
