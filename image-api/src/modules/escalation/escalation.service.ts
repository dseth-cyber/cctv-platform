import { z } from 'zod';
import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { getRedisClient } from '../../lib/redis.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { backupTimeZone, localClock } from '../backup/backup-settings.js';
import { translateCameraAlertToThai } from '../../lib/telegram-translate-th.js';
import { escapeHtml, sendTelegramText, severityIcon, telegramDefaults } from '../notifications/telegram.js';
import {
  ageThai, chatsFor, clampDue, decide, matchRule, parseTargets,
  type AlertPlace, type EscalationReason, type EscalationTarget, type StepLike,
} from './escalation-logic.js';

export class EscalationError extends Error {
  constructor(public code: string, public statusCode: number, message: string) {
    super(message);
  }
}

// ── Settings ───────────────────────────────────────────────────────────────────

export interface EscalationSettings {
  enabled: boolean;
  maxAckDays: number;
  summaryEnabled: boolean;
  summaryTime: string;
  summaryTargets: EscalationTarget[];
}

export async function getEscalationSettings(): Promise<EscalationSettings> {
  const c = await getAllConfigs();
  const targets = (() => {
    const v = c.escalation_summary_targets?.value;
    try {
      return parseTargets(typeof v === 'string' ? JSON.parse(v) : v);
    } catch {
      return [{ type: 'default' } as EscalationTarget];
    }
  })();
  return {
    enabled: c.escalation_enabled?.value !== false,
    maxAckDays: Number(c.escalation_max_ack_days?.value ?? 7),
    summaryEnabled: c.escalation_summary_enabled?.value !== false,
    summaryTime: String(c.escalation_summary_time?.value ?? '08:00'),
    summaryTargets: targets,
  };
}

// ── Where an alert is ──────────────────────────────────────────────────────────

/** An alert names its camera or recorder in `source`; their site and zone decide which chain it follows. */
export async function placeOf(alert: { alertType: string; source: string | null }): Promise<AlertPlace & { label: string | null }> {
  const prisma = getPrisma();
  const base = { alertType: alert.alertType, siteId: null as string | null, zoneId: null as string | null, label: null as string | null };
  const id = alert.source ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return base;
  const camera = await prisma.camera.findUnique({ where: { id }, select: { name: true, siteId: true, zoneId: true } }).catch(() => null);
  if (camera) return { ...base, siteId: camera.siteId, zoneId: camera.zoneId, label: camera.name };
  const device = await prisma.device.findUnique({ where: { id }, select: { name: true, siteId: true, zoneId: true } }).catch(() => null);
  if (device) return { ...base, siteId: device.siteId, zoneId: device.zoneId, label: device.name };
  return base;
}

type PolicyWithSteps = { id: string; name: string; repeatMinutes: number; isDefault: boolean; enabled: boolean; steps: { position: number; waitMinutes: number; targets: unknown }[] };

const stepsOf = (p: PolicyWithSteps): StepLike[] =>
  [...p.steps].sort((a, b) => a.position - b.position).map((s) => ({ waitMinutes: s.waitMinutes, targets: parseTargets(s.targets) }));

/** The chain for an alert: the most specific rule, else the default chain. Disabled chains are not used. */
export async function policyFor(place: AlertPlace): Promise<PolicyWithSteps | null> {
  const prisma = getPrisma();
  const rules = await prisma.escalationRule.findMany({ include: { policy: { include: { steps: true } } } });
  const usable = rules.filter((r) => r.policy?.enabled);
  const hit = matchRule(usable, place);
  if (hit) return hit.policy as PolicyWithSteps;
  return (await prisma.escalationPolicy.findFirst({ where: { isDefault: true, enabled: true }, include: { steps: true } })) as PolicyWithSteps | null;
}

// ── Messages ───────────────────────────────────────────────────────────────────

function appLink(): string {
  const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  return base ? `\n${base}/cctv/alerts` : '';
}

