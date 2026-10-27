import { getPrisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import type { CreateSiteInput, UpdateSiteInput, CreateZoneInput, UpdateZoneInput } from './sites.schema.js';

export async function listSites() {
  const prisma = getPrisma();
  return prisma.site.findMany({
    include: {
      zones: { orderBy: { name: 'asc' } },
      _count: { select: { cameras: true, devices: true } },
    },
    orderBy: { name: 'asc' },
  });
}

export async function getSiteById(id: string) {
  const prisma = getPrisma();
  const site = await prisma.site.findUnique({
    where: { id },
    include: {
      zones: {
        include: {
          _count: { select: { cameras: true } },
        },
        orderBy: { name: 'asc' },
      },
      devices: {
        select: { id: true, name: true, deviceType: true, ipAddress: true, totalChannels: true },
      },
      cameras: {
        select: { id: true, name: true, status: true, operationalStatus: true, streamPath: true },
      },
    },
  });

  if (!site) throw new NotFoundError('Site', id);
  return site;
}

export async function createSite(input: CreateSiteInput) {
  const prisma = getPrisma();
  const existing = await prisma.site.findUnique({ where: { name: input.name } });
  if (existing) throw new ConflictError(`Site with name '${input.name}' already exists`);

  return prisma.site.create({
    data: {
      name: input.name,
      code: input.code,
      description: input.description,
      address: input.address,
    },
    include: { zones: true },
  });
}

export async function updateSite(id: string, input: UpdateSiteInput) {
  const prisma = getPrisma();
  const existing = await prisma.site.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Site', id);

  if (input.name && input.name !== existing.name) {
    const conflict = await prisma.site.findUnique({ where: { name: input.name } });
    if (conflict) throw new ConflictError(`Site with name '${input.name}' already exists`);
  }

  return prisma.site.update({
    where: { id },
    data: input,
    include: { zones: true },
  });
}

export async function deleteSite(id: string) {
  const prisma = getPrisma();
  const existing = await prisma.site.findUnique({
    where: { id },
    include: { _count: { select: { cameras: true, devices: true } } },
  });

  if (!existing) throw new NotFoundError('Site', id);
  if (existing._count.cameras > 0 || existing._count.devices > 0) {
    throw new ConflictError('Cannot delete site with linked cameras or devices');
  }

  await prisma.site.delete({ where: { id } });
  return { success: true };
}

// === Zones ===

export async function createZone(input: CreateZoneInput) {
  const prisma = getPrisma();
  const site = await prisma.site.findUnique({ where: { id: input.siteId } });
  if (!site) throw new NotFoundError('Site', input.siteId);

  const existing = await prisma.zone.findUnique({
    where: { siteId_name: { siteId: input.siteId, name: input.name } },
  });
  if (existing) throw new ConflictError(`Zone '${input.name}' already exists in site`);

  return prisma.zone.create({
    data: input,
  });
}

export async function updateZone(id: string, input: UpdateZoneInput) {
  const prisma = getPrisma();
  const existing = await prisma.zone.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Zone', id);

  if (input.name && input.name !== existing.name) {
    const conflict = await prisma.zone.findUnique({
      where: { siteId_name: { siteId: existing.siteId, name: input.name } },
    });
    if (conflict) throw new ConflictError(`Zone '${input.name}' already exists in site`);
  }

  return prisma.zone.update({
    where: { id },
    data: input,
  });
}

export async function deleteZone(id: string) {
  const prisma = getPrisma();
  const existing = await prisma.zone.findUnique({
    where: { id },
    include: { _count: { select: { cameras: true } } },
  });

  if (!existing) throw new NotFoundError('Zone', id);
  if (existing._count.cameras > 0) {
    throw new ConflictError('Cannot delete zone with linked cameras');
  }

  await prisma.zone.delete({ where: { id } });
  return { success: true };
}
