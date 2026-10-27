import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../../lib/prisma.js';
import { UnauthorizedError, ValidationError } from '../../lib/errors.js';
import { isLocked, recordFailedLogin, clearFailedLogins } from '../../lib/login-security.js';
import { createAuditLog } from '../audit/audit.service.js';
import { createAlert } from '../alerts/alerts.service.js';
import type { LoginInput, ChangePasswordInput, RefreshInput, UpdateMenuPreferencesInput } from './auth.schema.js';

// Records a failed attempt (username-scoped, not tied to whether the account is real —
// avoids leaking account existence through lockout behavior) and, only on the specific
// call that crosses the threshold, writes an audit log entry + fires a Telegram alert.
async function handleFailedLogin(username: string, ip?: string): Promise<void> {
  const result = await recordFailedLogin(username);

  createAuditLog({
    action: 'login_failed',
    entity: 'auth',
    entityId: username,
    description: `Failed login attempt for "${username}" (${result.count}/${result.maxAttempts})`,
    metadata: { username, attemptNumber: result.count },
    ipAddress: ip,
  }).catch(() => {});

  if (result.justLocked) {
    createAlert({
      alertType: 'auth_anomaly',
      severity: 'critical',
      source: username,
      title: `Suspicious login activity: ${username}`,
      message: `${result.count} failed login attempts for user "${username}"${ip ? ` from IP ${ip}` : ''} within ${result.windowMinutes} minute(s) — account locked for ${result.lockoutMinutes} minute(s).`,
      details: { username, ip, count: result.count, windowMinutes: result.windowMinutes, lockoutMinutes: result.lockoutMinutes },
    }).catch(() => {});
  }
}

export async function login(input: LoginInput, ip?: string) {
  const prisma = getPrisma();

  if (await isLocked(input.username)) {
    throw new UnauthorizedError('Account temporarily locked due to too many failed login attempts. Try again later.');
  }

  const user = await prisma.user.findUnique({ where: { username: input.username } });
  if (!user || !user.enabled) {
    await handleFailedLogin(input.username, ip);
    throw new UnauthorizedError('Invalid username or password');
  }

  const valid = await bcrypt.compare(input.password, user.password);
  if (!valid) {
    await handleFailedLogin(input.username, ip);
    throw new UnauthorizedError('Invalid username or password');
  }

  await clearFailedLogins(input.username);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    hiddenMenuItems: Array.isArray(user.hiddenMenuItems) ? (user.hiddenMenuItems as string[]) : [],
    uiPreferences: (user.uiPreferences && typeof user.uiPreferences === 'object') ? user.uiPreferences : {},
  };
}

// Self-service password change (authenticated user, own account) — the strong password
// policy (strongPasswordSchema, applied to newPassword by the caller's Zod schema) only
// gates newly-set passwords, never retroactively invalidates an existing one; this is
// one of the two places (the other being the Users admin page) a password actually gets
// (re)validated against it.
export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const valid = await bcrypt.compare(input.currentPassword, user.password);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const sameAsOld = await bcrypt.compare(input.newPassword, user.password);
  if (sameAsOld) {
    throw new ValidationError('New password must be different from the current password');
  }

  const hashed = await bcrypt.hash(input.newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } });

  createAuditLog({
    userId,
    action: 'password_changed',
    entity: 'user',
    entityId: userId,
    description: `User "${user.username}" changed their own password`,
  }).catch(() => {});
}

export async function updateMenuPreferences(userId: string, input: UpdateMenuPreferencesInput) {
  const prisma = getPrisma();
  await prisma.user.update({
    where: { id: userId },
    data: { hiddenMenuItems: input.hiddenMenuItems },
  });
  return { hiddenMenuItems: input.hiddenMenuItems };
}

// Shallow-merge a partial preferences object into the user's stored uiPreferences,
// keyed by page id — so updating one page's table settings never clobbers another's.
export async function updateUiPreferences(userId: string, patch: Record<string, unknown>) {
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { uiPreferences: true } });
  const existing = (user?.uiPreferences && typeof user.uiPreferences === 'object') ? user.uiPreferences as Record<string, unknown> : {};
  const merged = { ...existing, ...patch };
  await prisma.user.update({ where: { id: userId }, data: { uiPreferences: merged as Prisma.InputJsonValue } });
  return { uiPreferences: merged };
}

export async function createRefreshToken(userId: string): Promise<string> {
  const prisma = getPrisma();
  const token = crypto.randomBytes(64).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  await prisma.refreshToken.create({
    data: { userId, token, expiresAt },
  });

  return token;
}

export async function verifyRefreshToken(input: RefreshInput) {
  const prisma = getPrisma();

  const stored = await prisma.refreshToken.findUnique({ where: { token: input.refreshToken } });
  if (!stored || stored.revokedAt) {
    throw new UnauthorizedError('Invalid refresh token');
  }
  if (stored.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  const user = await prisma.user.findUnique({ where: { id: stored.userId } });
  if (!user || !user.enabled) {
    throw new UnauthorizedError('User not found or disabled');
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return { id: user.id, username: user.username, email: user.email, role: user.role };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const prisma = getPrisma();
  await prisma.refreshToken.updateMany({
    where: { token, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
