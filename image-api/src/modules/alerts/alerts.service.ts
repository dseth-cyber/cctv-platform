import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { notifyChannels } from '../notifications/index.js';
import type { AlertType, AlertSeverity, Prisma } from '@prisma/client';

export interface CreateAlertInput {
  alertType: AlertType;
  severity: AlertSeverity;
  source?: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Fan an alert out to every enabled rule's channels without touching the alerts table.
 * createAlert() uses this after inserting its row; callers that already own an open alert
 * row (e.g. the camera image-flow reminder) use it to re-notify without piling up
 * duplicate rows for one ongoing problem.
 */
export async function dispatchAlertNotifications(input: {
  alertType: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  source?: string;
  bypassCooldown?: boolean;
}) {
  const prisma = getPrisma();
  try {
    // Check if the source has an active snooze
    if (input.source && !input.bypassCooldown) {
      const activeAlert = await prisma.alert.findFirst({
        where: {
          alertType: input.alertType,
          source: input.source,
          resolvedAt: null,
        },
      });
      if (activeAlert?.details) {
        const details = activeAlert.details as Record<string, any>;
        if (details.snoozeUntil && new Date(details.snoozeUntil).getTime() > Date.now()) {
          logger.info({ source: input.source, snoozeUntil: details.snoozeUntil }, 'Alert notification suppressed due to active snooze');
          return;
        }
      }
    }

    const rules = await prisma.alertRule.findMany({
      where: { alertType: input.alertType, enabled: true },
    });

    for (const rule of rules) {
      const channels = (rule.notificationChannels as string[]) ?? [];
      if (channels.length === 0) continue;

      notifyChannels({
        title: input.title,
        message: input.message,
        severity: input.severity,
        channels,
        ruleId: rule.id,
        cooldownMinutes: rule.cooldownMinutes,
        source: input.source,
        bypassCooldown: input.bypassCooldown,
      }).catch((err: unknown) => logger.error({ err, ruleId: rule.id }, 'Notification dispatch failed'));
    }
  } catch (err) {
    logger.error({ err }, 'Failed to process alert rules');
  }
}

/** skipNotify: the caller sends one notice for several alerts itself (see the device health round). */
export async function createAlert(input: CreateAlertInput & { skipDedup?: boolean; bypassCooldown?: boolean; closeOnCreate?: boolean; skipNotify?: boolean }) {
  const prisma = getPrisma();

  if (input.source && !input.skipDedup) {
    const existing = await prisma.alert.findFirst({
      where: {
        alertType: input.alertType,
        source: input.source,
        severity: input.severity ?? 'warning',
        resolvedAt: null,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (existing) return existing;
  }

  const alert = await prisma.alert.create({
    data: {
      alertType: input.alertType,
      severity: input.severity ?? 'warning',
      source: input.source,
      title: input.title,
      message: input.message,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
      // A notice that needs no action stays in the history without counting as something to handle.
      ...(input.closeOnCreate ? (() => {
        const at = new Date();
        return { acknowledgedAt: at, acknowledgedBy: 'system', resolvedAt: at, resolvedBy: 'system' };
      })() : {}),
    },
  });

  if (!input.skipNotify) {
    await dispatchAlertNotifications({
      alertType: input.alertType,
      severity: input.severity,
      title: input.title,
      message: input.message,
      source: input.source,
      bypassCooldown: input.bypassCooldown,
    });
  }

  return alert;
}

const ALERT_SORT_FIELDS: Record<string, (dir: 'asc' | 'desc') => any> = {
  severity: (dir) => ({ severity: dir }),
  title: (dir) => ({ title: dir }),
  source: (dir) => ({ source: dir }),
  createdAt: (dir) => ({ createdAt: dir }),
};

export async function listAlerts(params: {
  siteId?: string;
  zoneId?: string;
  severity?: string;
  resolved?: boolean;
  trash?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  /** Only alerts naming one of these. Absent means all of them. */
  sources?: string[];
}) {
  const prisma = getPrisma();
  const where: any = {};
  // An alert names its camera in `source`.
  if (params.siteId || params.zoneId) {
    const cameras = await prisma.camera.findMany({
      where: { ...(params.siteId ? { siteId: params.siteId } : {}), ...(params.zoneId ? { zoneId: params.zoneId } : {}) },
      select: { id: true },
    });
    where.source = { in: cameras.map((c) => c.id) };
  }
  if (params.sources) {
    const allowed = new Set(params.sources);
    where.source = { in: where.source ? (where.source.in as string[]).filter((id) => allowed.has(id)) : params.sources };
  }
  if (params.severity) where.severity = params.severity;
  if (params.resolved === true) where.resolvedAt = { not: null };
  else if (params.resolved === false) where.resolvedAt = null;
  where.deletedAt = params.trash ? { not: null } : null;

  const page = params.page ?? 1;
  const limit = Math.min(params.limit ?? 20, 100);

  const dir = params.sortDir ?? 'desc';
  const orderBy = params.sortBy && ALERT_SORT_FIELDS[params.sortBy]
    ? ALERT_SORT_FIELDS[params.sortBy](dir)
    : { createdAt: 'desc' };

  const [data, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.alert.count({ where }),
  ]);

  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

export async function getAlertById(id: string) {
  const prisma = getPrisma();
  return prisma.alert.findUnique({ where: { id } });
}

export async function acknowledgeAlert(id: string, acknowledgedBy: string) {
  const prisma = getPrisma();
  return prisma.alert.update({
    where: { id },
    data: { acknowledgedAt: new Date(), acknowledgedBy },
  });
}

export async function resolveAlert(id: string, resolvedBy: string) {
  const prisma = getPrisma();
  return prisma.alert.update({
    where: { id },
    data: { resolvedAt: new Date(), resolvedBy },
  });
}

export async function snoozeAlert(id: string, hours: number, snoozedBy: string) {
  const prisma = getPrisma();
  const alert = await prisma.alert.findUnique({ where: { id } });
  if (!alert) throw new Error('Alert not found');

  const snoozeUntil = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  const currentDetails = (alert.details as Record<string, any>) ?? {};

  return prisma.alert.update({
    where: { id },
    data: {
      acknowledgedAt: alert.acknowledgedAt ?? new Date(),
      acknowledgedBy: alert.acknowledgedBy ?? snoozedBy,
      details: {
        ...currentDetails,
        snoozeUntil,
        snoozedBy,
        snoozeHours: hours,
      },
    },
  });
}

/** Everything goes to the trash, closed, so nothing in there still counts as a problem or blocks a new alert. */
export async function moveAllToTrash(username: string, sources?: string[]): Promise<number> {
  const within = sources ? { source: { in: sources } } : {};
  const prisma = getPrisma();
  const now = new Date();
  await prisma.alert.updateMany({ where: { ...within, deletedAt: null, resolvedAt: null }, data: { resolvedAt: now, resolvedBy: username } });
  const moved = await prisma.alert.updateMany({ where: { ...within, deletedAt: null }, data: { deletedAt: now, deletedBy: username } });
  return moved.count;
}

export async function moveToTrash(id: string, username: string): Promise<number> {
  const prisma = getPrisma();
  const now = new Date();
  await prisma.alert.updateMany({ where: { id, deletedAt: null, resolvedAt: null }, data: { resolvedAt: now, resolvedBy: username } });
  const moved = await prisma.alert.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: now, deletedBy: username } });
  return moved.count;
}

/** Comes back closed: whatever it reported may be long over, and the health check raises a new alert if not. */
export async function restoreFromTrash(id?: string, sources?: string[]): Promise<number> {
  const restored = await getPrisma().alert.updateMany({
    where: { ...(id ? { id } : {}), ...(sources ? { source: { in: sources } } : {}), deletedAt: { not: null } },
    data: { deletedAt: null, deletedBy: null },
  });
  return restored.count;
}

/** Only what is in the trash can be deleted for good. */
export async function deleteFromTrash(id?: string, sources?: string[]): Promise<number> {
  const deleted = await getPrisma().alert.deleteMany({ where: { ...(id ? { id } : {}), ...(sources ? { source: { in: sources } } : {}), deletedAt: { not: null } } });
  return deleted.count;
}
