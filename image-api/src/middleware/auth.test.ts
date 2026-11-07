import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from './auth.js';

const table = { user: { findUnique: vi.fn() } };
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

  it('does not look up the service key, which is not an account', async () => {
    const request = { headers: { 'x-service-api-key': 'service-key' } } as any;
    await expect(authenticate(request, {} as any)).resolves.toBeUndefined();
    expect(request.user.role).toBe('system');
    expect(table.user.findUnique).not.toHaveBeenCalled();
  });
});
