import { z } from 'zod';

export const deviceTypeEnum = z.enum(['dvr', 'nvr', 'ip_camera', 'other']);

export const createDeviceSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  deviceType: deviceTypeEnum.default('dvr'),
  brand: z.string().max(64).optional(),
  model: z.string().max(64).optional(),
  serialNumber: z.string().max(128).optional(),
  ipAddress: z.string().min(1).max(45),
  rtspPort: z.number().int().min(1).max(65535).default(554),
  httpPort: z.number().int().min(1).max(65535).default(80).optional(),
  onvifPort: z.number().int().min(1).max(65535).optional().nullable(),
  username: z.string().max(128).optional().nullable(),
  password: z.string().optional().nullable(),
  totalChannels: z.number().int().min(1).max(256).default(1),
  enabled: z.boolean().default(true),
  siteId: z.guid().optional().nullable(),
  // Option to auto-provision camera channels upon device creation
  autoCreateCameras: z.boolean().default(false),
});

export const updateDeviceSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  deviceType: deviceTypeEnum.optional(),
  brand: z.string().max(64).optional(),
  model: z.string().max(64).optional(),
  serialNumber: z.string().max(128).optional(),
  ipAddress: z.string().min(1).max(45).optional(),
  rtspPort: z.number().int().min(1).max(65535).optional(),
  httpPort: z.number().int().min(1).max(65535).optional().nullable(),
  onvifPort: z.number().int().min(1).max(65535).optional().nullable(),
  username: z.string().max(128).optional().nullable(),
  password: z.string().optional().nullable(),
  totalChannels: z.number().int().min(1).max(256).optional(),
  enabled: z.boolean().optional(),
  status: z.string().max(32).optional(),
  siteId: z.guid().optional().nullable(),
});

export const deviceQuerySchema = z.object({
  deviceType: deviceTypeEnum.optional(),
  siteId: z.guid().optional(),
  enabled: z.coerce.boolean().optional(),
});

export const probeDeviceSchema = z.object({
  ipAddress: z.string().min(1).max(45),
  rtspPort: z.number().int().min(1).max(65535).default(554),
  httpPort: z.number().int().min(1).max(65535).default(80).optional(),
});

export const bulkImportDeviceSchema = z.object({
  devices: z.array(createDeviceSchema).min(1).max(100),
});

export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
export type DeviceQueryInput = z.infer<typeof deviceQuerySchema>;
export type ProbeDeviceInput = z.infer<typeof probeDeviceSchema>;
export type BulkImportDeviceInput = z.infer<typeof bulkImportDeviceSchema>;