const REASON_HEAD: Record<EscalationReason | 'first' | 'test', string> = {
  first: '📣 แจ้งเตือน',
  repeat: '🔁 แจ้งซ้ำ: ยังไม่ได้แก้',
  escalate: '⏫ ส่งต่อ: ยังไม่มีผู้รับเรื่อง',
  due_passed: '⏰ เลยกำหนดเสร็จแล้ว ยังไม่หาย',
  test: '🧪 ทดสอบลำดับการแจ้ง (ไม่ใช่เหตุจริง)',
};

export async function reminderText(opts: {
  reason: EscalationReason | 'first' | 'test';
  alert: { title: string; message: string; severity: string; createdAt: Date; acknowledgedBy: string | null };
  stepNumber: number;
  stepCount: number;
  policyName: string;
  dueAt?: Date | null;
  ackNote?: string | null;
  label?: string | null;
  now?: Date;
}): Promise<string> {
  const now = opts.now ?? new Date();
  const { title, message } = await translateCameraAlertToThai(opts.alert.title, opts.alert.message);
  const lines = [
    `${REASON_HEAD[opts.reason]} · ขั้น ${opts.stepNumber}/${opts.stepCount} (${escapeHtml(opts.policyName)})`,
    `${severityIcon(opts.alert.severity)} <b>${escapeHtml(title)}</b>`,
    escapeHtml(message),
    `ค้างมา ${ageThai(opts.alert.createdAt, now)}`,
  ];
  if (opts.alert.acknowledgedBy) {
    const due = opts.dueAt ? ` กำหนดเสร็จ ${opts.dueAt.toLocaleString('th-TH', { timeZone: backupTimeZone(), dateStyle: 'short', timeStyle: 'short' })}` : '';
    lines.push(`รับเรื่องโดย ${escapeHtml(opts.alert.acknowledgedBy)}${due}${opts.ackNote ? ` · ${escapeHtml(opts.ackNote)}` : ''}`);
  } else {
    lines.push('ยังไม่มีผู้รับเรื่อง กด "รับทราบ" ในหน้าแจ้งเตือนเพื่อหยุดการส่งต่อ');
  }
  return lines.join('\n') + appLink();
}

async function teamsById(): Promise<Map<string, { telegramChatId: string | null; enabled: boolean; name: string }>> {
  const teams = await getPrisma().notifyTeam.findMany({ select: { id: true, name: true, telegramChatId: true, enabled: true } });
  return new Map(teams.map((t) => [t.id, t]));
}

async function sendToTargets(targets: EscalationTarget[], text: string): Promise<{ sent: number; chats: number }> {
  const { chatId } = await telegramDefaults();
  const chats = chatsFor(targets, chatId, await teamsById());
  let sent = 0;
  for (const c of chats) if ((await sendTelegramText(c, text)).ok) sent++;
  return { sent, chats: chats.length };
}

// ── The engine ─────────────────────────────────────────────────────────────────

const ESCALATE_TYPES_EXCLUDED = new Set(['storage_cleanup']);
let enabledSince: Date | null = null;

/**
 * Once a minute:
 * 1. every open alert (not resolved, not in the trash, not an info notice) gets a place in its chain; alerts that
 *    were already open when escalation started begin their wait now, so turning it on is not a burst of messages;
 * 2. every alert whose time has come is reminded or handed on (escalation-logic.decide);
 * 3. rows of alerts that closed are dropped.
 */
