import { z } from 'zod';

export const createSiteSchema = z.object({
  name: z.string().min(1).max(128),
  code: z.string().max(64).optional().nullable(),
  description: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

export const updateSiteSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  code: z.string().max(64).optional().nullable(),
  description: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
});

export const createZoneSchema = z.object({
  siteId: z.guid(),
  name: z.string().min(1).max(128),
  code: z.string().max(64).optional().nullable(),
  floor: z.number().int().default(1).optional(),
  floorPlanImageUrl: z.string().optional().nullable(),
});

export const updateZoneSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  code: z.string().max(64).optional().nullable(),
  floor: z.number().int().optional(),
  floorPlanImageUrl: z.string().optional().nullable(),
});

export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;
