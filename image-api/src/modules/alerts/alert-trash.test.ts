import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteFromTrash, listAlerts, moveAllToTrash, moveToTrash, restoreFromTrash } from './alerts.service.js';

const mockPrisma = {
  alert: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0), updateMany: vi.fn(), deleteMany: vi.fn() },
  camera: { findMany: vi.fn() },
};
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => mockPrisma }));

describe('alert trash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.alert.updateMany.mockResolvedValue({ count: 3 });
    mockPrisma.alert.deleteMany.mockResolvedValue({ count: 2 });
  });

  it('leaves the trash out of the normal list and shows only it when asked', async () => {
    await listAlerts({});
    expect(mockPrisma.alert.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
    await listAlerts({ trash: true });
    expect(mockPrisma.alert.findMany.mock.calls[1][0].where.deletedAt).toEqual({ not: null });
  });

  it('closes open alerts before moving everything, so nothing in the trash still counts as open', async () => {
    expect(await moveAllToTrash('admin')).toBe(3);
    const [close, move] = mockPrisma.alert.updateMany.mock.calls.map(([arg]) => arg);
    expect(close.where).toEqual({ deletedAt: null, resolvedAt: null });
    expect(close.data).toMatchObject({ resolvedBy: 'admin' });
    expect(move.where).toEqual({ deletedAt: null });
    expect(move.data).toMatchObject({ deletedBy: 'admin', deletedAt: expect.any(Date) });
  });

  it('moves one alert and touches no other', async () => {
    await moveToTrash('a-1', 'admin');
    mockPrisma.alert.updateMany.mock.calls.forEach(([arg]) => expect(arg.where.id).toBe('a-1'));
  });

  it('never deletes for good anything outside the trash', async () => {
    expect(await deleteFromTrash()).toBe(2);
    expect(mockPrisma.alert.deleteMany.mock.calls[0][0].where).toEqual({ deletedAt: { not: null } });
    await deleteFromTrash('a-1');
    expect(mockPrisma.alert.deleteMany.mock.calls[1][0].where).toEqual({ id: 'a-1', deletedAt: { not: null } });
  });

  it('restores only from the trash', async () => {
    await restoreFromTrash('a-1');
    expect(mockPrisma.alert.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'a-1', deletedAt: { not: null } }, data: { deletedAt: null, deletedBy: null } });
  });
});
