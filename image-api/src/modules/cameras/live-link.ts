import { getAllConfigs } from '../system-config/system-config.service.js';

/**
 * A line for an alert that opens this camera full screen on the live wall (?focus=<id>), from public_base_url.
 * Empty when no usable address is set. The alert stays in English; the Telegram and in-app passes translate it.
 */
export async function liveLinkLine(cameraId: string): Promise<string> {
  const base = String((await getAllConfigs()).public_base_url?.value ?? '').trim().replace(/\/+$/, '');
  return /^https?:\/\/\S+$/.test(base) ? `\nLive: ${base}/cctv/live-grid?focus=${cameraId}` : '';
}
