import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stand-in for the few Redis commands login-security uses (expiry is not needed for these cases).
const store = new Map<string, number | string>();
const fakeRedis = {
  async get(k: string) {
    return store.has(k) ? String(store.get(k)) : null;
  },
  async incr(k: string) {
    const v = Number(store.get(k) ?? 0) + 1;
    store.set(k, v);
    return v;
  },
  async expire() {
    return 1;
  },
  async set(k: string, v: string, ...args: unknown[]) {
    if (args.includes('NX') && store.has(k)) return null;
    store.set(k, v);
    return 'OK';
  },
  async del(...keys: string[]) {
    let n = 0;
    for (const k of keys) if (store.delete(k)) n++;
    return n;
  },
  async scan(_cursor: string, _match: string, pattern: string) {
    const unescaped = pattern.replace(/\\(.)/g, '$1');
    const prefix = unescaped.slice(0, unescaped.indexOf('|*') + 1);
    return ['0', [...store.keys()].filter((k) => k.startsWith(prefix))];
  },
};

vi.mock('./redis.js', () => ({ getRedisClient: () => fakeRedis }));
vi.mock('../modules/system-config/system-config.service.js', () => ({
  getAllConfigs: async () => ({
    login_max_failed_attempts: { value: '5' },
    login_failure_window_minutes: { value: '10' },
    login_lockout_minutes: { value: '15' },
  }),
}));

const { isLocked, recordFailedLogin, clearFailedLogins, unlockUser } = await import('./login-security.js');

async function fail(user: string, ip: string, times: number) {
  let last;
  for (let i = 0; i < times; i++) last = await recordFailedLogin(user, ip);
  return last!;
}

describe('login lockout per username + address', () => {
  beforeEach(() => store.clear());

  it('five wrong passwords from one address lock that address only', async () => {
    const r = await fail('admin', '203.0.113.9', 5);
    expect(r.justLocked).toBe(true);
    expect(r.lockedScope).toBe('address');
    expect(await isLocked('admin', '203.0.113.9')).toBe(true);
    // The real admin, from the office, can still sign in: an outsider cannot lock the account for everyone.
    expect(await isLocked('admin', '192.168.30.50')).toBe(false);
    // The users page sees the account as locked (from somewhere).
    expect(await isLocked('admin')).toBe(true);
  });

  it('alerts once per lock, not on every attempt after', async () => {
    await fail('admin', '203.0.113.9', 5);
    const after = await recordFailedLogin('admin', '203.0.113.9');
    expect(after.justLocked).toBe(false);
  });

  it('a guessing run spread over many addresses still locks the username everywhere', async () => {
    let r;
    for (let i = 0; i < 20; i++) r = await recordFailedLogin('admin', `198.51.100.${i}`);
    expect(r!.lockedScope).toBe('everywhere');
    expect(await isLocked('admin', '192.168.30.50')).toBe(true);
  });

  it('a correct password clears only its own address', async () => {
    await fail('admin', '203.0.113.9', 4);
    await fail('admin', '192.168.30.50', 2);
    await clearFailedLogins('admin', '192.168.30.50');
    const r = await recordFailedLogin('admin', '203.0.113.9');
    expect(r.lockedScope).toBe('address');
  });

  it('unlock clears every lock of the username and nothing of others', async () => {
    await fail('admin', '203.0.113.9', 5);
    await fail('viewer', '203.0.113.9', 5);
    expect(await unlockUser('admin')).toBe(true);
    expect(await isLocked('admin')).toBe(false);
    expect(await isLocked('viewer')).toBe(true);
  });

  it('usernames are case-insensitive and glob characters do not reach other accounts', async () => {
    await fail('Admin', '203.0.113.9', 5);
    expect(await isLocked('admin', '203.0.113.9')).toBe(true);
    expect(await isLocked('a*')).toBe(false);
  });
});
