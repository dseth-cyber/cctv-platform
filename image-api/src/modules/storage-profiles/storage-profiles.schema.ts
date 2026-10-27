import { z } from 'zod';

export const routingRuleSchema = z.object({
  condition: z.object({
    fileType: z.string().optional(),
    tagKey: z.string().optional(),
    tagValue: z.string().optional(),
    cameraId: z.string().optional(),
  }),
  providerId: z.string().uuid(),
});

export const createProfileSchema = z.object({
  code: z.string().min(1).max(64),
  nameTh: z.string().min(1).max(256),
  nameEn: z.string().min(1).max(256),
  nameCn: z.string().min(1).max(256),
  nameMm: z.string().min(1).max(256),
  nameJp: z.string().min(1).max(256),
  description: z.string().optional(),
  providerId: z.string().uuid(),
  routingRules: z.array(routingRuleSchema).optional().default([]),
  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateProfileSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  nameTh: z.string().min(1).max(256).optional(),
  nameEn: z.string().min(1).max(256).optional(),
  nameCn: z.string().min(1).max(256).optional(),
  nameMm: z.string().min(1).max(256).optional(),
  nameJp: z.string().min(1).max(256).optional(),
  description: z.string().optional(),
  providerId: z.string().uuid().optional(),
  routingRules: z.array(routingRuleSchema).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
