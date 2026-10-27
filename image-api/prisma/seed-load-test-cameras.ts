import { PrismaClient, CameraStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const countArg = process.argv[2];
  const count = countArg ? parseInt(countArg, 10) : 300;
  if (isNaN(count)) {
    console.error('Invalid count argument');
    process.exit(1);
  }

  console.log(`Seeding ${count} load test cameras...`);

  // Default retention policy ID from seed.ts
  const defaultPolicyId = '00000000-0000-0000-0000-000000000001';

  // Ensure policy exists
  const policy = await prisma.retentionPolicy.findUnique({
    where: { id: defaultPolicyId },
  });
  if (!policy) {
    console.error('Default retention policy not found. Run standard seed first.');
    process.exit(1);
  }

  // Clear existing mock cameras to allow clean restarts
  const deletedCount = await prisma.camera.deleteMany({
    where: {
      name: {
        startsWith: 'Mock Camera ',
      },
    },
  });
  console.log(`Cleared ${deletedCount.count} existing mock cameras.`);

  // Insert mock cameras in batch
  const camerasData = [];
  for (let i = 1; i <= count; i++) {
    camerasData.push({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      name: `Mock Camera ${i}`,
      description: `Auto-generated camera for load testing at scale`,
      ipAddress: 'image-smb-server',
      smbSharePath: '//image-smb-server/images',
      smbDomain: 'WORKGROUP',
      smbUsername: 'camera',
      smbPasswordEncrypted: 'smbpass',
      smbSubdirectoryPattern: `cam_${i}`, // Scanner will look inside images/cam_i/
      status: CameraStatus.active,
      pollIntervalSeconds: 30,
      retentionPolicyId: defaultPolicyId,
      enabled: true,
      metadata: { location: 'stress-test-rack', index: i },
    });
  }

  // Use prisma createMany
  const created = await prisma.camera.createMany({
    data: camerasData,
    skipDuplicates: true,
  });

  console.log(`Successfully seeded ${created.count} mock cameras.`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
