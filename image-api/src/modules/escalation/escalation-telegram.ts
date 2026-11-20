import { getPrisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { getRedisClient } from '../../lib/redis.js';
import { getUserPermissions } from '../../middleware/rbac.js';
import { createAuditLog } from '../audit/audit.service.js';
import { alertSourcesForUser } from '../access/camera-scope.js';
import { acknowledgeAlert } from '../alerts/alerts.service.js';
import { getAllConfigs } from '../system-config/system-config.service.js';
import { backupTimeZone, localClock } from '../backup/backup-settings.js';
import { translateCameraAlertToThai } from '../../lib/telegram-translate-th.js';
import { escapeHtml } from '../notifications/telegram.js';
import { ageThai, linkCode, parseTargets, type EscalationTarget } from './escalation-logic.js';
import { acknowledgeEscalation, EscalationError, sendTargets } from './escalation.service.js';

// ── Linking a web account to Telegram ─────────────────────────────────────────
// The person asks for a code on the web (signed in), then sends "/link <code>" to the bot in a private chat. That
// proves both ends belong to the same person without anyone typing a Telegram id. One Telegram per account.

const CODE_TTL_SECONDS = 600;
const codeKey = (code: string) => `telegram:link:${code}`;
const userKey = (userId: string) => `telegram:link-user:${userId}`;

export async function createLinkCode(userId: string): Promise<{ code: string; expiresInSeconds: number }> {
  const redis = getRedisClient();
  const old = await redis.get(userKey(userId));
  if (old) await redis.del(codeKey(old));
  for (let i = 0; i < 5; i++) {
    const code = linkCode();
    if ((await redis.set(codeKey(code), userId, 'EX', CODE_TTL_SECONDS, 'NX')) === 'OK') {
      await redis.set(userKey(userId), code, 'EX', CODE_TTL_SECONDS);
      return { code, expiresInSeconds: CODE_TTL_SECONDS };
    }
  }
  throw new EscalationError('CODE_BUSY', 503, 'Could not make a code, try again');
}

export async function linkStatus(userId: string) {
  const row = await getPrisma().telegramUser.findUnique({ where: { userId }, select: { telegramId: true, firstName: true, username: true, status: true, updatedAt: true } });
  return row ? { linked: true, ...row } : { linked: false };
}

export async function unlinkTelegram(userId: string, by: string): Promise<boolean> {
  const prisma = getPrisma();
  const row = await prisma.telegramUser.findUnique({ where: { userId } });
  if (!row) return false;
  await prisma.telegramUser.update({ where: { id: row.id }, data: { userId: null } });
  createAuditLog({ userId, action: 'telegram_unlink', entity: 'telegram_user', entityId: row.telegramId, description: `Telegram ${row.telegramId} unlinked from the account by ${by}` }).catch(() => {});
  return true;
}

/** "/link 123456" from a private chat. Approves that Telegram user for the bot (the web sign-in vouches for them). */
export async function consumeLinkCode(code: string, from: { telegramId: string; firstName?: string; username?: string }): Promise<{ ok: boolean; username?: string }> {
  const redis = getRedisClient();
  const prisma = getPrisma();
  const userId = await redis.get(codeKey(code));
  if (!userId) return { ok: false };
  await redis.del(codeKey(code), userKey(userId));
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, enabled: true, deletedAt: true } });
  if (!user || !user.enabled || user.deletedAt) return { ok: false };
  await prisma.$transaction([
    // One Telegram per account and one account per Telegram: drop older links on either side.
    prisma.telegramUser.updateMany({ where: { userId, NOT: { telegramId: from.telegramId } }, data: { userId: null } }),
    prisma.telegramUser.upsert({
      where: { telegramId: from.telegramId },
      update: { userId, status: 'approved', decidedBy: `web:${user.username}`, decidedAt: new Date(), firstName: from.firstName ?? undefined, username: from.username ?? undefined },
      create: { telegramId: from.telegramId, userId, status: 'approved', decidedBy: `web:${user.username}`, decidedAt: new Date(), firstName: from.firstName ?? null, username: from.username ?? null },
    }),
  ]);
  createAuditLog({ userId, action: 'telegram_link', entity: 'telegram_user', entityId: from.telegramId, description: `Telegram ${from.telegramId} linked to ${user.username}` }).catch(() => {});
  logger.info({ username: user.username }, 'Telegram linked to a web account');
  return { ok: true, username: user.username };
}

