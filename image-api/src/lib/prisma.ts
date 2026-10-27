import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    let dbUrl = process.env.DATABASE_URL || 'postgresql://image_user:image_pass@postgres:5432/image_db';
    if (!dbUrl.includes('connection_limit')) {
      const sep = dbUrl.includes('?') ? '&' : '?';
      dbUrl = `${dbUrl}${sep}connection_limit=50&pool_timeout=30`;
    }
    prisma = new PrismaClient({
      datasources: { db: { url: dbUrl } },
      log: process.env.NODE_ENV === 'development'
        ? [{ emit: 'event', level: 'query' }, 'info', 'warn', 'error']
        : ['warn', 'error'],
    });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
  }
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const client = getPrisma();
    await client.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
