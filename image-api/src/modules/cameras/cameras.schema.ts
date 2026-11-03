import { z } from 'zod';

// [R2.3] Factory fields (SMB, polling, image processing) are not part of the camera schema any more;
// see camera-factory.ts.

// Simple camera setup: the server builds rtspUrl/rtspUrlSub from these (see cameras.service.ts).
// A blank password on update keeps the one already stored.
export const cameraConnectionSchema = z.object({
  brand: z.string().min(1).max(32),
  port: z.number().int().min(1).max(65535).default(554),
  channel: z.number().int().min(1).max(256).default(1),
  username: z.string().max(128).default(''),
  password: z.string().max(256).optional(),
});

export const createCameraSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  ipAddress: z.string().min(1).max(45).optional().nullable(),
  timezone: z.string().max(64).default('UTC'),
  retentionPolicyId: z.guid().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  slaTargetPercent: z.number().min(0).max(100).optional().nullable(),
  // CCTV & Streaming fields
  deviceId: z.guid().optional().nullable(),
  channelNumber: z.number().int().min(1).max(256).optional().nullable(),
  rtspUrl: z.string().max(1024).optional().nullable(),
  rtspUrlSub: z.string().max(1024).optional().nullable(),
  streamProfile: z.string().max(32).optional().nullable(),
  mediaNodeId: z.guid().optional().nullable(),
  streamPath: z.string().max(256).optional().nullable(),
  siteId: z.guid().optional().nullable(),
  zoneId: z.guid().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  onvifProfileToken: z.string().max(256).optional().nullable(),
  templateId: z.guid().optional().nullable(),
  connection: cameraConnectionSchema.optional(),
});

export const updateCameraSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  ipAddress: z.string().min(1).max(45).optional().nullable(),
  timezone: z.string().max(64).optional(),
  retentionPolicyId: z.guid().optional().nullable(),
  enabled: z.boolean().optional(),
  status: z.enum(['active', 'inactive', 'error', 'maintenance']).optional(),
  lastPolledAt: z.string().datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  slaTargetPercent: z.number().min(0).max(100).optional().nullable(),
  // CCTV & Streaming fields
  deviceId: z.guid().optional().nullable(),
  channelNumber: z.number().int().min(1).max(256).optional().nullable(),
  rtspUrl: z.string().max(1024).optional().nullable(),
  rtspUrlSub: z.string().max(1024).optional().nullable(),
  streamProfile: z.string().max(32).optional().nullable(),
  mediaNodeId: z.guid().optional().nullable(),
  streamPath: z.string().max(256).optional().nullable(),
  streamState: z.string().max(32).optional().nullable(),
  siteId: z.guid().optional().nullable(),
  zoneId: z.guid().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  onvifProfileToken: z.string().max(256).optional().nullable(),
  templateId: z.guid().optional().nullable(),
  connection: cameraConnectionSchema.optional(),
});

export const cameraQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'error', 'maintenance']).optional(),
  enabled: z.coerce.boolean().optional(),
  deviceId: z.guid().optional(),
  siteId: z.guid().optional(),
  zoneId: z.guid().optional(),
});

export type CreateCameraInput = z.infer<typeof createCameraSchema>;
export type UpdateCameraInput = z.infer<typeof updateCameraSchema>;
export type CameraQueryInput = z.infer<typeof cameraQuerySchema>;
