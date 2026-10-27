import { getPrisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import type { CreateProfileInput, UpdateProfileInput } from './storage-profiles.schema.js';

export async function listProfiles() {
  const prisma = getPrisma();
  return prisma.storageProfile.findMany({
    where: { deletedAt: null },
    include: { provider: { select: { id: true, name: true, type: true } } },
    orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
  });
}

export async function getProfileById(id: string) {
  const prisma = getPrisma();
  const profile = await prisma.storageProfile.findUnique({
    where: { id },
    include: { provider: { select: { id: true, name: true, type: true } } },
  });
  if (!profile || profile.deletedAt) throw new NotFoundError('StorageProfile', id);
  return profile;
}

export async function createProfile(input: CreateProfileInput) {
  const prisma = getPrisma();

  const existing = await prisma.storageProfile.findUnique({ where: { code: input.code } });
  if (existing) throw new ConflictError(`Storage profile code '${input.code}' already exists`);

  const provider = await prisma.storageProvider.findUnique({ where: { id: input.providerId } });
  if (!provider || provider.deletedAt) throw new NotFoundError('StorageProvider', input.providerId);

  return prisma.storageProfile.create({
    data: {
      code: input.code,
      nameTh: input.nameTh,
      nameEn: input.nameEn,
      nameCn: input.nameCn,
      nameMm: input.nameMm,
      nameJp: input.nameJp,
      description: input.description,
      providerId: input.providerId,
      routingRules: input.routingRules as any,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
    include: { provider: { select: { id: true, name: true, type: true } } },
  });
}

export async function updateProfile(id: string, input: UpdateProfileInput) {
  const prisma = getPrisma();

  const existing = await prisma.storageProfile.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new NotFoundError('StorageProfile', id);

  if (input.code && input.code !== existing.code) {
    const conflict = await prisma.storageProfile.findUnique({ where: { code: input.code } });
    if (conflict) throw new ConflictError(`Storage profile code '${input.code}' already exists`);
  }

  if (input.providerId) {
    const provider = await prisma.storageProvider.findUnique({ where: { id: input.providerId } });
    if (!provider || provider.deletedAt) throw new NotFoundError('StorageProvider', input.providerId);
  }

  const data: Record<string, unknown> = {};
  if (input.code !== undefined) data.code = input.code;
  if (input.nameTh !== undefined) data.nameTh = input.nameTh;
  if (input.nameEn !== undefined) data.nameEn = input.nameEn;
  if (input.nameCn !== undefined) data.nameCn = input.nameCn;
  if (input.nameMm !== undefined) data.nameMm = input.nameMm;
  if (input.nameJp !== undefined) data.nameJp = input.nameJp;
  if (input.description !== undefined) data.description = input.description;
  if (input.providerId !== undefined) data.providerId = input.providerId;
  if (input.routingRules !== undefined) data.routingRules = input.routingRules as any;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return prisma.storageProfile.update({
    where: { id },
    data,
    include: { provider: { select: { id: true, name: true, type: true } } },
  });
}

export async function deleteProfile(id: string) {
  const prisma = getPrisma();

  const existing = await prisma.storageProfile.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) throw new NotFoundError('StorageProfile', id);

  const fileCount = await prisma.imageFile.count({ where: { storageProfileId: id } });
  if (fileCount > 0) {
    await prisma.storageProfile.update({
      where: { id },
      data: { isActive: false },
    });
    return { message: 'Profile deactivated (has associated files)' };
  }

  await prisma.storageProfile.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  return { message: 'Profile deleted' };
}

export async function resolveProfile(fileType?: string, tagKey?: string, tagValue?: string, cameraId?: string) {
  const prisma = getPrisma();
  const profiles = await prisma.storageProfile.findMany({
    where: { deletedAt: null, isActive: true },
    include: { provider: { select: { id: true, name: true, type: true } } },
    orderBy: { sortOrder: 'asc' },
  });

  for (const profile of profiles) {
    const rules = profile.routingRules as any as Array<{
      condition: { fileType?: string; tagKey?: string; tagValue?: string; cameraId?: string };
      providerId: string;
    }>;
    if (!rules || rules.length === 0) continue;

    for (const rule of rules) {
      const c = rule.condition;
      if (c.fileType && c.fileType !== fileType) continue;
      if (c.tagKey && c.tagKey !== tagKey) continue;
      if (c.tagValue && c.tagValue !== tagValue) continue;
      if (c.cameraId && c.cameraId !== cameraId) continue;
      return { profile, targetProviderId: rule.providerId };
    }
  }

  return null;
}
