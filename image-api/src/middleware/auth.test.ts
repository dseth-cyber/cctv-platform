import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from './auth.js';

const table = { user: { findUnique: vi.fn() }, userSession: { findUnique: vi.fn() } };
vi.mock('../lib/prisma.js', () => ({ getPrisma: () => table }));
vi.mock('../config/index.js', () => ({ config: { serviceApiKey: 'service-key' } }));

const signedIn = () => ({
  headers: {},
  user: { id: 'u1', role: 'operator' },
  jwtVerify: vi.fn().mockResolvedValue(undefined),
}) as any;

describe('authenticate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lets a working account through', async () => {
    table.user.findUnique.mockResolvedValue({ enabled: true, deletedAt: null });
    await expect(authenticate(signedIn(), {} as any)).resolves.toBeUndefined();
  });

  it.each([
    ['switched off', { enabled: false, deletedAt: null }],
    ['deleted', { enabled: false, deletedAt: new Date() }],
    ['gone', null],
  ])('refuses a valid token for an account that is %s', async (_name, account) => {
    table.user.findUnique.mockResolvedValue(account);
    await expect(authenticate(signedIn(), {} as any)).rejects.toThrow(/no longer active/);
  });

  it('keeps a database failure an error rather than calling the token invalid', async () => {
    table.user.findUnique.mockRejectedValue(new Error('database unavailable'));
    await expect(authenticate(signedIn(), {} as any)).rejects.toThrow('database unavailable');
  });

  it('refuses a valid token of a device that was signed out, at once, and says why', async () => {
    table.user.findUnique.mockResolvedValue({ enabled: true, deletedAt: null });
    const withSid = () => ({ ...signedIn(), user: { id: 'u1', role: 'operator', sid: 's1' } });
    table.userSession.findUnique.mockResolvedValue({ revokedAt: new Date(), revokedReason: 'replaced', logoutAt: new Date() });
    await expect(authenticate(withSid(), {} as any)).rejects.toMatchObject({ statusCode: 401, details: { code: 'SESSION_REPLACED' } });
    table.userSession.findUnique.mockResolvedValue({ revokedAt: null, revokedReason: null, logoutAt: new Date() });
    await expect(authenticate(withSid(), {} as any)).rejects.toMatchObject({ details: { code: 'SESSION_ENDED' } });
    table.userSession.findUnique.mockResolvedValue({ revokedAt: null, revokedReason: null, logoutAt: null });
    await expect(authenticate(withSid(), {} as any)).resolves.toBeUndefined();
  });

  it('a token from before sessions were tracked (no sid) still works until it expires', async () => {
    table.user.findUnique.mockResolvedValue({ enabled: true, deletedAt: null });
    await expect(authenticate(signedIn(), {} as any)).resolves.toBeUndefined();
    expect(table.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('does not look up the service key, which is not an account', async () => {
    const request = { headers: { 'x-service-api-key': 'service-key' } } as any;
    await expect(authenticate(request, {} as any)).resolves.toBeUndefined();
    expect(request.user.role).toBe('system');
    expect(table.user.findUnique).not.toHaveBeenCalled();
  });
});
