import { z } from 'zod';

export const createCameraTemplateSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional().nullable(),
  retentionPolicyId: z.guid().optional().nullable(),
  isDefault: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateCameraTemplateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional().nullable(),
  retentionPolicyId: z.guid().optional().nullable(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type CreateCameraTemplateInput = z.infer<typeof createCameraTemplateSchema>;
export type UpdateCameraTemplateInput = z.infer<typeof updateCameraTemplateSchema>;
