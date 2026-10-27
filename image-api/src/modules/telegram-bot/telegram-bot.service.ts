import { logger } from '../../lib/logger.js';
import {
  getTelegramCredentials, getUpdates, sendMessage, editMessageText,
  answerCallbackQuery, getChatAdministrators, escapeHtml,
  type TelegramUpdate, type InlineButton,
} from './telegram-api.js';
import * as telegramUsers from './telegram-users.service.js';
import { buildCameraReport, buildOverallReport, buildCctvSiteReport, findCameraByName, listCameraNames } from './telegram-report.service.js';

const POLL_TIMEOUT_SECONDS = 30;
// Long polling already blocks for POLL_TIMEOUT_SECONDS, so this only paces the loop
// on a tick where the bot isn't configured yet; it is not a busy-wait interval.
const IDLE_DELAY_MS = 5000;
const ERROR_BACKOFF_MS = 15000;

let running = false;
let offset = 0;

function displayName(from: { first_name?: string; username?: string; id: number }): string {
  return from.first_name || (from.username ? `@${from.username}` : String(from.id));
}

function accessRequestCard(from: { id: number; first_name?: string; username?: string }): string {
  return [
    '🤖 <b>มีคำขอสิทธิ์ใช้งานบอท</b>',
    '',
    `👤 ชื่อ: <b>${escapeHtml(from.first_name ?? '-')}</b>`,
    `🔗 Username: ${from.username ? '@' + escapeHtml(from.username) : '-'}`,
    `🆔 Telegram ID: <code>${from.id}</code>`,
    '',
    'กรุณาอนุมัติหรือปฏิเสธ',
  ].join('\n');
}

const HELP_TEXT = [
  '🤖 <b>CCTV Surveillance Bot (Dev)</b>',
  '',
  'พิมพ์คำสั่งได้ดังนี้:',
  '• <b>ชื่อกล้อง</b> เช่น <code>CAM-01</code> — สรุปข้อมูลและสุขภาพกล้อง',
  '• <b>All / Summary</b> — สรุปภาพรวมระบบ CCTV ทั้งหมด',
  '• <b>Sites</b> — สรุปสถานะกล้องแยกตามไซต์/อาคาร',
  '• <b>List</b> — รายชื่อกล้องทั้งหมด',
  '• <b>Help</b> — แสดงข้อความนี้',
].join('\n');

/** Only a human admin/creator of the configured group may decide access requests. */
async function isGroupAdmin(botToken: string, chatId: string, userId: number): Promise<boolean> {
  const admins = await getChatAdministrators(botToken, chatId);
  return admins.some((a) => !a.user.is_bot && a.user.id === userId);
}

/**
 * A DM only lands if that admin has opened a chat with the bot at least once — Telegram
 * forbids bots from initiating conversations. Failures are expected and non-fatal: the
 * group card is the primary channel, the DM is the nudge on top of it.
 */
async function notifyAdminsDirectly(botToken: string, chatId: string, text: string, buttons?: InlineButton[][]) {
  const admins = await getChatAdministrators(botToken, chatId);
  const humans = admins.filter((a) => !a.user.is_bot);
  for (const admin of humans) {
    const sent = await sendMessage(botToken, admin.user.id, text, buttons);
    if (!sent) {
      logger.info(
        { adminId: admin.user.id, username: admin.user.username },
        'Could not DM admin — they have probably never started a chat with the bot',
      );
    }
  }
}

