import { getPrisma } from '../../lib/prisma.js';

export async function listTelegramUsers() {
  const prisma = getPrisma();
  return prisma.telegramUser.findMany({
    orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
  });
}

export async function getByTelegramId(telegramId: string) {
  const prisma = getPrisma();
  return prisma.telegramUser.findUnique({ where: { telegramId } });
}

export async function isApproved(telegramId: string): Promise<boolean> {
  const user = await getByTelegramId(telegramId);
  return user?.status === 'approved';
}

/**
 * Records a request without overwriting a decision that has already been made — a
 * previously rejected user pressing the button again must not silently reset themselves
 * to "pending" and re-spam the group.
 */
export async function recordAccessRequest(input: { telegramId: string; firstName?: string; username?: string }) {
  const prisma = getPrisma();
  const existing = await prisma.telegramUser.findUnique({ where: { telegramId: input.telegramId } });
  if (existing) {
    return prisma.telegramUser.update({
      where: { telegramId: input.telegramId },
      data: { firstName: input.firstName, username: input.username, lastSeenAt: new Date() },
    });
  }
  return prisma.telegramUser.create({
    data: {
      telegramId: input.telegramId,
      firstName: input.firstName,
      username: input.username,
      status: 'pending',
      lastSeenAt: new Date(),
    },
  });
}

export async function setStatus(telegramId: string, status: 'approved' | 'rejected' | 'pending', decidedBy: string) {
  const prisma = getPrisma();
  return prisma.telegramUser.upsert({
    where: { telegramId },
    update: { status, decidedBy, decidedAt: new Date() },
    create: { telegramId, status, decidedBy, decidedAt: new Date() },
  });
}

export async function addApprovedUser(input: { telegramId: string; firstName?: string; decidedBy: string }) {
  const prisma = getPrisma();
  return prisma.telegramUser.upsert({
    where: { telegramId: input.telegramId },
    update: { status: 'approved', firstName: input.firstName, decidedBy: input.decidedBy, decidedAt: new Date() },
    create: {
      telegramId: input.telegramId,
      firstName: input.firstName,
      status: 'approved',
      decidedBy: input.decidedBy,
      decidedAt: new Date(),
    },
  });
}

export async function deleteTelegramUser(telegramId: string) {
  const prisma = getPrisma();
  return prisma.telegramUser.delete({ where: { telegramId } });
}

export async function touchLastSeen(telegramId: string) {
  const prisma = getPrisma();
  await prisma.telegramUser.updateMany({ where: { telegramId }, data: { lastSeenAt: new Date() } });
}