export async function escalationTick(now = new Date()): Promise<{ started: number; notified: number; closed: number }> {
  const prisma = getPrisma();
  const settings = await getEscalationSettings();
  if (!settings.enabled) return { started: 0, notified: 0, closed: 0 };
  if (!enabledSince) enabledSince = now;

  const open = await prisma.alert.findMany({
    where: { resolvedAt: null, deletedAt: null, severity: { not: 'info' } },
    select: { id: true, alertType: true, severity: true, source: true, title: true, message: true, details: true, createdAt: true, acknowledgedBy: true },
  });
  const openIds = new Set(open.map((a) => a.id));
  const states = new Map((await prisma.alertEscalation.findMany()).map((s) => [s.alertId, s]));

  let started = 0;
  let notified = 0;
  for (const alert of open) {
    if (ESCALATE_TYPES_EXCLUDED.has(alert.alertType)) continue;
    let state = states.get(alert.id);
    const place = await placeOf(alert);
    if (!state) {
      const policy = await policyFor(place);
      const steps = policy ? stepsOf(policy) : [];
      const from = alert.createdAt < enabledSince ? now : alert.createdAt;
      const first = steps[0];
      state = await prisma.alertEscalation.create({
        data: {
          alertId: alert.id,
          policyId: policy?.id ?? null,
          stepIndex: 0,
          stepStartedAt: from,
          lastNotifiedAt: alert.createdAt,
          nextNotifyAt: policy && first ? new Date(from.getTime() + Math.max(1, steps.length > 1 ? first.waitMinutes : policy.repeatMinutes) * 60_000) : null,
        },
      });
      started++;
      // The first notice already went to the group in Settings through the alert rules; teams named in step 1 hear
      // about it now, so a chain that starts with a team does not wait a full step before anyone in it is told.
      const extra = first ? first.targets.filter((t) => t.type === 'team') : [];
      if (policy && extra.length && alert.createdAt >= enabledSince) {
        const text = await reminderText({ reason: 'first', alert, stepNumber: 1, stepCount: steps.length, policyName: policy.name, label: place.label, now });
        await sendToTargets(extra, text);
      }
      continue;
    }
    if (!state.policyId || !state.nextNotifyAt || state.nextNotifyAt > now) continue;
    const policy = await prisma.escalationPolicy.findUnique({ where: { id: state.policyId }, include: { steps: true } });
    if (!policy || !policy.enabled) continue;
    const steps = stepsOf(policy as PolicyWithSteps);
    const details = (alert.details ?? {}) as Record<string, unknown>;
    const snoozeUntil = typeof details.snoozeUntil === 'string' ? new Date(details.snoozeUntil) : null;
    const d = decide(steps, policy.repeatMinutes, state, now, snoozeUntil);
    if (d.notify && d.reason) {
      const text = await reminderText({
        reason: d.reason, alert, stepNumber: d.stepIndex + 1, stepCount: steps.length, policyName: policy.name,
        dueAt: state.dueAt, ackNote: state.ackNote, label: place.label, now,
      });
      await sendToTargets(steps[d.stepIndex].targets, text);
      notified++;
    }
    await prisma.alertEscalation.update({
      where: { alertId: alert.id },
      data: {
        stepIndex: d.stepIndex,
        nextNotifyAt: d.nextNotifyAt,
        ...(d.stepIndex !== state.stepIndex ? { stepStartedAt: now } : {}),
        ...(d.notify ? { lastNotifiedAt: now, notifyCount: { increment: 1 } } : {}),
        ...(d.clearDue ? { dueAt: null } : {}),
      },
    });
  }

  const gone = [...states.keys()].filter((id) => !openIds.has(id));
  if (gone.length) await prisma.alertEscalation.deleteMany({ where: { alertId: { in: gone } } });
  return { started, notified, closed: gone.length };
}

/**
 * "รับทราบ" with a due time: reminders stop until then (at most escalation_max_ack_days); past it, the chain carries
 * on. Called from the alerts acknowledge endpoint, which also sets acknowledgedAt/By on the alert as before.
 */
export async function acknowledgeEscalation(alertId: string, opts: { dueAt?: Date | null; note?: string | null }, now = new Date()) {
  const prisma = getPrisma();
  const { maxAckDays } = await getEscalationSettings();
  const dueAt = clampDue(opts.dueAt ?? null, now, maxAckDays);
  const note = opts.note?.trim().slice(0, 500) || null;
  await prisma.alertEscalation.upsert({
    where: { alertId },
    update: { dueAt, ackNote: note, nextNotifyAt: dueAt },
    create: { alertId, dueAt, ackNote: note, nextNotifyAt: dueAt, stepStartedAt: now },
  });
  return { dueAt, note };
}

// ── Daily summary ──────────────────────────────────────────────────────────────

