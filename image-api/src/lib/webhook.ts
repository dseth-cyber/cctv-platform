import { logger } from './logger.js';
import { getAllConfigs } from '../modules/system-config/system-config.service.js';

export async function sendWebhook(event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    const configs = await getAllConfigs();
    const url = configs.webhook_url?.value;
    if (!url) return;

    const body = JSON.stringify({ event, timestamp: new Date().toISOString(), data: payload });

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = configs.webhook_secret?.value;
    if (secret) {
      const crypto = await import('crypto');
      headers['X-Webhook-Signature'] = crypto.createHmac('sha256', secret).update(body).digest('hex');
    }

    const response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
    logger.info({ event, status: response.status }, 'Webhook sent');
  } catch (err: any) {
    logger.warn({ event, error: err.message }, 'Webhook failed');
  }
}
