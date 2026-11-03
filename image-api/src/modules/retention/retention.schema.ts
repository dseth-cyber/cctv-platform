import { z } from 'zod';

// Video retention: how many days a camera's recordings are kept before cleanup moves them to quarantine.
export const createRetentionPolicySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  recordingRetentionDays: z.number().int().min(1).max(3650).default(30),
  isDefault: z.boolean().default(false),
});

export const updateRetentionPolicySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  recordingRetentionDays: z.number().int().min(1).max(3650).optional(),
  isDefault: z.boolean().optional(),
});

export type CreateRetentionPolicyInput = z.infer<typeof createRetentionPolicySchema>;
export type UpdateRetentionPolicyInput = z.infer<typeof updateRetentionPolicySchema>;
