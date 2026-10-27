import crypto from 'node:crypto';
import { config } from '../../config/index.js';
import { logger } from '../../lib/logger.js';

export interface StreamUrls {
  streamPath: string;
  webrtcWhepUrl: string;
  hlsUrl: string;
  rtspUrl: string;
  token?: string;
}

export interface MediaMtxPathConfig {
  source?: string;
  sourceOnDemand?: boolean;
  sourceOnDemandStartTimeout?: string;
  sourceOnDemandCloseAfter?: string;
  record?: boolean;
}

/**
 * Service to manage MediaMTX dynamic stream paths and generate playback endpoints.
 */
export class MediaMtxService {
  private static get baseUrl(): string {
    return config.mediamtx.apiUrl.replace(/\/+$/, '');
  }

  /**
   * Generates a signed stream viewing token for a given path and user.
   */
  static generateStreamToken(streamPath: string, userId = 'user', expiresInSeconds = 86400): string {
    const cleanPath = streamPath.replace(/^\/+/, '');
    const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const payload = `${cleanPath}:${userId}:${expiresAt}`;
    const hmac = crypto.createHmac('sha256', config.jwt.secret).update(payload).digest('hex').substring(0, 32);
    return `${expiresAt}.${userId}.${hmac}`;
  }

  /**
   * Validates a stream token for a given stream path.
   */
  static verifyStreamToken(streamPath: string, token: string): boolean {
    if (!token) return false;
    const cleanPath = streamPath.replace(/^\/+/, '');
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [expiresAtStr, userId, hmac] = parts;
    const expiresAt = parseInt(expiresAtStr, 10);
    if (isNaN(expiresAt) || Math.floor(Date.now() / 1000) > expiresAt) {
      return false; // Expired
    }
    const payload = `${cleanPath}:${userId}:${expiresAt}`;
    const expected = crypto.createHmac('sha256', config.jwt.secret).update(payload).digest('hex').substring(0, 32);
    return hmac === expected;
  }

  /**
   * Generates public client playback URLs for a given camera stream path.
   */
  static getStreamUrls(streamPath: string, token?: string): StreamUrls {
    const cleanPath = streamPath.replace(/^\/+/, '');
    const webrtcBase = config.mediamtx.webrtcUrl.replace(/\/+$/, '');
    const hlsBase = config.mediamtx.hlsUrl.replace(/\/+$/, '');
    const rtspBase = config.mediamtx.rtspUrl.replace(/\/+$/, '');
    const query = token ? `?token=${encodeURIComponent(token)}` : '';

    return {
      streamPath: cleanPath,
      webrtcWhepUrl: `${webrtcBase}/${cleanPath}/whep${query}`,
      hlsUrl: `${hlsBase}/${cleanPath}/index.m3u8${query}`,
      rtspUrl: `${rtspBase}/${cleanPath}${query}`,
      token,
    };
  }

  /**
   * Register or update a camera RTSP source path in MediaMTX.
   */
  static async registerStreamPath(streamPath: string, rtspSourceUrl: string): Promise<boolean> {
    const cleanPath = streamPath.replace(/^\/+/, '');
    const url = `${this.baseUrl}/v3/config/paths/add/${cleanPath}`;

    const payload: MediaMtxPathConfig = {
      source: rtspSourceUrl,
      sourceOnDemand: true,
      sourceOnDemandStartTimeout: '10s',
      sourceOnDemandCloseAfter: '10s',
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        logger.info({ streamPath: cleanPath }, 'Registered stream path with MediaMTX');
        return true;
      }

      // If already exists (400 or 409), try PATCH to update source
      if (res.status === 400 || res.status === 409) {
        const patchUrl = `${this.baseUrl}/v3/config/paths/patch/${cleanPath}`;
        const patchRes = await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (patchRes.ok) {
          logger.info({ streamPath: cleanPath }, 'Updated stream path with MediaMTX');
          return true;
        }
      }

      const text = await res.text();
      logger.warn({ streamPath: cleanPath, status: res.status, error: text }, 'Failed to configure MediaMTX stream path');
      return false;
    } catch (err) {
      logger.warn({ streamPath: cleanPath, err }, 'Unable to connect to MediaMTX API (may be starting up)');
      return false;
    }
  }

  /**
   * Remove a stream path from MediaMTX.
   */
  static async removeStreamPath(streamPath: string): Promise<boolean> {
    const cleanPath = streamPath.replace(/^\/+/, '');
    const url = `${this.baseUrl}/v3/config/paths/delete/${cleanPath}`;

    try {
      const res = await fetch(url, { method: 'DELETE' });
      return res.ok;
    } catch (err) {
      logger.warn({ streamPath: cleanPath, err }, 'Failed to delete stream path from MediaMTX');
      return false;
    }
  }

  /**
   * Check live status of paths from MediaMTX.
   */
  static async getLivePaths(): Promise<any[]> {
    const url = `${this.baseUrl}/v3/paths/list`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = await res.json() as any;
      return data?.items ?? [];
    } catch (err) {
      return [];
    }
  }
}
