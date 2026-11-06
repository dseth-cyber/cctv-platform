import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { createCameraGroup, createCameraGroupSchema, deleteCameraGroup, listCameraGroups, updateCameraGroup } from './camera-groups.service.js';

const CAM = '11111111-1111-4111-8111-111111111111';
const GROUP = '22222222-2222-4222-8222-222222222222';

function prismaMock(over: Record<string, any> = {}) {
  const tx = {
    cameraGroupMember: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
    cameraGroup: { update: vi.fn().mockResolvedValue({ id: GROUP, name: 'g' }) },
  };
  const prisma = {
    camera: { count: vi.fn().mockResolvedValue(1) },
    cameraGroup: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue({ id: GROUP, name: 'g' }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: GROUP, name: 'g' }),
      delete: vi.fn().mockResolvedValue({}),
      ...over,
    },
    $transaction: vi.fn((fn: any) => fn(tx)),
    tx,
  };
  vi.mocked(getPrisma).mockReturnValue(prisma as any);
  return prisma;
}

describe('camera groups', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the input', () => {
    expect(createCameraGroupSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(createCameraGroupSchema.safeParse({ name: 'x'.repeat(65) }).success).toBe(false);
    expect(createCameraGroupSchema.safeParse({ name: 'g', cameraIds: ['nope'] }).success).toBe(false);
    expect(createCameraGroupSchema.parse({ name: ' ประตู ' })).toEqual({ name: 'ประตู', cameraIds: [] });
  });

  it('refuses a duplicate name, ignoring case', async () => {
    const prisma = prismaMock({ findFirst: vi.fn().mockResolvedValue({ id: 'other' }) });
    await expect(createCameraGroup({ name: 'Gate', cameraIds: [] })).rejects.toMatchObject({ statusCode: 409, details: { code: 'CAMERA_GROUP_NAME_TAKEN' } });
    expect(prisma.cameraGroup.findFirst.mock.calls[0][0].where.name).toEqual({ equals: 'Gate', mode: 'insensitive' });
  });

  it('refuses cameras that do not exist or are in the trash', async () => {
    const prisma = prismaMock();
    prisma.camera.count.mockResolvedValue(0);
    await expect(createCameraGroup({ name: 'g', cameraIds: [CAM] })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.cameraGroup.create).not.toHaveBeenCalled();
    expect(prisma.camera.count.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it('replaces the members in one transaction, and leaves them alone when not given', async () => {
    const prisma = prismaMock();
    await updateCameraGroup(GROUP, { cameraIds: [CAM, CAM] });
    expect(prisma.tx.cameraGroupMember.deleteMany).toHaveBeenCalledWith({ where: { groupId: GROUP } });
    expect(prisma.tx.cameraGroupMember.createMany).toHaveBeenCalledWith({ data: [{ groupId: GROUP, cameraId: CAM }] });

    prisma.tx.cameraGroupMember.deleteMany.mockClear();
    await updateCameraGroup(GROUP, { name: 'new' });
    expect(prisma.tx.cameraGroupMember.deleteMany).not.toHaveBeenCalled();
  });

  it('flattens members and skips trashed cameras when listing', async () => {
    const prisma = prismaMock({ findMany: vi.fn().mockResolvedValue([{ id: GROUP, name: 'g', members: [{ cameraId: CAM }] }]) });
    expect(await listCameraGroups()).toEqual([{ id: GROUP, name: 'g', cameraIds: [CAM] }]);
    expect(prisma.cameraGroup.findMany.mock.calls[0][0].include.members.where).toEqual({ camera: { deletedAt: null } });
  });

  it('reports a missing group', async () => {
    prismaMock({ findUnique: vi.fn().mockResolvedValue(null) });
    await expect(deleteCameraGroup(GROUP)).rejects.toMatchObject({ statusCode: 404 });
    await expect(updateCameraGroup(GROUP, { name: 'x' })).rejects.toMatchObject({ statusCode: 404 });
  });
});
