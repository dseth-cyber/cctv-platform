import { sortByName } from '../../lib/natural-sort.js';
import { z } from 'zod';
import { getPrisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';

const MAX_GROUP_CAMERAS = 2000;

export const createCameraGroupSchema = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(255).optional().nullable(),
  cameraIds: z.array(z.guid()).max(MAX_GROUP_CAMERAS).default([]),
});

export const updateCameraGroupSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().max(255).optional().nullable(),
  cameraIds: z.array(z.guid()).max(MAX_GROUP_CAMERAS).optional(),
});

export type CreateCameraGroupInput = z.infer<typeof createCameraGroupSchema>;
export type UpdateCameraGroupInput = z.infer<typeof updateCameraGroupSchema>;

/** Groups with the ids of their cameras; trashed cameras do not count as members. */
export async function listCameraGroups() {
  const groups = await getPrisma().cameraGroup.findMany({
    orderBy: { name: 'asc' },
    include: { members: { where: { camera: { deletedAt: null } }, select: { cameraId: true } } },
  });
  return sortByName(groups).map(({ members, ...group }) => ({ ...group, cameraIds: members.map((m) => m.cameraId) }));
}

async function assertNameFree(name: string, exceptId?: string) {
  const taken = await getPrisma().cameraGroup.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (taken) throw new ConflictError(`Camera group '${name}' already exists`, { code: 'CAMERA_GROUP_NAME_TAKEN' });
}

async function assertCamerasExist(cameraIds: string[]) {
  const found = await getPrisma().camera.count({ where: { id: { in: cameraIds }, deletedAt: null } });
  if (found !== new Set(cameraIds).size) throw new ValidationError('Some cameras do not exist or are in the trash');
}

export async function createCameraGroup(input: CreateCameraGroupInput) {
  await assertNameFree(input.name);
  await assertCamerasExist(input.cameraIds);
  return getPrisma().cameraGroup.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      members: { create: [...new Set(input.cameraIds)].map((cameraId) => ({ cameraId })) },
    },
  });
}

export async function updateCameraGroup(id: string, input: UpdateCameraGroupInput) {
  const prisma = getPrisma();
  if (!(await prisma.cameraGroup.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundError('CameraGroup', id);
  if (input.name !== undefined) await assertNameFree(input.name, id);
  if (input.cameraIds) await assertCamerasExist(input.cameraIds);
  return prisma.$transaction(async (tx) => {
    if (input.cameraIds) {
      await tx.cameraGroupMember.deleteMany({ where: { groupId: id } });
      await tx.cameraGroupMember.createMany({ data: [...new Set(input.cameraIds)].map((cameraId) => ({ groupId: id, cameraId })) });
    }
    return tx.cameraGroup.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
  });
}

/** Removes the group only; its cameras stay. */
export async function deleteCameraGroup(id: string) {
  const prisma = getPrisma();
  const group = await prisma.cameraGroup.findUnique({ where: { id } });
  if (!group) throw new NotFoundError('CameraGroup', id);
  await prisma.cameraGroup.delete({ where: { id } });
  return group;
}