// ── Acknowledge from a button in Telegram ─────────────────────────────────────

/**
 * A button pressed under a reminder: acts as the web account linked to that Telegram user, with that account's
 * permission (alerts:update) and camera scope, exactly as the web page would. Anyone else gets a reason, not an action.
 */
export async function acknowledgeFromTelegram(telegramId: string, alertId: string, hours: number): Promise<{ ok: boolean; message: string; line?: string }> {
  const prisma = getPrisma();
  const link = await prisma.telegramUser.findUnique({ where: { telegramId }, select: { userId: true, status: true } });
  if (!link?.userId || link.status !== 'approved') return { ok: false, message: 'ยังไม่ได้เชื่อมบัญชี: ในหน้าเว็บกดชื่อผู้ใช้ → เชื่อม Telegram' };
  const user = await prisma.user.findUnique({ where: { id: link.userId }, select: { id: true, username: true, enabled: true, deletedAt: true } });
  if (!user || !user.enabled || user.deletedAt) return { ok: false, message: 'บัญชีที่เชื่อมไว้ถูกปิดใช้งาน' };
  const perms = await getUserPermissions(user.id);
  if (!perms.includes('*') && !perms.includes('alerts:update')) return { ok: false, message: 'บัญชีของคุณไม่มีสิทธิ์รับทราบแจ้งเตือน' };
  const alert = await prisma.alert.findUnique({ where: { id: alertId }, select: { id: true, title: true, source: true, resolvedAt: true, deletedAt: true } });
  const sources = await alertSourcesForUser(user.id);
  if (!alert || alert.deletedAt || (sources !== null && (!alert.source || !sources.includes(alert.source)))) return { ok: false, message: 'ไม่พบแจ้งเตือนนี้' };
  if (alert.resolvedAt) return { ok: false, message: 'เรื่องนี้แก้แล้ว' };
  await acknowledgeAlert(alert.id, user.username);
  const esc = await acknowledgeEscalation(alert.id, { dueAt: new Date(Date.now() + hours * 3_600_000) });
  createAuditLog({
    userId: user.id, action: 'alert_acknowledge', entity: 'alert', entityId: alert.id,
    description: `Alert "${alert.title}" acknowledged by ${user.username} from Telegram until ${esc.dueAt.toISOString()}`,
    metadata: { dueAt: esc.dueAt, via: 'telegram', telegramId },
  }).catch(() => {});
  const due = esc.dueAt.toLocaleString('th-TH', { timeZone: backupTimeZone(), dateStyle: 'short', timeStyle: 'short' });
  return { ok: true, message: `รับทราบแล้ว ถึง ${due}`, line: `✅ รับทราบโดย ${escapeHtml(user.username)} ถึง ${escapeHtml(due)}` };
}

// ── Weekly summary ────────────────────────────────────────────────────────────

export interface WeeklySettings { enabled: boolean; day: number; time: string; targets: EscalationTarget[] }

