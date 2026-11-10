import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { createMasterdata, deleteMasterdata, updateMasterdata } from './masterdata.service.js';

vi.mock('../../lib/prisma.js', () => ({ getPrisma: vi.fn() }));

const ROW = { id: 'm1', type: 'camera_status', code: 'active', nameTh: 'ทำงาน', isActive: true };

function prismaMock(row: Record<string, unknown> = ROW) {
  const prisma = {
    masterdata: {
      findUnique: vi.fn().mockResolvedValue(row),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(async ({ data }: any) => data),
      update: vi.fn(async ({ data }: any) => ({ ...row, ...data })),
      delete: vi.fn().mockResolvedValue(row),
      count: vi.fn().mockResolvedValue(0),
    },
    camera: { count: vi.fn().mockResolvedValue(0) },
    device: { count: vi.fn().mockResolvedValue(0) },
  };
  vi.mocked(getPrisma).mockReturnValue(prisma as any);
  return prisma;
}

describe('camera statuses: codes fixed, names editable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('a new camera status cannot be added', async () => {
    const p = prismaMock();
    await expect(createMasterdata({ type: 'camera_status', code: 'waiting_repair', nameTh: 'รอซ่อม' } as any)).rejects.toThrow(/only their names/);
    expect(p.masterdata.create).not.toHaveBeenCalled();
  });

  it('one cannot be removed, renamed in code, or switched off', async () => {
    const p = prismaMock();
    await expect(deleteMasterdata('m1')).rejects.toThrow(/only their names/);
    await expect(updateMasterdata('m1', { code: 'up' } as any)).rejects.toThrow(/only their names/);
    await expect(updateMasterdata('m1', { isActive: false } as any)).rejects.toThrow(/only their names/);
    expect(p.masterdata.delete).not.toHaveBeenCalled();
    expect(p.masterdata.update).not.toHaveBeenCalled();
  });

  it('its name can still change', async () => {
    const p = prismaMock();
    await updateMasterdata('m1', { nameTh: 'ออนไลน์' } as any);
    expect(p.masterdata.update).toHaveBeenCalled();
  });

  it('other lists are not affected', async () => {
    const p = prismaMock({ id: 'r1', type: 'incident_reason', code: 'power', isActive: true });
    p.masterdata.findUnique.mockResolvedValue(null); // the new code is free
    await createMasterdata({ type: 'incident_reason', code: 'flood', nameTh: 'น้ำท่วม' } as any);
    expect(p.masterdata.create).toHaveBeenCalled();
  });
});