export async function summaryText(now = new Date()): Promise<string> {
  const prisma = getPrisma();
  const tz = backupTimeZone();
  const open = await prisma.alert.findMany({
    where: { resolvedAt: null, deletedAt: null, severity: { not: 'info' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, alertType: true, severity: true, source: true, title: true, message: true, createdAt: true, acknowledgedBy: true },
  });
  const states = new Map((await prisma.alertEscalation.findMany({ where: { alertId: { in: open.map((a) => a.id) } } })).map((s) => [s.alertId, s]));
  const resolved = await prisma.alert.count({ where: { resolvedAt: { gte: new Date(now.getTime() - 86_400_000) }, deletedAt: null, severity: { not: 'info' } } });
  const date = now.toLocaleDateString('th-TH', { timeZone: tz, day: 'numeric', month: 'short', year: 'numeric' });

  const lines = [`📋 <b>สรุปสถานะ CCTV ${escapeHtml(date)}</b>`, `ยังค้าง ${open.length} เรื่อง · แก้แล้วใน 24 ชม. ${resolved} เรื่อง`];
  const unowned = open.filter((a) => !a.acknowledgedBy);
  if (unowned.length) lines.push(`⚠️ ไม่มีผู้รับเรื่อง ${unowned.length} เรื่อง`);
  const MAX = 25;
  for (const a of open.slice(0, MAX)) {
    const { title } = await translateCameraAlertToThai(a.title, a.message);
    const s = states.get(a.id);
    const owner = a.acknowledgedBy
      ? `รับโดย ${escapeHtml(a.acknowledgedBy)}${s?.dueAt ? ` ถึง ${s.dueAt.toLocaleString('th-TH', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' })}` : ''}`
      : 'ยังไม่มีผู้รับ ⚠';
    lines.push(`${severityIcon(a.severity)} ${escapeHtml(title)} · ${ageThai(a.createdAt, now)} · ${owner}`);
  }
  if (open.length > MAX) lines.push(`…และอีก ${open.length - MAX} เรื่อง`);
  if (!open.length) lines.push('✅ ไม่มีเรื่องค้าง');
  return lines.join('\n') + appLink();
}

let lastSummaryDay: string | null = null;

export async function summaryTick(now = new Date()): Promise<boolean> {
  const s = await getEscalationSettings();
  if (!s.summaryEnabled) return false;
  const { hhmm, day } = localClock(now, backupTimeZone());
  if (hhmm !== s.summaryTime || lastSummaryDay === day) return false;
  // One summary per day even with two API processes or a restart in that minute.
  try {
    const first = await getRedisClient().set(`escalation:summary:${day}`, '1', 'EX', 2 * 86_400, 'NX');
    if (first !== 'OK') {
      lastSummaryDay = day;
      return false;
    }
  } catch {
    // Without Redis, the in-process guard below still stops repeats within this process.
  }
  lastSummaryDay = day;
  await sendToTargets(s.summaryTargets, await summaryText(now));
  return true;
}

/** For tests. */
export function resetEscalationClock() {
  enabledSince = null;
  lastSummaryDay = null;
}

let task: ScheduledTask | null = null;
let ticking = false;

export function startEscalation(): void {
  if (task) return;
  task = cron.schedule('* * * * *', () => {
    if (ticking) return;
    ticking = true;
    Promise.all([
      escalationTick().catch((err) => logger.error({ err }, 'Escalation round failed')),
      summaryTick().catch((err) => logger.error({ err }, 'Daily alert summary failed')),
    ]).finally(() => { ticking = false; });
  });
  logger.info('Escalation started: reminders and hand-offs for open alerts (chains on the Escalation page)');
}

export function stopEscalation(): void {
  task?.stop();
  task = null;
}

// ── What ships the first time ──────────────────────────────────────────────────

const FLAG = 'escalation_defaults_ready';

/**
 * Once: the default chain (the Telegram group in Settings, a reminder every 24 h), and three templates switched off
 * for the admin to adapt. Also switches off the two alert rules left over from the old image system, which never
 * fire for cameras. Changes nothing an admin already set up.
 */
export async function ensureEscalationDefaults(): Promise<{ created: boolean }> {
  const prisma = getPrisma();
  if (await prisma.systemConfig.findUnique({ where: { key: FLAG } })) return { created: false };
  const anyPolicy = await prisma.escalationPolicy.count();
  if (!anyPolicy) {
    const def: EscalationTarget[] = [{ type: 'default' }];
    await prisma.escalationPolicy.create({
      data: { name: 'ค่าเริ่มต้น', description: 'กลุ่ม Telegram ในหน้าตั้งค่า แจ้งซ้ำทุก 24 ชม. จนกว่าจะแก้หรือมีผู้รับทราบ', repeatMinutes: 1440, isDefault: true,
        steps: { create: [{ position: 0, waitMinutes: 1440, targets: def }] } },
    });
    const templates: { name: string; description: string; repeat: number; waits: number[] }[] = [
      { name: 'แม่แบบ: สายพื้นที่', description: 'ช่าง/ผู้ดูแลโซน → หัวหน้าพื้นที่ (24 ชม.) → ผู้บริหาร (48 ชม.) ใส่หน่วยงานในแต่ละขั้นแล้วเปิดใช้', repeat: 1440, waits: [1440, 2880, 1440] },
      { name: 'แม่แบบ: สายระบบ', description: 'IT → หัวหน้า IT (4 ชม.) → ผู้บริหาร (24 ชม.) ใส่หน่วยงานในแต่ละขั้นแล้วเปิดใช้', repeat: 1440, waits: [240, 1440, 1440] },
      { name: 'แม่แบบ: ร้ายแรง', description: 'แจ้งทุกหน่วยพร้อมกันทันที แล้วแจ้งซ้ำทุก 4 ชม. เช่น เครื่องบันทึกหยุดบันทึก', repeat: 240, waits: [240] },
    ];
    for (const t of templates) {
      await prisma.escalationPolicy.create({
        data: { name: t.name, description: t.description, repeatMinutes: t.repeat, enabled: false,
          steps: { create: t.waits.map((w, i) => ({ position: i, waitMinutes: w, targets: i === 0 ? def : [] })) } },
      });
    }
  }
  await prisma.alertRule.updateMany({ where: { alertType: { in: ['camera_no_new_images', 'ingest_lag'] }, enabled: true }, data: { enabled: false } });
  await prisma.systemConfig.create({ data: { key: FLAG, value: 'true', valueType: 'boolean', category: 'internal', description: 'Escalation defaults created (default chain, templates); leftover image-system alert rules switched off' } });
  logger.info({ createdPolicies: !anyPolicy }, 'Escalation defaults ready');
  return { created: !anyPolicy };
}

// ── Admin CRUD ─────────────────────────────────────────────────────────────────

const targetSchema = z.union([z.object({ type: z.literal('default') }), z.object({ type: z.literal('team'), id: z.string().uuid() })]);
const chatIdSchema = z.string().trim().regex(/^-?\d{5,20}$/, 'chat id').nullable().optional();

export const teamSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().max(2000).nullable().optional(),
  telegramChatId: chatIdSchema,
  enabled: z.boolean().optional(),
  memberIds: z.array(z.string().uuid()).max(500).optional(),
});

export const policySchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().max(2000).nullable().optional(),
  repeatMinutes: z.number().int().min(15).max(10_080),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  steps: z.array(z.object({ waitMinutes: z.number().int().min(5).max(20_160), targets: z.array(targetSchema).max(20) })).min(1).max(10),
});

