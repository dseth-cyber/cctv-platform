import { getPrisma } from '../../lib/prisma.js';
import { getAllConfigs } from '../system-config/system-config.service.js';

/**
 * One row of user_sessions = one device signed in. Its id travels in the access token (`sid`) and on the refresh
 * token (`session_id`), so ending it ends that device at once: the next request is refused, and so is the refresh.
 *
 * Limit (approved 2026-11-16): a person may be signed in on login_max_sessions_per_user devices (default 2, 0 = no
 * limit), or their role's maxSessions. Signing in on one more lets the new device in and signs out the one used
 * least recently (reason `replaced`).
 */

/** A session not refreshed for this long is treated as gone (the refresh token has run out). */
export const SESSION_IDLE_DAYS = 7;
export const DEFAULT_MAX_SESSIONS = 2;

export type RevokeReason = 'replaced' | 'admin';

export async function sessionLimitFor(roleCode: string | null | undefined): Promise<number> {
  const prisma = getPrisma();
  const role = roleCode ? await prisma.customRole.findUnique({ where: { code: roleCode }, select: { maxSessions: true } }) : null;
  if (role?.maxSessions !== null && role?.maxSessions !== undefined) return role.maxSessions;
  const configs = await getAllConfigs();
  const n = Number(configs.login_max_sessions_per_user?.value ?? DEFAULT_MAX_SESSIONS);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_SESSIONS;
}

function activeWhere(userId: string, now = new Date()) {
  return {
    userId,
    logoutAt: null,
    revokedAt: null,
    lastActiveAt: { gte: new Date(now.getTime() - SESSION_IDLE_DAYS * 86_400_000) },
  };
}

export async function startSession(data: { userId: string; username: string; ipAddress?: string; userAgent?: string }) {
  return getPrisma().userSession.create({
    data: { userId: data.userId, username: data.username, ipAddress: data.ipAddress ?? null, userAgent: data.userAgent ?? null },
  });
}

/** Ends sessions and the refresh tokens that keep them alive. Returns how many were still open. */
export async function revokeSessions(ids: string[], reason: RevokeReason): Promise<number> {
  if (ids.length === 0) return 0;
  const prisma = getPrisma();
  const now = new Date();
  const ended = await prisma.userSession.updateMany({
    where: { id: { in: ids }, revokedAt: null, logoutAt: null },
    data: { revokedAt: now, revokedReason: reason, logoutAt: now },
  });
  await prisma.refreshToken.updateMany({ where: { sessionId: { in: ids }, revokedAt: null }, data: { revokedAt: now } });
  return ended.count;
}

/**
 * After a sign-in: keep the `limit` most recently used devices (always including the new one) and sign out the
 * rest. Returns the ones signed out, for the audit log.
 */
export async function enforceSessionLimit(userId: string, keepSessionId: string, limit: number) {
  if (limit <= 0) return [];
  const prisma = getPrisma();
  const active = await prisma.userSession.findMany({
    where: activeWhere(userId),
    select: { id: true, loginAt: true, lastActiveAt: true, ipAddress: true, userAgent: true },
    orderBy: [{ lastActiveAt: 'desc' }, { loginAt: 'desc' }],
    take: 200,
  });
  const others = active.filter((s) => s.id !== keepSessionId);
  const extra = others.slice(Math.max(0, limit - 1));
  await revokeSessions(extra.map((s) => s.id), 'replaced');
  return extra;
}

/** Logout: that device only. */
export async function endSession(sessionId: string) {
  const prisma = getPrisma();
  const s = await prisma.userSession.findUnique({ where: { id: sessionId } });
  if (!s || s.logoutAt) return null;
  const now = new Date();
  await prisma.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: now } });
  return prisma.userSession.update({
    where: { id: sessionId },
    data: { logoutAt: now, durationSeconds: Math.round((now.getTime() - s.loginAt.getTime()) / 1000) },
  });
}

/** A refresh: the device is still in use. */
export async function touchSession(sessionId: string) {
  await getPrisma().userSession.updateMany({ where: { id: sessionId, logoutAt: null, revokedAt: null }, data: { lastActiveAt: new Date() } });
}

/** Why a session no longer counts, or null while it is open. Read on every authenticated request. */
export async function sessionEndReason(sessionId: string): Promise<'replaced' | 'admin' | 'logout' | 'unknown' | null> {
  const s = await getPrisma().userSession.findUnique({ where: { id: sessionId }, select: { revokedAt: true, revokedReason: true, logoutAt: true } });
  if (!s) return 'unknown';
  if (s.revokedAt) return (s.revokedReason as 'replaced' | 'admin') ?? 'admin';
  if (s.logoutAt) return 'logout';
  return null;
}

export async function listActiveSessions(userId: string) {
  return getPrisma().userSession.findMany({
    where: activeWhere(userId),
    select: { id: true, loginAt: true, lastActiveAt: true, ipAddress: true, userAgent: true },
    orderBy: { lastActiveAt: 'desc' },
    take: 50,
  });
}
