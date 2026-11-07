import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deactivateUser } from './users.service.js';

const table = {
  user: { findUnique: vi.fn(), update: vi.fn().mockReturnValue('update'), count: vi.fn() },
  refreshToken: { updateMany: vi.fn().mockReturnValue('revoke') },
  auditLog: { updateMany: vi.fn() },
  $transaction: vi.fn().mockResolvedValue([]),
};
vi.mock('../../lib/prisma.js', () => ({ getPrisma: () => table }));

describe('deactivateUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    table.user.findUnique.mockResolvedValue({ role: 'operator' });
    table.user.update.mockReturnValue('update');
    table.refreshToken.updateMany.mockReturnValue('revoke');
  });

  it('ends the account, keeps the row and cuts off its tokens together', async () => {
    await expect(deactivateUser('u1', { id: 'a1', username: 'admin' })).resolves.toEqual({ id: 'u1', deleted: true });
    const { data } = table.user.update.mock.calls[0][0];
    expect(data).toMatchObject({ enabled: false, deletedBy: 'admin' });
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(table.refreshToken.updateMany.mock.calls[0][0].where).toEqual({ userId: 'u1', revokedAt: null });
    expect(table.$transaction).toHaveBeenCalledWith(['update', 'revoke']);
  });

  it('leaves the audit log pointing at who did what', async () => {
    await deactivateUser('u1', { id: 'a1', username: 'admin' });
    expect(table.auditLog.updateMany).not.toHaveBeenCalled();
  });

  it('refuses someone deleting themselves', async () => {
    await expect(deactivateUser('u1', { id: 'u1' })).rejects.toMatchObject({ code: 'SELF_DELETE' });
    expect(table.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to remove the last administrator', async () => {
    table.user.findUnique.mockResolvedValue({ role: 'admin' });
    table.user.count.mockResolvedValue(0);
    await expect(deactivateUser('u2', { id: 'a1' })).rejects.toMatchObject({ code: 'LAST_ADMIN' });
  });

  it('allows removing an administrator when another remains', async () => {
    table.user.findUnique.mockResolvedValue({ role: 'admin' });
    table.user.count.mockResolvedValue(1);
    await expect(deactivateUser('u2', { id: 'a1' })).resolves.toMatchObject({ deleted: true });
  });
});
