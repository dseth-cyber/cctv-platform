import { z } from 'zod';

const ACCEPTED_EXT_VALUES = ['tif', 'tiff', 'ptif', 'ptiff', 'jpg', 'jpeg', 'png', 'bmp'] as const;

export const acceptedExtensionsSchema = z
  .array(z.enum(ACCEPTED_EXT_VALUES))
  .or(z.array(z.string().min(1).max(16)));

export const createCameraTemplateSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional().nullable(),
  acceptedExtensions: acceptedExtensionsSchema.optional().default(['tif', 'tiff', 'ptif', 'ptiff']),
  convertToPng: z.boolean().optional().default(true),
  keepSmaller: z.boolean().optional().default(true),
  generateThumbnail: z.boolean().optional().default(true),
  thumbnailSize: z.number().int().min(16).max(4096).optional().default(512),
  compressionQuality: z.number().int().min(1).max(100).optional().default(85),
  pollIntervalSeconds: z.number().int().min(5).max(3600).optional().default(30),
  captureMode: z.enum(['on_demand', 'periodic', 'continuous']).optional().default('periodic'),
  retentionPolicyId: z.string().uuid().optional().nullable(),
  isDefault: z.boolean().optional().default(false),
  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateCameraTemplateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional().nullable(),
  acceptedExtensions: acceptedExtensionsSchema.optional(),
  convertToPng: z.boolean().optional(),
  keepSmaller: z.boolean().optional(),
  generateThumbnail: z.boolean().optional(),
  thumbnailSize: z.number().int().min(16).max(4096).optional(),
  compressionQuality: z.number().int().min(1).max(100).optional(),
  pollIntervalSeconds: z.number().int().min(5).max(3600).optional(),
  captureMode: z.enum(['on_demand', 'periodic', 'continuous']).optional(),
  retentionPolicyId: z.string().uuid().optional().nullable(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type CreateCameraTemplateInput = z.infer<typeof createCameraTemplateSchema>;
export type UpdateCameraTemplateInput = z.infer<typeof updateCameraTemplateSchema>;