export const ruleSchema = z.object({
  alertType: z.string().trim().max(64).nullable().optional(),
  siteId: z.string().uuid().nullable().optional(),
  zoneId: z.string().uuid().nullable().optional(),
  policyId: z.string().uuid(),
  enabled: z.boolean().optional(),
});

export async function listTeams() {
  const teams = await getPrisma().notifyTeam.findMany({ orderBy: { name: 'asc' }, include: { members: true } });
  return teams.map((t) => ({ ...t, memberIds: t.members.map((m) => m.userId), members: undefined }));
}

async function assertUsers(ids: string[]) {
  if (!ids.length) return;
  const found = await getPrisma().user.count({ where: { id: { in: ids }, deletedAt: null } });
  if (found !== new Set(ids).size) throw new EscalationError('UNKNOWN_USER', 400, 'One or more members are not users');
}

async function assertTeams(targets: EscalationTarget[][]) {
  const ids = [...new Set(targets.flat().filter((t) => t.type === 'team').map((t) => (t as { id: string }).id))];
  if (!ids.length) return;
  const found = await getPrisma().notifyTeam.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw new EscalationError('UNKNOWN_TEAM', 400, 'A step names a team that does not exist');
}

export async function saveTeam(id: string | null, input: z.infer<typeof teamSchema>) {
  const prisma = getPrisma();
  const memberIds = [...new Set(input.memberIds ?? [])];
  await assertUsers(memberIds);
  const data = { name: input.name, description: input.description ?? null, telegramChatId: input.telegramChatId || null, ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) };
  try {
    return await prisma.$transaction(async (tx) => {
      const team = id ? await tx.notifyTeam.update({ where: { id }, data }) : await tx.notifyTeam.create({ data });
      if (input.memberIds) {
        await tx.notifyTeamMember.deleteMany({ where: { teamId: team.id } });
        if (memberIds.length) await tx.notifyTeamMember.createMany({ data: memberIds.map((userId) => ({ teamId: team.id, userId })) });
      }
      return { ...team, memberIds };
    });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new EscalationError('DUPLICATE_NAME', 409, 'A team with this name already exists');
    if (err?.code === 'P2025') throw new EscalationError('NOT_FOUND', 404, 'Team not found');
    throw err;
  }
}

