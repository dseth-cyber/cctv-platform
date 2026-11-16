import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { getPrisma } from '../../lib/prisma.js';
import { auditDefaultPasswords } from './release.service.js';

describe('seeded accounts check (no sign-in attempt, so no lockout count)', () => {
  let users: any[];
  beforeEach(() => {
    users = [];
    vi.mocked(getPrisma).mockReturnValue({ user: { findMany: vi.fn(async () => users) } } as any);
  });
  afterEach(() => { delete process.env.DEPLOY_ENV; });

  it('passes when none of the seeded accounts still takes its seed password', async () => {
    users = [{ username: 'admin', password: bcrypt.hashSync('a-real-new-password', 4) }];
    expect(await auditDefaultPasswords()).toMatchObject({ id: 'sec-default-passwords', status: 'passed' });
  });

  it('names the accounts still on the seed password: failed on production, warning elsewhere', async () => {
    users = [
      { username: 'admin', password: bcrypt.hashSync('admin123', 4) },
      { username: 'viewer', password: bcrypt.hashSync('changed', 4) },
    ];
    expect(await auditDefaultPasswords()).toMatchObject({ status: 'warning', details: expect.stringContaining('admin') });
    process.env.DEPLOY_ENV = 'production';
    const r = await auditDefaultPasswords();
    expect(r.status).toBe('failed');
    expect(r.details).not.toContain('viewer');
    expect(r.details).not.toContain('admin123');
  });
});
