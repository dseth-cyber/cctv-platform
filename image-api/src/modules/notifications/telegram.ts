import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { getRedisClient } from '../../lib/redis.js';
import { getPrisma } from '../../lib/prisma.js';
import { getSettings, setSetting } from '../system-settings/system-settings.service.js';
import { createAuditLog } from '../audit/audit.service.js';
import { translateCameraAlertToThai } from '../../lib/telegram-translate-th.js';

const LAST_RESULT_KEY = 'telegram:last_result';

export interface TelegramSendResult {
  ok: boolean;
  /** Telegram moved the group to a supergroup and named its new chat id (the old id no longer works). */
  migratedTo?: string;
  description?: string;
}

/** The bot token and the group in Settings > Telegram Bot (env vars are the fallback). */
export async function telegramDefaults(): Promise<{ botToken: string | null; chatId: string | null }> {
  const stored = await getSettings(['telegram_bot_token', 'telegram_chat_id']);
  return {
    botToken: stored.telegram_bot_token || config.notifications.telegram.botToken || null,
    chatId: stored.telegram_chat_id || config.notifications.telegram.chatId || null,
  };
}

/** The last delivery outcome, shown on the Telegram Bot page so a failing group does not go unnoticed. */
export async function lastTelegramResult(): Promise<{ at: string; ok: boolean; chatId: string; description?: string } | null> {
  try {
    const raw = await getRedisClient().get(LAST_RESULT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function remember(ok: boolean, chatId: string, description?: string) {
  try {
    await getRedisClient().set(LAST_RESULT_KEY, JSON.stringify({ at: new Date().toISOString(), ok, chatId, description }), 'EX', 30 * 86_400);
  } catch {
    // Only a status display: delivery itself does not depend on it.
  }
}

async function post(botToken: string, chatId: string, text: string): Promise<TelegramSendResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    if (res.ok) return { ok: true };
    const body: any = await res.json().catch(() => ({}));
    const migratedTo = body?.parameters?.migrate_to_chat_id;
    return { ok: false, description: body?.description ?? `HTTP ${res.status}`, ...(migratedTo ? { migratedTo: String(migratedTo) } : {}) };
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * When Telegram upgrades a group to a supergroup its chat id changes and the old one stops working (production
 * 2026-11-17: 51 alerts went nowhere until someone noticed, agent-channel #018). Telegram names the new id in its
 * refusal, so follow it: update whichever setting or team held the old id, write it in the audit log, and send again.
 */
async function followMigration(oldChatId: string, newChatId: string): Promise<void> {
  const prisma = getPrisma();
  const { chatId: defaultChat } = await telegramDefaults();
  if (defaultChat === oldChatId) {
    await setSetting('telegram_chat_id', newChatId);
  }
  await prisma.notifyTeam.updateMany({ where: { telegramChatId: oldChatId }, data: { telegramChatId: newChatId } });
  logger.warn({ oldChatId, newChatId }, 'Telegram group became a supergroup: chat id updated');
  createAuditLog({
    action: 'telegram_chat_migrated',
    entity: 'system_settings',
    entityId: 'telegram_chat_id',
    description: `Telegram upgraded the group to a supergroup; chat id changed from ${oldChatId} to ${newChatId} and was updated automatically`,
    metadata: { oldChatId, newChatId },
  }).catch(() => {});
}

/** Sends HTML text to one chat. Follows a supergroup migration once. */
export async function sendTelegramText(chatId: string, text: string): Promise<TelegramSendResult> {
  const { botToken } = await telegramDefaults();
  if (!botToken) {
    logger.warn('Telegram not configured — skipping notification');
    return { ok: false, description: 'not configured' };
  }
  let result = await post(botToken, chatId, text);
  if (!result.ok && result.migratedTo) {
    await followMigration(chatId, result.migratedTo);
    const retry = await post(botToken, result.migratedTo, text);
    result = { ...retry, migratedTo: result.migratedTo };
    chatId = result.migratedTo!;
  }
  if (result.ok) {
    logger.info({ chatId }, 'Telegram alert sent');
  } else {
    logger.error({ chatId, description: result.description }, 'Telegram send failed');
  }
  await remember(result.ok, chatId, result.description);
  return result;
}

export async function sendTelegramAlert(titleIn: string, messageIn: string, severity: string): Promise<boolean> {
  // The admin-configurable Settings > Telegram Bot page takes priority; env vars remain
  // as a fallback for deployments that haven't set it up there yet.
  const { botToken, chatId } = await telegramDefaults();
  if (!botToken || !chatId) {
    logger.warn('Telegram not configured — skipping notification');
    return false;
  }

  // Alerts are always stored in English (so the in-app bell can re-translate per
  // viewer — see web-app/src/utils/textUtils.ts). Telegram has no per-viewer language,
  // so it gets a fixed-language pass here instead — currently only covers the camera
  // status-change shape, everything else still sends in English.
  const { title, message } = await translateCameraAlertToThai(titleIn, messageIn);
  return (await sendTelegramText(chatId, formatAlertText(title, message, severity))).ok;
}

export function severityIcon(severity: string): string {
  return severity === 'critical' || severity === 'emergency' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
}

export function formatAlertText(title: string, message: string, severity: string): string {
  return `${severityIcon(severity)} <b>${escapeHtml(title)}</b>\n${escapeHtml(message)}`;
}

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