export async function deleteTeam(id: string) {
  const prisma = getPrisma();
  const steps = await prisma.escalationStep.findMany({ include: { policy: { select: { name: true } } } });
  const usedBy = steps.filter((s) => parseTargets(s.targets).some((t) => t.type === 'team' && t.id === id)).map((s) => s.policy.name);
  if (usedBy.length) throw new EscalationError('TEAM_IN_USE', 409, `Team is used by: ${[...new Set(usedBy)].join(', ')}`);
  await prisma.notifyTeam.delete({ where: { id } }).catch(() => { throw new EscalationError('NOT_FOUND', 404, 'Team not found'); });
}

export async function listPolicies() {
  const policies = await getPrisma().escalationPolicy.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }], include: { steps: true, _count: { select: { rules: true } } } });
  return policies.map((p) => ({ ...p, steps: [...p.steps].sort((a, b) => a.position - b.position).map((s) => ({ waitMinutes: s.waitMinutes, targets: parseTargets(s.targets) })), ruleCount: p._count.rules, _count: undefined }));
}

export async function savePolicy(id: string | null, input: z.infer<typeof policySchema>) {
  const prisma = getPrisma();
  await assertTeams(input.steps.map((s) => s.targets as EscalationTarget[]));
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.isDefault) await tx.escalationPolicy.updateMany({ where: { isDefault: true, ...(id ? { id: { not: id } } : {}) }, data: { isDefault: false } });
      const data = { name: input.name, description: input.description ?? null, repeatMinutes: input.repeatMinutes,
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}) };
      const policy = id ? await tx.escalationPolicy.update({ where: { id }, data }) : await tx.escalationPolicy.create({ data });
      if (policy.isDefault && !policy.enabled) throw new EscalationError('DEFAULT_DISABLED', 400, 'The default chain must stay enabled');
      await tx.escalationStep.deleteMany({ where: { policyId: policy.id } });
      await tx.escalationStep.createMany({ data: input.steps.map((s, i) => ({ policyId: policy.id, position: i, waitMinutes: s.waitMinutes, targets: s.targets })) });
      return policy;
    });
  } catch (err: any) {
    if (err instanceof EscalationError) throw err;
    if (err?.code === 'P2002') throw new EscalationError('DUPLICATE_NAME', 409, 'A chain with this name already exists');
    if (err?.code === 'P2025') throw new EscalationError('NOT_FOUND', 404, 'Chain not found');
    throw err;
  }
}

