import { getPrisma } from '../../lib/prisma.js';

export async function createSession(data: {
  userId: string;
  username: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const prisma = getPrisma();
  return prisma.userSession.create({
    data: {
      userId: data.userId,
      username: data.username,
      ipAddress: data.ipAddress ?? null,
      userAgent: data.userAgent ?? null,
    },
  });
}

export async function endSession(userId: string) {
  const prisma = getPrisma();
  const session = await prisma.userSession.findFirst({
    where: { userId, logoutAt: null },
    orderBy: { loginAt: 'desc' },
  });
  if (!session) return null;

  const now = new Date();
  const durationSeconds = Math.round((now.getTime() - session.loginAt.getTime()) / 1000);

  return prisma.userSession.update({
    where: { id: session.id },
    data: { logoutAt: now, durationSeconds },
  });
}

export async function updateLastActive(userId: string) {
  const prisma = getPrisma();
  const session = await prisma.userSession.findFirst({
    where: { userId, logoutAt: null },
    orderBy: { loginAt: 'desc' },
  });
  if (!session) return null;

  return prisma.userSession.update({
    where: { id: session.id },
    data: { lastActiveAt: new Date() },
  });
}

export async function getUserStats(userId: string, period: string) {
  const prisma = getPrisma();
  const days = parseInt(period) || 7;
  const since = new Date(Date.now() - days * 86400000);

  const sessions = await prisma.userSession.findMany({
    where: { userId, loginAt: { gte: since } },
    orderBy: { loginAt: 'desc' },
  });

  const totalSessions = sessions.length;
  const totalDuration = sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  const avgDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

  // Group by date for chart
  const dailyStats: Record<string, { sessions: number; duration: number }> = {};
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - i * 86400000).toISOString().split('T')[0];
    dailyStats[date] = { sessions: 0, duration: 0 };
  }
  sessions.forEach((s) => {
    const date = s.loginAt.toISOString().split('T')[0];
    if (dailyStats[date]) {
      dailyStats[date].sessions++;
      dailyStats[date].duration += s.durationSeconds ?? 0;
    }
  });

  // Group by hour for average usage time
  const hourlyStats = Array.from({ length: 24 }, () => 0);
  sessions.forEach((s) => {
    const hour = s.loginAt.getHours();
    hourlyStats[hour]++;
  });

  // Peak usage hour
  const peakHour = hourlyStats.indexOf(Math.max(...hourlyStats));

  return {
    totalSessions,
    totalDuration,
    avgDuration: Math.round(avgDuration),
    peakHour,
    dailyStats: Object.entries(dailyStats)
      .sort()
      .map(([date, stats]) => ({
        date: date.slice(5),
        ...stats,
      })),
    hourlyStats,
    sessions: sessions.slice(0, 50).map((s) => ({
      id: s.id,
      loginAt: s.loginAt,
      logoutAt: s.logoutAt,
      durationSeconds: s.durationSeconds,
      ipAddress: s.ipAddress,
    })),
  };
}

export async function getAllUsersStats(period: string) {
  const prisma = getPrisma();
  const days = parseInt(period) || 7;
  const since = new Date(Date.now() - days * 86400000);

  const sessions = await prisma.userSession.findMany({
    where: { loginAt: { gte: since } },
    orderBy: { loginAt: 'desc' },
  });

  const totalSessions = sessions.length;
  const totalDuration = sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  const avgDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

  // Unique active users
  const uniqueUsers = new Set(sessions.map((s) => s.userId));
  const activeUsers = uniqueUsers.size;

  // Peak hour
  const hourlyStats = Array.from({ length: 24 }, () => 0);
  sessions.forEach((s) => {
    const hour = s.loginAt.getHours();
    hourlyStats[hour]++;
  });
  const peakHour = hourlyStats.indexOf(Math.max(...hourlyStats));

  // Per-user summary
  const userMap: Record<string, {
    userId: string;
    username: string;
    totalSessions: number;
    totalDuration: number;
    lastLogin: Date | null;
  }> = {};

  sessions.forEach((s) => {
    if (!userMap[s.userId]) {
      userMap[s.userId] = {
        userId: s.userId,
        username: s.username,
        totalSessions: 0,
        totalDuration: 0,
        lastLogin: null,
      };
    }
    userMap[s.userId].totalSessions++;
    userMap[s.userId].totalDuration += s.durationSeconds ?? 0;
    if (!userMap[s.userId].lastLogin || s.loginAt > userMap[s.userId].lastLogin!) {
      userMap[s.userId].lastLogin = s.loginAt;
    }
  });

  // Get user roles
  const userIds = Object.keys(userMap);
  const users = userIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, role: true },
      })
    : [];
  const roleMap: Record<string, string> = {};
  users.forEach((u) => { roleMap[u.id] = u.role; });

  const userSummaries = Object.values(userMap)
    .map((u) => ({
      ...u,
      role: roleMap[u.userId] ?? 'unknown',
      avgDuration: u.totalSessions > 0 ? Math.round(u.totalDuration / u.totalSessions) : 0,
    }))
    .sort((a, b) => b.totalSessions - a.totalSessions);

  return {
    totalSessions,
    totalDuration,
    avgDuration: Math.round(avgDuration),
    activeUsers,
    peakHour,
    hourlyStats,
    users: userSummaries,
  };
}
