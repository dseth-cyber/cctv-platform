import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://image_user:image_pass@localhost:5432/image_db' } }
});
try {
  const configs = await prisma.systemConfig.findMany();
  console.log('Total configs:', configs.length);
  for (const c of configs) {
    console.log(`- Key: ${c.key}, Value: ${c.value}, Type: ${c.valueType}, Category: ${c.category}`);
  }
} catch (e) {
  console.error('Error:', e.message);
} finally {
  await prisma.$disconnect();
}



