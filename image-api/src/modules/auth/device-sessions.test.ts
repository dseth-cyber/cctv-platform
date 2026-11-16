import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPrisma } from '../../lib/prisma.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { enforceSessionLimit, sessionLimitFor, sessionEndReason, endSession } from './device-sessions.js';

vi.mock('../system-config/system-config.service.js', () => ({ getAllConfigs: vi.fn() }));

const MIN = 60_000;
const now = Date.now();

/** In-memory user_sessions + refresh_tokens: just what the session rules touch. */
function fakeDb(sessions: any[], tokens: any[] = [], roles: Record<string, number | null> = {}) {
  const S = sessions.map((s) => ({ logoutAt: null, revokedAt: null, revokedReason: null, ipAddress: null, userAgent: null, loginAt: new Date(now - 60 * MIN), ...s }));
  const T = tokens.map((t) => ({ revokedAt: null, ...t }));
  const match = (row: any, where: any) => Object.entries(where).every(([k, v]: [string, any]) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('gte' in v) return row[k] >= v.gte;
    }
    return v === null ? row[k] == null : row[k] === v;
  });
  vi.mocked(getPrisma).mockReturnValue({
    customRole: { findUnique: vi.fn(async ({ where }: any) => (where.code in roles ? { maxSessions: roles[where.code] } : null)) },
    userSession: {
      findMany: vi.fn(async ({ where }: any) => S.filter((s) => match(s, where)).sort((a, b) => b.lastActiveAt - a.lastActiveAt)),
      findUnique: vi.fn(async ({ where }: any) => S.find((s) => s.id === where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => { const hit = S.filter((s) => match(s, where)); hit.forEach((h) => Object.assign(h, data)); return { count: hit.length }; }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(S.find((s) => s.id === where.id)!, data)),
    },
    refreshToken: {
      updateMany: vi.fn(async ({ where, data }: any) => { const hit = T.filter((t) => match(t, where)); hit.forEach((h) => Object.assign(h, data)); return { count: hit.length }; }),
    },
  } as any);
  return { S, T };
}

describe('device sessions (limit approved 2026-11-16: newest device wins, default 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllConfigs).mockResolvedValue({ login_max_sessions_per_user: { value: 2 } } as any);
  });

  it('with a limit of 2, a third sign-in ends the device used least recently, and its refresh tokens', async () => {
    const { S, T } = fakeDb(
      [
        { id: 'pc', userId: 'u', lastActiveAt: new Date(now - 5 * MIN) },
        { id: 'phone', userId: 'u', lastActiveAt: new Date(now - 90 * MIN) },
        { id: 'new', userId: 'u', lastActiveAt: new Date(now) },
        { id: 'someone-else', userId: 'x', lastActiveAt: new Date(now - 200 * MIN) },
      ],
      [{ id: 't-phone', sessionId: 'phone' }, { id: 't-pc', sessionId: 'pc' }],
    );
    const ended = await enforceSessionLimit('u', 'new', 2);
    expect(ended.map((s) => s.id)).toEqual(['phone']);
    expect(S.find((s) => s.id === 'phone')).toMatchObject({ revokedReason: 'replaced' });
    expect(S.find((s) => s.id === 'pc')!.revokedAt).toBeNull();
    expect(S.find((s) => s.id === 'someone-else')!.revokedAt).toBeNull();
    expect(T.find((t) => t.id === 't-phone')!.revokedAt).toBeInstanceOf(Date);
    expect(T.find((t) => t.id === 't-pc')!.revokedAt).toBeNull();
  });

  it('the new device is kept even if its clock row sorts oldest; 0 means no limit', async () => {
    fakeDb([
      { id: 'a', userId: 'u', lastActiveAt: new Date(now) },
      { id: 'new', userId: 'u', lastActiveAt: new Date(now - 10 * MIN) },
    ]);
    expect((await enforceSessionLimit('u', 'new', 1)).map((s) => s.id)).toEqual(['a']);
    fakeDb([{ id: 'a', userId: 'u', lastActiveAt: new Date(now) }, { id: 'b', userId: 'u', lastActiveAt: new Date(now) }]);
    expect(await enforceSessionLimit('u', 'b', 0)).toEqual([]);
  });

  it('sessions idle past the refresh period do not count', async () => {
    fakeDb([
      { id: 'stale', userId: 'u', lastActiveAt: new Date(now - 8 * 24 * 60 * MIN) },
      { id: 'pc', userId: 'u', lastActiveAt: new Date(now - MIN) },
      { id: 'new', userId: 'u', lastActiveAt: new Date(now) },
    ]);
    expect(await enforceSessionLimit('u', 'new', 2)).toEqual([]);
  });

  it('a role can set its own limit; otherwise the system setting; a bad setting falls back to 2', async () => {
    fakeDb([], [], { operator: 1, viewer: null });
    expect(await sessionLimitFor('operator')).toBe(1);
    expect(await sessionLimitFor('viewer')).toBe(2);
    vi.mocked(getAllConfigs).mockResolvedValue({ login_max_sessions_per_user: { value: 0 } } as any);
    expect(await sessionLimitFor('viewer')).toBe(0);
    vi.mocked(getAllConfigs).mockResolvedValue({ login_max_sessions_per_user: { value: 'x' } } as any);
    expect(await sessionLimitFor(null)).toBe(2);
  });

  it('tells why a session ended; logout ends only that device and its refresh tokens', async () => {
    const { S, T } = fakeDb(
      [
        { id: 'r', userId: 'u', lastActiveAt: new Date(now), revokedAt: new Date(), revokedReason: 'replaced' },
        { id: 'open', userId: 'u', lastActiveAt: new Date(now) },
        { id: 'other', userId: 'u', lastActiveAt: new Date(now) },
      ],
      [{ id: 't1', sessionId: 'open' }, { id: 't2', sessionId: 'other' }],
    );
    expect(await sessionEndReason('r')).toBe('replaced');
    expect(await sessionEndReason('open')).toBeNull();
    expect(await sessionEndReason('missing')).toBe('unknown');
    await endSession('open');
    expect(await sessionEndReason('open')).toBe('logout');
    expect(S.find((s) => s.id === 'other')!.logoutAt).toBeNull();
    expect(T.find((t) => t.id === 't1')!.revokedAt).toBeInstanceOf(Date);
    expect(T.find((t) => t.id === 't2')!.revokedAt).toBeNull();
  });
});
