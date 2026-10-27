import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { getSettings } from '../system-settings/system-settings.service.js';
import { translateCameraAlertToThai } from '../../lib/telegram-translate-th.js';

export async function sendTelegramAlert(titleIn: string, messageIn: string, severity: string): Promise<boolean> {
  // The admin-configurable Settings > Telegram Bot page takes priority; env vars remain
  // as a fallback for deployments that haven't set it up there yet.
  const stored = await getSettings(['telegram_bot_token', 'telegram_chat_id']);
  const botToken = stored.telegram_bot_token || config.notifications.telegram.botToken;
  const chatId = stored.telegram_chat_id || config.notifications.telegram.chatId;
  if (!botToken || !chatId) {
    logger.warn('Telegram not configured — skipping notification');
    return false;
  }

  // Alerts are always stored in English (so the in-app bell can re-translate per
  // viewer — see web-app/src/utils/textUtils.ts). Telegram has no per-viewer language,
  // so it gets a fixed-language pass here instead — currently only covers the camera
  // status-change shape, everything else still sends in English.
  const { title, message } = await translateCameraAlertToThai(titleIn, messageIn);

  const icon = severity === 'critical' || severity === 'emergency' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
  const text = `${icon} <b>${escapeHtml(title)}</b>\n${escapeHtml(message)}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, 'Telegram send failed');
      return false;
    }

    logger.info({ chatId }, 'Telegram alert sent');
    return true;
  } catch (err) {
    logger.error({ err }, 'Telegram send error');
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
