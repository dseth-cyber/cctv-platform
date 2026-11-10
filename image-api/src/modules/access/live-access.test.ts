import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { ensureLivePermissionSplit, LIVE_PERMISSIONS, liveQuotaFor } from './live-access.js';

vi.mock('../../lib/prisma.js', () => ({ getPrisma: vi.fn() }));
vi.mock('../../middleware/rbac.js', () => ({ getUserPermissions: vi.fn(async () => []) }));

function prismaMock(over: { flag?: boolean; roles?: any[]; users?: any[]; user?: any; role?: any } = {}) {
  const prisma = {
    systemConfig: { findUnique: vi.fn().mockResolvedValue(over.flag ? { key: 'x' } : null), create: vi.fn().mockResolvedValue({}) },
    customRole: { findMany: vi.fn().mockResolvedValue(over.roles ?? []), update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(over.role ?? null) },
    user: { findMany: vi.fn().mockResolvedValue(over.users ?? []), update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue(over.user ?? null) },
  };
  vi.mocked(getPrisma).mockReturnValue(prisma as any);
  return prisma;
}

describe('live rights split', () => {
  beforeEach(() => vi.clearAllMocks());

  it('everyone who could see cameras gets all four; others are left alone', async () => {
    const p = prismaMock({
      roles: [{ id: 'op', permissions: ['cameras:read', 'cameras:update'] }, { id: 'acct', permissions: ['reports:read'] }],
      users: [{ id: 'u1', customPermissions: ['cameras:read'] }, { id: 'u2', customPermissions: [] }],
    });
    await ensureLivePermissionSplit();
    expect(p.customRole.update).toHaveBeenCalledTimes(1);
    expect(p.customRole.update.mock.calls[0][0].data.permissions).toEqual(['cameras:read', 'cameras:update', ...LIVE_PERMISSIONS]);
    expect(p.user.update).toHaveBeenCalledTimes(1);
    expect(p.systemConfig.create).toHaveBeenCalled();
  });

  it('runs once: after the flag nothing changes, so a right taken away later stays away', async () => {
    const p = prismaMock({ flag: true, roles: [{ id: 'op', permissions: ['cameras:read'] }] });
    await ensureLivePermissionSplit();
    expect(p.customRole.findMany).not.toHaveBeenCalled();
    expect(p.customRole.update).not.toHaveBeenCalled();
  });
});

describe('live quota per person', () => {
  beforeEach(() => vi.clearAllMocks());
  it('own value, else the role\'s, else the system value', async () => {
    prismaMock({ user: { liveQuota: 2, role: 'viewer' }, role: { liveQuota: 4 } });
    expect(await liveQuotaFor('u', 16)).toBe(2);
    prismaMock({ user: { liveQuota: null, role: 'viewer' }, role: { liveQuota: 4 } });
    expect(await liveQuotaFor('u', 16)).toBe(4);
    prismaMock({ user: { liveQuota: null, role: 'operator' }, role: { liveQuota: null } });
    expect(await liveQuotaFor('u', 16)).toBe(16);
  });
});