async function handlePrivateMessage(botToken: string, update: TelegramUpdate): Promise<void> {
  const msg = update.message!;
  const from = msg.from!;
  const text = (msg.text ?? '').trim();
  const telegramId = String(from.id);

  const creds = await getTelegramCredentials();
  if (!creds?.allowPrivateChat) {
    await sendMessage(botToken, from.id, '🚫 ระบบปิดการแชทส่วนตัวกับบอทอยู่ กรุณาติดต่อผู้ดูแลระบบ');
    return;
  }

  const approved = await telegramUsers.isApproved(telegramId);
  if (!approved) {
    const record = await telegramUsers.recordAccessRequest({
      telegramId, firstName: from.first_name, username: from.username,
    });
    if (record.status === 'rejected') {
      await sendMessage(botToken, from.id, '🚫 คำขอของคุณถูกปฏิเสธไปแล้ว กรุณาติดต่อผู้ดูแลระบบในกลุ่ม');
      return;
    }
    await sendMessage(
      botToken, from.id,
      [
        '👋 สวัสดีครับ',
        '',
        'คุณยังไม่มีสิทธิ์ใช้งานบอทนี้',
        'กดปุ่มด้านล่างเพื่อส่งคำขอไปให้ผู้ดูแลในกลุ่มอนุมัติ',
      ].join('\n'),
      [[{ text: '📨 ขอสิทธิ์ใช้งาน', callback_data: 'req_access' }]],
    );
    return;
  }

  await telegramUsers.touchLastSeen(telegramId);

  const lower = text.toLowerCase();
  if (!text || lower === '/start' || lower === '/help' || lower === 'help' || lower === 'ช่วยเหลือ') {
    await sendMessage(botToken, from.id, HELP_TEXT);
    return;
  }

  if (lower === 'list' || lower === '/list' || lower === 'รายชื่อ') {
    const names = await listCameraNames();
    await sendMessage(
      botToken, from.id,
      names.length
        ? `🎥 <b>กล้องทั้งหมด (${names.length})</b>\n` + names.map((n) => `• ${escapeHtml(n)}`).join('\n')
        : 'ยังไม่มีกล้องในระบบ',
    );
    return;
  }

  if (lower === 'all' || lower === '/all' || lower === 'ทั้งหมด' || lower === 'summary' || lower === '/summary') {
    await sendMessage(botToken, from.id, await buildOverallReport());
    return;
  }

  if (lower === 'sites' || lower === '/sites' || lower === 'ไซต์') {
    await sendMessage(botToken, from.id, await buildCctvSiteReport());
    return;
  }

  const camera = await findCameraByName(text);
  if (camera) {
    await sendMessage(botToken, from.id, await buildCameraReport(camera.id));
    return;
  }

  const names = await listCameraNames();
  await sendMessage(
    botToken, from.id,
    [
      `❓ ไม่พบกล้องชื่อ "<b>${escapeHtml(text)}</b>"`,
      '',
      names.length ? `กล้องที่มีในระบบ: ${names.map((n) => escapeHtml(n)).join(', ')}` : '',
      '',
      'พิมพ์ <code>All</code> เพื่อดูภาพรวม หรือ <code>Help</code> เพื่อดูคำสั่งทั้งหมด',
    ].filter(Boolean).join('\n'),
  );
}

