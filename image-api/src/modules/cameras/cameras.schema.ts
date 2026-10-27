import { z } from 'zod';

// Per-camera processing overrides. All optional/nullable — null/empty = inherit from template.
const processingOverrideFields = {
  templateId: z.string().uuid().optional().nullable(),
  acceptedExtensions: z.array(z.string().min(1).max(16)).optional(),
  convertToPng: z.boolean().optional().nullable(),
  keepSmaller: z.boolean().optional().nullable(),
  generateThumbnail: z.boolean().optional().nullable(),
  thumbnailSize: z.number().int().min(16).max(4096).optional().nullable(),
  compressionQuality: z.number().int().min(1).max(100).optional().nullable(),
};

export const createCameraSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  ipAddress: z.string().min(1).max(45).optional().nullable(),
  smbSharePath: z.string().min(1).optional().nullable(),
  smbDomain: z.string().max(128).optional().nullable(),
  smbUsername: z.string().min(1).max(256).optional().nullable(),
  // Empty string is allowed: some SMB shares are configured with a username
  // but no password (blank-password account).
  smbPasswordEncrypted: z.string().optional().nullable(),
  smbSubdirectoryPattern: z.string().max(256).optional().nullable(),
  pollIntervalSeconds: z.number().int().min(5).max(3600).default(30),
  timezone: z.string().max(64).default('UTC'),
  captureMode: z.enum(['on_demand', 'periodic', 'continuous']).default('periodic'),
  cameraTypeCode: z.string().max(64).optional().nullable(),
  viewpointCode: z.string().max(64).optional().nullable(),
  retentionPolicyId: z.string().uuid().optional().nullable(),
  metadata: z.record(z.unknown()).default({}),
  slaTargetPercent: z.number().min(0).max(100).optional().nullable(),
  // CCTV & Streaming fields
  deviceId: z.string().uuid().optional().nullable(),
  channelNumber: z.number().int().min(1).max(256).optional().nullable(),
  rtspUrl: z.string().max(1024).optional().nullable(),
  rtspUrlSub: z.string().max(1024).optional().nullable(),
  streamProfile: z.string().max(32).optional().nullable(),
  mediaNodeId: z.string().uuid().optional().nullable(),
  streamPath: z.string().max(256).optional().nullable(),
  siteId: z.string().uuid().optional().nullable(),
  zoneId: z.string().uuid().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  onvifProfileToken: z.string().max(256).optional().nullable(),
  ...processingOverrideFields,
});

export const updateCameraSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  ipAddress: z.string().min(1).max(45).optional().nullable(),
  smbSharePath: z.string().min(1).optional().nullable(),
  smbDomain: z.string().max(128).optional().nullable(),
  smbUsername: z.string().min(1).max(256).optional().nullable(),
  smbPasswordEncrypted: z.string().optional().nullable(),
  smbSubdirectoryPattern: z.string().max(256).optional().nullable(),
  pollIntervalSeconds: z.number().int().min(5).max(3600).optional(),
  timezone: z.string().max(64).optional(),
  captureMode: z.enum(['on_demand', 'periodic', 'continuous']).optional(),
  cameraTypeCode: z.string().max(64).optional().nullable(),
  viewpointCode: z.string().max(64).optional().nullable(),
  retentionPolicyId: z.string().uuid().optional().nullable(),
  enabled: z.boolean().optional(),
  status: z.enum(['active', 'inactive', 'error', 'maintenance']).optional(),
  lastPolledAt: z.string().datetime().optional(),
  sourceOldestFileAt: z.string().datetime().nullable().optional(),
  sourceFileCount: z.number().int().nonnegative().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  slaTargetPercent: z.number().min(0).max(100).optional().nullable(),
  // CCTV & Streaming fields
  deviceId: z.string().uuid().optional().nullable(),
  channelNumber: z.number().int().min(1).max(256).optional().nullable(),
  rtspUrl: z.string().max(1024).optional().nullable(),
  rtspUrlSub: z.string().max(1024).optional().nullable(),
  streamProfile: z.string().max(32).optional().nullable(),
  mediaNodeId: z.string().uuid().optional().nullable(),
  streamPath: z.string().max(256).optional().nullable(),
  streamState: z.string().max(32).optional().nullable(),
  siteId: z.string().uuid().optional().nullable(),
  zoneId: z.string().uuid().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  onvifProfileToken: z.string().max(256).optional().nullable(),
  ...processingOverrideFields,
});

export const cameraQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'error', 'maintenance']).optional(),
  enabled: z.coerce.boolean().optional(),
  deviceId: z.string().uuid().optional(),
  siteId: z.string().uuid().optional(),
  zoneId: z.string().uuid().optional(),
});

export type CreateCameraInput = z.infer<typeof createCameraSchema>;
export type UpdateCameraInput = z.infer<typeof updateCameraSchema>;
export type CameraQueryInput = z.infer<typeof cameraQuerySchema>;
