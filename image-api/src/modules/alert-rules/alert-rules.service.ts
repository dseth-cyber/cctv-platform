import { getPrisma } from '../../lib/prisma.js';
import type { AlertType, Prisma } from '@prisma/client';

export async function listAlertRules(params: {
  page?: number;
  limit?: number;
}) {
  const prisma = getPrisma();
  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 20, 100);

  const [data, total] = await Promise.all([
    prisma.alertRule.findMany({
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.alertRule.count(),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getAlertRuleById(id: string) {
  const prisma = getPrisma();
  return prisma.alertRule.findUnique({ where: { id } });
}

export interface CreateAlertRuleInput {
  name: string;
  alertType: AlertType;
  description?: string;
  enabled?: boolean;
  condition?: Record<string, unknown>;
  cooldownMinutes?: number;
  notificationChannels?: string[];
}

export async function createAlertRule(input: CreateAlertRuleInput) {
  const prisma = getPrisma();
  return prisma.alertRule.create({
    data: {
      name: input.name,
      alertType: input.alertType,
      description: input.description,
      enabled: input.enabled ?? true,
      condition: (input.condition ?? {}) as Prisma.InputJsonValue,
      cooldownMinutes: input.cooldownMinutes ?? 60,
      notificationChannels: (input.notificationChannels ?? []) as Prisma.InputJsonValue,
    },
  });
}

export interface UpdateAlertRuleInput {
  name?: string;
  // Editable: the settings UI shows the alert-type dropdown when editing too, and leaving
  // it read-only would mean delete-and-recreate just to fix a rule pointed at the wrong type.
  alertType?: AlertType;
  description?: string;
  enabled?: boolean;
  condition?: Record<string, unknown>;
  cooldownMinutes?: number;
  notificationChannels?: string[];
}

export async function updateAlertRule(id: string, input: UpdateAlertRuleInput) {
  const prisma = getPrisma();
  const data: any = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.alertType !== undefined) data.alertType = input.alertType;
  if (input.description !== undefined) data.description = input.description;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.condition !== undefined) data.condition = input.condition as Prisma.InputJsonValue;
  if (input.cooldownMinutes !== undefined) data.cooldownMinutes = input.cooldownMinutes;
  if (input.notificationChannels !== undefined) data.notificationChannels = input.notificationChannels as Prisma.InputJsonValue;

  return prisma.alertRule.update({ where: { id }, data });
}

export async function deleteAlertRule(id: string) {
  const prisma = getPrisma();
  return prisma.alertRule.delete({ where: { id } });
}
