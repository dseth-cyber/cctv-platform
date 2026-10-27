import { z } from 'zod';

export const createRoleSchema = z.object({
  code: z.string().min(1).max(64),
  nameTh: z.string().min(1).max(256),
  nameEn: z.string().min(1).max(256),
  nameCn: z.string().min(1).max(256).optional(),
  nameMm: z.string().min(1).max(256).optional(),
  nameJp: z.string().min(1).max(256).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

export const updateRoleSchema = z.object({
  nameTh: z.string().min(1).max(256).optional(),
  nameEn: z.string().min(1).max(256).optional(),
  nameCn: z.string().min(1).max(256).optional(),
  nameMm: z.string().min(1).max(256).optional(),
  nameJp: z.string().min(1).max(256).optional(),
  description: z.string().optional(),
  permissions: z.array(z.string()).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
