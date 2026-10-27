import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import * as settingsService from './system-settings.service.js';

const TELEGRAM_KEYS = ['telegram_bot_token', 'telegram_chat_id', 'telegram_api_base_url', 'telegram_api_token', 'telegram_allow_private_chat'];

// Provider-agnostic on purpose: an OpenAI-compatible endpoint, Anthropic, or a model
// self-hosted inside the company all differ only by base URL and model name.
const LLM_KEYS = ['llm_enabled', 'llm_base_url', 'llm_model', 'llm_api_key', 'llm_timeout_seconds'];

async function getTelegramSettings(_request: FastifyRequest, reply: FastifyReply) {
  const settings = await settingsService.getSettings(TELEGRAM_KEYS);
  return reply.send(settings);
}

async function updateTelegramSettings(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, string>;
  for (const key of TELEGRAM_KEYS) {
    if (body[key] !== undefined) {
      await settingsService.setSetting(key, String(body[key]));
    }
  }
  return reply.send({ ok: true });
}

async function getLlmSettings(_request: FastifyRequest, reply: FastifyReply) {
  const settings = await settingsService.getSettings(LLM_KEYS);
  // The key is never sent back to the browser — only whether one is stored. A settings
  // screen has no reason to re-display a credential it already holds, and every reason
  // not to put it back on the wire.
  return reply.send({ ...settings, llm_api_key: undefined, llm_api_key_set: Boolean(settings.llm_api_key) });
}

async function updateLlmSettings(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as Record<string, string>;
  for (const key of LLM_KEYS) {
    if (body[key] === undefined) continue;
    // An empty key field means "leave it alone", not "erase it" — otherwise saving any
    // other field on the page would silently wipe the credential.
    if (key === 'llm_api_key' && String(body[key]) === '') continue;
    await settingsService.setSetting(key, String(body[key]));
  }
  return reply.send({ ok: true });
}

async function clearLlmKey(_request: FastifyRequest, reply: FastifyReply) {
  await settingsService.setSetting('llm_api_key', '');
  return reply.send({ ok: true });
}

export async function systemSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/telegram', { preHandler: [app.authenticate, requirePermission('telegram-bot:read')] }, getTelegramSettings);
  app.patch('/telegram', { preHandler: [app.authenticate, requirePermission('telegram-bot:update')] }, updateTelegramSettings);
  app.get('/llm', { preHandler: [app.authenticate, requirePermission('telegram-bot:read')] }, getLlmSettings);
  app.patch('/llm', { preHandler: [app.authenticate, requirePermission('telegram-bot:update')] }, updateLlmSettings);
  app.delete('/llm/key', { preHandler: [app.authenticate, requirePermission('telegram-bot:update')] }, clearLlmKey);
}