export async function deletePolicy(id: string) {
  const prisma = getPrisma();
  const p = await prisma.escalationPolicy.findUnique({ where: { id } });
  if (!p) throw new EscalationError('NOT_FOUND', 404, 'Chain not found');
  if (p.isDefault) throw new EscalationError('DEFAULT_POLICY', 409, 'Make another chain the default before deleting this one');
  await prisma.escalationPolicy.delete({ where: { id } });
}

export async function listRules() {
  return getPrisma().escalationRule.findMany({ orderBy: { createdAt: 'asc' }, include: { policy: { select: { name: true, enabled: true } } } });
}

export async function saveRule(id: string | null, input: z.infer<typeof ruleSchema>) {
  const prisma = getPrisma();
  if (input.zoneId) {
    const zone = await prisma.zone.findUnique({ where: { id: input.zoneId }, select: { siteId: true } });
    if (!zone) throw new EscalationError('UNKNOWN_ZONE', 400, 'Zone not found');
    if (input.siteId && input.siteId !== zone.siteId) throw new EscalationError('ZONE_NOT_IN_SITE', 400, 'The zone is not in that site');
  }
  if (!(await prisma.escalationPolicy.findUnique({ where: { id: input.policyId } }))) throw new EscalationError('UNKNOWN_POLICY', 400, 'Chain not found');
  const data = { alertType: input.alertType || null, siteId: input.siteId || null, zoneId: input.zoneId || null, policyId: input.policyId, ...(input.enabled !== undefined ? { enabled: input.enabled } : {}) };
  return id
    ? prisma.escalationRule.update({ where: { id }, data }).catch(() => { throw new EscalationError('NOT_FOUND', 404, 'Rule not found'); })
    : prisma.escalationRule.create({ data });
}

export async function deleteRule(id: string) {
  await getPrisma().escalationRule.delete({ where: { id } }).catch(() => { throw new EscalationError('NOT_FOUND', 404, 'Rule not found'); });
}

/** "If camera X goes offline, who hears about it and when": the chain it would follow, step by step. */
export async function preview(input: { alertType: string; cameraId?: string | null; siteId?: string | null; zoneId?: string | null }) {
  let place: AlertPlace = { alertType: input.alertType, siteId: input.siteId ?? null, zoneId: input.zoneId ?? null };
  if (input.cameraId) place = await placeOf({ alertType: input.alertType, source: input.cameraId });
  const policy = await policyFor(place);
  if (!policy) return { place, policy: null, timeline: [] };
  const teams = await teamsById();
  const steps = stepsOf(policy);
  let at = 0;
  const timeline = steps.map((s, i) => {
    const row = { step: i + 1, afterMinutes: at, targets: s.targets.map((t) => (t.type === 'default' ? { type: 'default', name: null } : { type: 'team', id: t.id, name: teams.get(t.id)?.name ?? null, hasChat: !!teams.get(t.id)?.telegramChatId })) };
    at += i < steps.length - 1 ? s.waitMinutes : 0;
    return row;
  });
  return { place, policy: { id: policy.id, name: policy.name, repeatMinutes: policy.repeatMinutes, isDefault: policy.isDefault }, timeline };
}

/** Sends a marked test message to every step's targets now, so an admin sees each group really receives it. */
export async function testPolicy(id: string, by: string) {
  const policy = await getPrisma().escalationPolicy.findUnique({ where: { id }, include: { steps: true } });
  if (!policy) throw new EscalationError('NOT_FOUND', 404, 'Chain not found');
  const steps = stepsOf(policy as PolicyWithSteps);
  const results = [];
  for (let i = 0; i < steps.length; i++) {
    const text = `${REASON_HEAD.test} · ขั้น ${i + 1}/${steps.length} (${escapeHtml(policy.name)})\nส่งโดย ${escapeHtml(by)}`;
    results.push({ step: i + 1, ...(await sendToTargets(steps[i].targets, text)) });
  }
  return results;
}

export async function sendSummaryNow() {
  const s = await getEscalationSettings();
  return sendToTargets(s.summaryTargets, await summaryText());
}
