import { z } from 'zod';
import { config } from '../../config/index.js';
import { ValidationError } from '../../lib/errors.js';
import { encrypt } from '../../lib/encryption.js';
import { SECRET_MASK } from '../../lib/rtsp-credentials.js';

/**
 * [R2.3] Factory image-pipeline settings live in `camera_factory_settings` (one row per camera),
 * not on `cameras`. They are only accepted and returned while FACTORY_MODULES_ENABLED=true.
 */
export const FACTORY_FIELDS = [
  'smbSharePath',
  'smbDomain',
  'smbUsername',
  'smbPasswordEncrypted',
  'smbSubdirectoryPattern',
  'pollIntervalSeconds',
  'captureMode',
  'cameraTypeCode',
  'viewpointCode',
  'acceptedExtensions',
  'convertToPng',
  'keepSmaller',
  'generateThumbnail',
  'thumbnailSize',
  'compressionQuality',
  'sourceOldestFileAt',
  'sourceFileCount',
  'lastImageAt',
  'totalImagesCount',
] as const;

export const factorySettingsSchema = z
  .object({
    smbSharePath: z.string().min(1).nullable(),
    smbDomain: z.string().max(128).nullable(),
    smbUsername: z.string().min(1).max(256).nullable(),
    // Empty string allowed: some shares use a username with a blank password.
    smbPasswordEncrypted: z.string().nullable(),
    smbSubdirectoryPattern: z.string().max(256).nullable(),
    pollIntervalSeconds: z.number().int().min(5).max(3600),
    captureMode: z.enum(['on_demand', 'periodic', 'continuous']),
    cameraTypeCode: z.string().max(64).nullable(),
    viewpointCode: z.string().max(64).nullable(),
    acceptedExtensions: z.array(z.string().min(1).max(16)),
    convertToPng: z.boolean().nullable(),
    keepSmaller: z.boolean().nullable(),
    generateThumbnail: z.boolean().nullable(),
    thumbnailSize: z.number().int().min(16).max(4096).nullable(),
    compressionQuality: z.number().int().min(1).max(100).nullable(),
    sourceOldestFileAt: z.string().datetime().nullable(),
    sourceFileCount: z.number().int().nonnegative().nullable(),
  })
  .partial();

export type FactorySettingsInput = z.infer<typeof factorySettingsSchema>;

/**
 * Pulls factory fields out of a request body: either nested under `factorySettings` or, for the
 * factory sync worker, at the top level. Returns null when there are none. Throws 400 when the
 * factory modules are off, rather than silently dropping what the caller sent.
 */
export function extractFactoryInput(body: unknown): FactorySettingsInput | null {
  if (!body || typeof body !== 'object') return null;
  const raw = body as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of FACTORY_FIELDS) {
    if (key in raw) picked[key] = raw[key];
  }
  if (raw.factorySettings && typeof raw.factorySettings === 'object') {
    Object.assign(picked, raw.factorySettings as object);
  }
  delete picked.lastImageAt;
  delete picked.totalImagesCount;
  if (Object.keys(picked).length === 0) return null;
  if (!config.factoryModulesEnabled) {
    throw new ValidationError(
      `Factory camera fields are not accepted while FACTORY_MODULES_ENABLED is off: ${Object.keys(picked).join(', ')}`,
    );
  }
  const parsed = factorySettingsSchema.safeParse(picked);
  if (!parsed.success) {
    throw new ValidationError('Invalid factory camera settings', { issues: parsed.error.issues });
  }
  return parsed.data;
}

/** Prisma data for camera_factory_settings; the SMB password is encrypted, the mask means "unchanged". */
export function toFactoryData(input: FactorySettingsInput): Record<string, unknown> {
  const data: Record<string, unknown> = { ...input };
  if ('smbPasswordEncrypted' in input) {
    if (input.smbPasswordEncrypted === SECRET_MASK) delete data.smbPasswordEncrypted;
    else data.smbPasswordEncrypted = input.smbPasswordEncrypted ? encrypt(input.smbPasswordEncrypted) : input.smbPasswordEncrypted;
  }
  if ('sourceOldestFileAt' in input) {
    data.sourceOldestFileAt = input.sourceOldestFileAt ? new Date(input.sourceOldestFileAt) : null;
  }
  return data;
}

/** Prisma include for the settings row, only when the factory modules are on. */
export function factoryInclude(): { factorySettings: true } | Record<string, never> {
  return config.factoryModulesEnabled ? { factorySettings: true } : {};
}

/**
 * Removes the relation from a camera and, when the factory modules are on, puts its fields back at
 * the top level, where the factory workers and pages expect them.
 */
export function flattenFactory<T extends Record<string, any>>(camera: T): Omit<T, 'factorySettings'> & Record<string, unknown> {
  const { factorySettings, ...rest } = camera as any;
  if (!config.factoryModulesEnabled || !factorySettings) return rest;
  const { cameraId: _cameraId, createdAt: _c, updatedAt: _u, ...fields } = factorySettings;
  return { ...rest, ...fields };
}