async function handleCallback(botToken: string, chatId: string, update: TelegramUpdate): Promise<void> {
  const cb = update.callback_query!;
  const data = cb.data ?? '';
  const from = cb.from;

  if (data === 'req_access') {
    const record = await telegramUsers.recordAccessRequest({
      telegramId: String(from.id), firstName: from.first_name, username: from.username,
    });
    if (record.status === 'approved') {
      await answerCallbackQuery(botToken, cb.id, 'คุณมีสิทธิ์ใช้งานอยู่แล้ว');
      return;
    }
    if (record.status === 'rejected') {
      await answerCallbackQuery(botToken, cb.id, 'คำขอของคุณถูกปฏิเสธไปแล้ว', true);
      return;
    }

    const card = accessRequestCard(from);
    const buttons: InlineButton[][] = [[
      { text: '✅ อนุมัติ', callback_data: `approve:${from.id}` },
      { text: '❌ ปฏิเสธ', callback_data: `reject:${from.id}` },
    ]];
    await sendMessage(botToken, chatId, card + '\n\n<i>กรุณากดอนุมัติ/ปฏิเสธในกลุ่มผู้ดูแล</i>', buttons);
    await notifyAdminsDirectly(botToken, chatId, card, buttons);
    await answerCallbackQuery(botToken, cb.id, 'ส่งคำขอให้ผู้ดูแลแล้ว');
    await sendMessage(botToken, from.id, '📨 ส่งคำขอเรียบร้อยแล้ว กรุณารอผู้ดูแลอนุมัติ');
    return;
  }

  const decision = data.match(/^(approve|reject):(\d+)$/);
  if (!decision) return;

  const [, action, targetId] = decision;
  if (!(await isGroupAdmin(botToken, chatId, from.id))) {
    await answerCallbackQuery(botToken, cb.id, '🚫 เฉพาะผู้ดูแลกลุ่มเท่านั้นที่อนุมัติได้', true);
    return;
  }

  const approver = displayName(from);
  const target = await telegramUsers.getByTelegramId(targetId);
  await telegramUsers.setStatus(targetId, action === 'approve' ? 'approved' : 'rejected', approver);

  const resultText = action === 'approve'
    ? [
        '✅ <b>อนุมัติสิทธิ์แล้ว</b>',
        `👤 ${escapeHtml(target?.firstName ?? '-')}`,
        `🆔 <code>${targetId}</code>`,
        `โดย ${escapeHtml(approver)}`,
      ].join('\n')
    : [
        '❌ <b>ปฏิเสธคำขอแล้ว</b>',
        `👤 ${escapeHtml(target?.firstName ?? '-')}`,
        `🆔 <code>${targetId}</code>`,
        `โดย ${escapeHtml(approver)}`,
      ].join('\n');

  // Rewrite the card that was pressed and drop its buttons, so the decision is visible
  // in place and cannot be pressed a second time.
  if (cb.message) {
    await editMessageText(botToken, cb.message.chat.id, cb.message.message_id, resultText);
  }
  await answerCallbackQuery(botToken, cb.id, action === 'approve' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว');

  await sendMessage(
    botToken, targetId,
    action === 'approve'
      ? '✅ คุณได้รับสิทธิ์ใช้งานบอทแล้ว\n\nพิมพ์ <code>Help</code> เพื่อดูคำสั่งที่ใช้ได้'
      : '❌ คำขอสิทธิ์ใช้งานบอทของคุณถูกปฏิเสธ',
  );

  logger.info({ targetId, action, approver }, 'Telegram bot access decision');
}

async function handleUpdate(botToken: string, chatId: string, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallback(botToken, chatId, update);
    return;
  }
  const msg = update.message;
  if (!msg?.from || msg.from.is_bot) return;
  // Group traffic is left alone on purpose: the group is for alerts, and answering every
  // message there would turn the alert channel into a chat room.
  if (msg.chat.type !== 'private') return;
  await handlePrivateMessage(botToken, update);
}

async function pollOnce(): Promise<number> {
  const creds = await getTelegramCredentials();
  if (!creds) return IDLE_DELAY_MS;

  const updates = await getUpdates(creds.botToken, offset, POLL_TIMEOUT_SECONDS);
  for (const update of updates) {
    // Advance the offset before handling: a message that makes the handler throw would
    // otherwise be redelivered forever, and the bot would never process anything again.
    offset = Math.max(offset, update.update_id + 1);
    try {
      await handleUpdate(creds.botToken, creds.chatId, update);
    } catch (err) {
      logger.error({ err, updateId: update.update_id }, 'Telegram update handler failed');
    }
  }
  return 0;
}

export function startTelegramBot(): void {
  if (running) return;
  running = true;
  logger.info('Telegram bot poller started (long polling)');

  void (async () => {
    while (running) {
      try {
        const delay = await pollOnce();
        if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      } catch (err) {
        // The loop itself must never die — this bot is a support tool, and a dead poller
        // that keeps the API "healthy" is exactly the silent-failure shape that cost us
        // 21h on the processing worker (see HANDOFF §Incident 2026-08-20).
        logger.error({ err }, 'Telegram bot poll cycle failed — backing off');
        await new Promise((r) => setTimeout(r, ERROR_BACKOFF_MS));
      }
    }
    logger.info('Telegram bot poller stopped');
  })();
}

export function stopTelegramBot(): void {
  running = false;
}
