import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getUserPermissions, requirePermission } from './rbac.js';

const table = { user: { findUnique: vi.fn() }, customRole: { findUnique: vi.fn() } };
vi.mock('../lib/prisma.js', () => ({ getPrisma: () => table }));

const person = (over = {}) => ({ id: 'u1', role: 'operator', enabled: true, deletedAt: null, customPermissions: [], ...over });
const check = (permission: string, user: Record<string, string>) => (requirePermission(permission) as any)({ user }, {});

describe('account state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    table.customRole.findUnique.mockResolvedValue({ permissions: ['cameras:read'] });
  });

  it('gives a working account its role', async () => {
    table.user.findUnique.mockResolvedValue(person());
    await expect(getUserPermissions('u1')).resolves.toEqual(['cameras:read']);
  });

  it('gives nothing to an account switched off or deleted', async () => {
    table.user.findUnique.mockResolvedValue(person({ enabled: false }));
    await expect(getUserPermissions('u1')).resolves.toEqual([]);
    table.user.findUnique.mockResolvedValue(person({ deletedAt: new Date() }));
    await expect(getUserPermissions('u1')).resolves.toEqual([]);
  });

  it('stops a token that still says admin once the account has ended', async () => {
    table.user.findUnique.mockResolvedValue(person({ role: 'admin', enabled: false }));
    await expect(check('cameras:read', { id: 'u1', role: 'admin' })).rejects.toThrow(/permission/i);
  });

  it('goes by the account, not by what an old token says', async () => {
    table.user.findUnique.mockResolvedValue(person({ role: 'viewer' }));
    table.customRole.findUnique.mockResolvedValue({ permissions: [] });
    await expect(check('cameras:read', { id: 'u1', role: 'admin' })).rejects.toThrow(/permission/i);
  });

  it('lets a working admin through', async () => {
    table.user.findUnique.mockResolvedValue(person({ role: 'admin' }));
    await expect(check('anything:at-all', { id: 'u1', role: 'admin' })).resolves.toBeUndefined();
  });

  it('lets the service key through, which is not an account', async () => {
    await expect(check('anything:at-all', { id: 'system-service', role: 'system' })).resolves.toBeUndefined();
    expect(table.user.findUnique).not.toHaveBeenCalled();
  });
});
