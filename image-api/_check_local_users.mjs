import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://image_user:image_pass@localhost:5432/image_db' } }
});

try {
  const users = await prisma.user.findMany();
  console.log('Local users:', users);
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await prisma.$disconnect();
}
