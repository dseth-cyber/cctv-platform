import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

export async function sendLineAlert(title: string, message: string, severity: string): Promise<boolean> {
  const accessToken = config.notifications.line.accessToken;
  if (!accessToken) {
    logger.warn('Line not configured — skipping notification');
    return false;
  }

  const icon = severity === 'critical' || severity === 'emergency' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
  const text = `${icon} ${title}\n${message}`;

  try {
    const res = await fetch('https://notify-api.line.me/api/notify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: new URLSearchParams({ message: text }),
    });

    if (!res.ok) {
      const body = await res.text();
      logger.error({ status: res.status, body }, 'Line send failed');
      return false;
    }

    logger.info('Line alert sent');
    return true;
  } catch (err) {
    logger.error({ err }, 'Line send error');
    return false;
  }
}
