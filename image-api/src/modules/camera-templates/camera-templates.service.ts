import { getPrisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import type {
  CreateCameraTemplateInput,
  UpdateCameraTemplateInput,
} from './camera-templates.schema.js';

const TEMPLATE_INCLUDE = {
  retentionPolicy: { select: { id: true, name: true } },
  _count: { select: { cameras: true } },
} as const;

export async function listCameraTemplates() {
  const prisma = getPrisma();
  return prisma.cameraTemplate.findMany({
    include: TEMPLATE_INCLUDE,
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
}

export async function getCameraTemplateById(id: string) {
  const prisma = getPrisma();
  const template = await prisma.cameraTemplate.findUnique({
    where: { id },
    include: TEMPLATE_INCLUDE,
  });
  if (!template) throw new NotFoundError('CameraTemplate', id);
  return template;
}

async function clearOtherDefaults(prisma: ReturnType<typeof getPrisma>, exceptId?: string) {
  await prisma.cameraTemplate.updateMany({
    where: { isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createCameraTemplate(input: CreateCameraTemplateInput) {
  const prisma = getPrisma();

  const existing = await prisma.cameraTemplate.findFirst({ where: { name: input.name } });
  if (existing) throw new ConflictError(`Camera template '${input.name}' already exists`);

  if (input.retentionPolicyId) {
    const policy = await prisma.retentionPolicy.findUnique({ where: { id: input.retentionPolicyId } });
    if (!policy) throw new NotFoundError('RetentionPolicy', input.retentionPolicyId);
  }

  if (input.isDefault) await clearOtherDefaults(prisma);

  return prisma.cameraTemplate.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      acceptedExtensions: input.acceptedExtensions,
      convertToPng: input.convertToPng,
      keepSmaller: input.keepSmaller,
      generateThumbnail: input.generateThumbnail,
      thumbnailSize: input.thumbnailSize,
      compressionQuality: input.compressionQuality,
      pollIntervalSeconds: input.pollIntervalSeconds,
      captureMode: input.captureMode,
      retentionPolicyId: input.retentionPolicyId ?? null,
      isDefault: input.isDefault,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    },
    include: TEMPLATE_INCLUDE,
  });
}

export async function updateCameraTemplate(id: string, input: UpdateCameraTemplateInput) {
  const prisma = getPrisma();

  const existing = await prisma.cameraTemplate.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('CameraTemplate', id);

  if (input.name && input.name !== existing.name) {
    const conflict = await prisma.cameraTemplate.findFirst({ where: { name: input.name } });
    if (conflict) throw new ConflictError(`Camera template '${input.name}' already exists`);
  }

  if (input.retentionPolicyId) {
    const policy = await prisma.retentionPolicy.findUnique({ where: { id: input.retentionPolicyId } });
    if (!policy) throw new NotFoundError('RetentionPolicy', input.retentionPolicyId);
  }

  if (input.isDefault) await clearOtherDefaults(prisma, id);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.acceptedExtensions !== undefined) data.acceptedExtensions = input.acceptedExtensions;
  if (input.convertToPng !== undefined) data.convertToPng = input.convertToPng;
  if (input.keepSmaller !== undefined) data.keepSmaller = input.keepSmaller;
  if (input.generateThumbnail !== undefined) data.generateThumbnail = input.generateThumbnail;
  if (input.thumbnailSize !== undefined) data.thumbnailSize = input.thumbnailSize;
  if (input.compressionQuality !== undefined) data.compressionQuality = input.compressionQuality;
  if (input.pollIntervalSeconds !== undefined) data.pollIntervalSeconds = input.pollIntervalSeconds;
  if (input.captureMode !== undefined) data.captureMode = input.captureMode;
  if (input.retentionPolicyId !== undefined) data.retentionPolicyId = input.retentionPolicyId;
  if (input.isDefault !== undefined) data.isDefault = input.isDefault;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return prisma.cameraTemplate.update({
    where: { id },
    data,
    include: TEMPLATE_INCLUDE,
  });
}

export async function deleteCameraTemplate(id: string) {
  const prisma = getPrisma();

  const existing = await prisma.cameraTemplate.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('CameraTemplate', id);

  const cameraCount = await prisma.camera.count({ where: { templateId: id } });
  if (cameraCount > 0) {
    throw new ConflictError(
      `Cannot delete template '${existing.name}' — ${cameraCount} camera(s) still reference it`,
    );
  }

  await prisma.cameraTemplate.delete({ where: { id } });
  return { deleted: true };
}