export async function getWeeklySettings(): Promise<WeeklySettings> {
  const c = await getAllConfigs();
  const raw = c.escalation_weekly_targets?.value;
  let targets: EscalationTarget[] = [];
  try {
    targets = parseTargets(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    targets = [];
  }
  return {
    enabled: c.escalation_weekly_enabled?.value !== false,
    day: Number(c.escalation_weekly_day?.value ?? 1),
    time: String(c.escalation_weekly_time?.value ?? '08:00'),
    targets,
  };
}

const hoursText = (ms: number | null) => (ms === null ? '—' : ms < 3_600_000 ? `${Math.round(ms / 60_000)} นาที` : `${(ms / 3_600_000).toFixed(1)} ชม.`);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/** For managers: the past 7 days in a few lines — how much happened, how fast it was taken and fixed, what is stuck. */
export async function weeklyText(now = new Date()): Promise<string> {
  const prisma = getPrisma();
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const created = await prisma.alert.findMany({
    where: { createdAt: { gte: since }, deletedAt: null, severity: { not: 'info' } },
    select: { alertType: true, createdAt: true, acknowledgedAt: true, resolvedAt: true },
  });
  const byType = new Map<string, number>();
  for (const a of created) byType.set(a.alertType, (byType.get(a.alertType) ?? 0) + 1);
  const toAck = median(created.filter((a) => a.acknowledgedAt).map((a) => a.acknowledgedAt!.getTime() - a.createdAt.getTime()));
  const toFix = median(created.filter((a) => a.resolvedAt).map((a) => a.resolvedAt!.getTime() - a.createdAt.getTime()));
  const stuck = await prisma.alert.findMany({
    where: { resolvedAt: null, deletedAt: null, severity: { not: 'info' }, createdAt: { lt: since } },
    orderBy: { createdAt: 'asc' }, take: 10,
    select: { title: true, message: true, createdAt: true, acknowledgedBy: true },
  });
  const stuckCount = await prisma.alert.count({ where: { resolvedAt: null, deletedAt: null, severity: { not: 'info' }, createdAt: { lt: since } } });
  const reminders = await prisma.alertEscalation.aggregate({ _sum: { notifyCount: true } });
  const tz = backupTimeZone();
  const fmt = (d: Date) => d.toLocaleDateString('th-TH', { timeZone: tz, day: 'numeric', month: 'short' });

  const lines = [
    `📊 <b>สรุปรายสัปดาห์ CCTV ${escapeHtml(fmt(since))} – ${escapeHtml(fmt(now))}</b>`,
    `แจ้งเตือนใหม่ ${created.length} เรื่อง · แก้แล้ว ${created.filter((a) => a.resolvedAt).length} · ยังเปิด ${created.filter((a) => !a.resolvedAt).length}`,
    `เวลาจนมีผู้รับเรื่อง (ค่ากลาง): ${hoursText(toAck)} · เวลาจนแก้ (ค่ากลาง): ${hoursText(toFix)}`,
    `แจ้งซ้ำ/ส่งต่อที่ยังเปิดอยู่รวม ${reminders._sum.notifyCount ?? 0} ครั้ง`,
  ];
  if (byType.size) lines.push('แยกตามประเภท: ' + [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(' · '));
  if (stuckCount) {
    lines.push(`⚠️ <b>ค้างเกิน 7 วัน ${stuckCount} เรื่อง</b>`);
    for (const a of stuck) {
      const { title } = await translateCameraAlertToThai(a.title, a.message);
      lines.push(`• ${escapeHtml(title)} · ${ageThai(a.createdAt, now)} · ${a.acknowledgedBy ? `รับโดย ${escapeHtml(a.acknowledgedBy)}` : 'ยังไม่มีผู้รับ'}`);
    }
  } else {
    lines.push('✅ ไม่มีเรื่องค้างเกิน 7 วัน');
  }
  // Warranties (phase 5.5): what ends within the notice window, and what already ended.
  const w = await import('../assets/assets.service.js').then((m) => m.warrantyCounts(now)).catch(() => null);
  if (w && (w.expiring || w.expired)) lines.push(`🛡 ประกันจะหมดใน ${w.soonDays} วัน ${w.expiring} รายการ · หมดแล้ว ${w.expired} รายการ (รายงาน → ทรัพย์สินและการรับประกัน)`);
  return lines.join('\n');
}

let lastWeeklyKey: string | null = null;

export async function weeklyTick(now = new Date()): Promise<boolean> {
  const s = await getWeeklySettings();
  if (!s.enabled || !s.targets.length) return false;
  const tz = backupTimeZone();
  const { hhmm, day } = localClock(now, tz);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now));
  if (weekday !== s.day || hhmm !== s.time || lastWeeklyKey === day) return false;
  try {
    if ((await getRedisClient().set(`escalation:weekly:${day}`, '1', 'EX', 8 * 86_400, 'NX')) !== 'OK') {
      lastWeeklyKey = day;
      return false;
    }
  } catch {
    // The in-process guard still stops repeats in this process.
  }
  lastWeeklyKey = day;
  await sendTargets(s.targets, await weeklyText(now));
  return true;
}

export async function sendWeeklyNow() {
  const s = await getWeeklySettings();
  if (!s.targets.length) throw new EscalationError('NO_WEEKLY_TARGETS', 400, 'Set escalation_weekly_targets first');
  return sendTargets(s.targets, await weeklyText());
}
