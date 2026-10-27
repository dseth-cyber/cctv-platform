import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';
import { getSettings } from '../system-settings/system-settings.service.js';

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
  allowPrivateChat: boolean;
}

/**
 * Settings > Telegram Bot wins, env vars are the fallback — same precedence as the
 * outbound alert sender in notifications/telegram.ts. Read fresh on every use rather
 * than cached at boot, so changing the token in the UI takes effect without a restart.
 */
export async function getTelegramCredentials(): Promise<TelegramCredentials | null> {
  const stored = await getSettings(['telegram_bot_token', 'telegram_chat_id', 'telegram_allow_private_chat']);
  const botToken = stored.telegram_bot_token || config.notifications.telegram.botToken;
  const chatId = stored.telegram_chat_id || config.notifications.telegram.chatId;
  if (!botToken || !chatId) return null;
  return {
    botToken,
    chatId,
    // Absent means on: the feature is useless if it defaults to refusing everyone, and
    // the private chat is still gated by the per-user approval list either way.
    allowPrivateChat: stored.telegram_allow_private_chat !== 'false',
  };
}

async function call<T = any>(botToken: string, method: string, payload?: Record<string, unknown>, timeoutMs = 15000): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    const body = await res.json() as { ok: boolean; result?: T; description?: string };
    if (!body.ok) {
      // Not an error worth shouting about: "bot can't initiate conversation with a user"
      // just means that admin has never opened a chat with the bot, which is normal.
      logger.warn({ method, description: body.description }, 'Telegram API returned not-ok');
      return null;
    }
    return body.result as T;
  } catch (err) {
    logger.error({ err, method }, 'Telegram API call failed');
    return null;
  }
}

export function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface InlineButton { text: string; callback_data: string }

export async function sendMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  buttons?: InlineButton[][],
): Promise<{ message_id: number } | null> {
  return call(botToken, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}

export async function editMessageText(
  botToken: string,
  chatId: string | number,
  messageId: number,
  text: string,
): Promise<unknown> {
  // Dropping the keyboard is the point: an approval card whose buttons still work after
  // a decision invites a second, conflicting press.
  return call(botToken, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] },
  });
}

export async function answerCallbackQuery(botToken: string, callbackQueryId: string, text: string, showAlert = false): Promise<unknown> {
  return call(botToken, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
}

export interface ChatAdministrator {
  user: { id: number; is_bot: boolean; first_name?: string; username?: string };
  status: string;
}

export async function getChatAdministrators(botToken: string, chatId: string): Promise<ChatAdministrator[]> {
  const result = await call<ChatAdministrator[]>(botToken, 'getChatAdministrators', { chat_id: chatId });
  return result ?? [];
}

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; is_bot: boolean; first_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: { id: number; is_bot: boolean; first_name?: string; username?: string };
    message?: { message_id: number; chat: { id: number; type: string } };
    data?: string;
  };
}

/**
 * Long polling rather than a webhook: a webhook would need a publicly reachable inbound
 * HTTPS route, and this deployment's perimeter is deliberately left as-is (see
 * HANDOFF §Security). getUpdates needs nothing but outbound access, which already works.
 */
export async function getUpdates(botToken: string, offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
  const result = await call<TelegramUpdate[]>(
    botToken,
    'getUpdates',
    { offset, timeout: timeoutSeconds, allowed_updates: ['message', 'callback_query'] },
    (timeoutSeconds + 10) * 1000,
  );
  return result ?? [];
}
