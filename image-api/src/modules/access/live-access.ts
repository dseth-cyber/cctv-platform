import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { getUserPermissions } from '../../middleware/rbac.js';

/**
 * Watching is split out of "see cameras" (cameras:read), which still decides which cameras someone may see at all:
 * - live:view      live video and the overview's still images
 * - live:hd        the main stream; without it live is the sub stream when the camera has one
 * - playback:view  recordings, from the server or from a DVR/NVR, and the list of clips
 * - clips:export   cutting, cancelling and downloading clips
 */
export const LIVE_PERMISSIONS = ['live:view', 'live:hd', 'playback:view', 'clips:export'] as const;
export type LivePermission = (typeof LIVE_PERMISSIONS)[number];

export const LIVE_QUOTA_MIN = 1;
export const LIVE_QUOTA_MAX = 64;

export async function hasPermissionFor(userId: string | undefined, permission: string): Promise<boolean> {
  if (!userId) return false;
  const permissions = await getUserPermissions(userId);
  return permissions.includes('*') || permissions.includes(permission);
}

/**
 * When the split arrives, nobody loses what they had: every role and person that could see cameras gets all four.
 * (Before, a person who could see cameras could watch, play back and download clips.) Runs once.
 */
export async function ensureLivePermissionSplit() {
  const prisma = getPrisma();
  const FLAG = 'live_permissions_ready';
  if (await prisma.systemConfig.findUnique({ where: { key: FLAG } })) return;
  const add = (list: unknown) => {
    const have = Array.isArray(list) ? (list as string[]) : [];
    if (!have.includes('cameras:read')) return null;
    const next = [...new Set([...have, ...LIVE_PERMISSIONS])];
    return next.length === have.length ? null : next;
  };
  let roles = 0;
  for (const role of await prisma.customRole.findMany({ select: { id: true, permissions: true } })) {
    const next = add(role.permissions);
    if (next) { await prisma.customRole.update({ where: { id: role.id }, data: { permissions: next } }); roles++; }
  }
  let users = 0;
  for (const user of await prisma.user.findMany({ select: { id: true, customPermissions: true } })) {
    const next = add(user.customPermissions);
    if (next) { await prisma.user.update({ where: { id: user.id }, data: { customPermissions: next } }); users++; }
  }
  await prisma.systemConfig.create({ data: { key: FLAG, value: 'true', valueType: 'boolean', category: 'internal', description: 'Roles and people who could see cameras were given the live, HD, playback and clip rights when they were split out' } });
  logger.info({ roles, users }, 'Live rights given to everyone who could see cameras');
}

/** Live tiles one person may have at once: their own value, else their role's, else the system value. */
export async function liveQuotaFor(userId: string | undefined, systemValue: number): Promise<number> {
  if (!userId) return systemValue;
  const prisma = getPrisma();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { liveQuota: true, role: true } });
  if (user?.liveQuota) return user.liveQuota;
  if (!user?.role) return systemValue;
  const role = await prisma.customRole.findUnique({ where: { code: user.role }, select: { liveQuota: true } });
  return role?.liveQuota ?? systemValue;
}
