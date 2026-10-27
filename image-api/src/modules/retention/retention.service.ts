import { getPrisma } from '../../lib/prisma.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { recomputeRetentionForPolicy } from '../retention-sweeper/retention-sweeper.service.js';
import type { CreateRetentionPolicyInput, UpdateRetentionPolicyInput } from './retention.schema.js';

export async function listPolicies() {
  const prisma = getPrisma();
  return prisma.retentionPolicy.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { cameras: true } } },
  });
}

export async function getPolicyById(id: string) {
  const prisma = getPrisma();

  const policy = await prisma.retentionPolicy.findUnique({
    where: { id },
    include: {
      cameras: { select: { id: true, name: true, status: true } },
    },
  });

  if (!policy) {
    throw new NotFoundError('RetentionPolicy', id);
  }

  return policy;
}

async function clearOtherDefaults(prisma: any, exceptId?: string) {
  await prisma.retentionPolicy.updateMany({
    where: { isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createPolicy(input: CreateRetentionPolicyInput) {
  const prisma = getPrisma();

  const existing = await prisma.retentionPolicy.findFirst({ where: { name: input.name } });
  if (existing) {
    throw new ConflictError(`Retention policy with name '${input.name}' already exists`);
  }

  if (input.isDefault) {
    await clearOtherDefaults(prisma);
  }

  const policy = await prisma.retentionPolicy.create({ data: input });
  return policy;
}

export async function updatePolicy(id: string, input: UpdateRetentionPolicyInput) {
  const prisma = getPrisma();

  const existing = await prisma.retentionPolicy.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError('RetentionPolicy', id);
  }

  if (input.isDefault === true) {
    await clearOtherDefaults(prisma, id);
  }

  const updated = await prisma.retentionPolicy.update({ where: { id }, data: input });

  // rawRetentionDays changed: existing images' retentionUntil was snapshotted at
  // ingestion time under the *old* value, so without this they'd keep expiring on the
  // old schedule instead of the one the admin just set — see [[incident_2026-08-06]].
  if (input.rawRetentionDays !== undefined && input.rawRetentionDays !== existing.rawRetentionDays) {
    recomputeRetentionForPolicy(id, input.rawRetentionDays)
      .then((count) => logger.info({ policyId: id, rawRetentionDays: input.rawRetentionDays, affected: count }, 'Recomputed retentionUntil after policy change'))
      .catch((err) => logger.error({ err, policyId: id }, 'Failed to recompute retentionUntil after policy change'));
  }

  return updated;
}

export async function deletePolicy(id: string) {
  const prisma = getPrisma();

  const existing = await prisma.retentionPolicy.findUnique({
    where: { id },
    include: { _count: { select: { cameras: true } } },
  });

  if (!existing) {
    throw new NotFoundError('RetentionPolicy', id);
  }

  if (existing._count.cameras > 0) {
    throw new ConflictError(
      `Cannot delete policy '${existing.name}': ${existing._count.cameras} camera(s) are using it`,
    );
  }

  await prisma.retentionPolicy.delete({ where: { id } });
}
