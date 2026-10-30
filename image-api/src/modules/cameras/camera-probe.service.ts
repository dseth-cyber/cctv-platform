import net from 'net';
import { openRtspUrl } from '../../lib/rtsp-credentials.js';
import { getPrisma } from '../../lib/prisma.js';

export interface ProbeResult {
  reachable: boolean;
  latencyMs: number;
  reason?: string;
}

/**
 * Extracts host and port from an RTSP URL.
 * e.g. rtsp://admin:pass@192.168.1.100:554/ch1/main -> { host: '192.168.1.100', port: 554 }
 */
export function parseRtspEndpoint(rtspUrl: string): { host: string; port: number } | null {
  try {
    const cleaned = rtspUrl.replace(/^rtsp:\/\//i, '');
    const withoutAuth = cleaned.includes('@') ? cleaned.split('@')[1] : cleaned;
    const hostAndPath = withoutAuth.split('/')[0];
    const [host, portStr] = hostAndPath.split(':');
    const port = portStr ? parseInt(portStr, 10) : 554;
    return { host, port: Number.isNaN(port) ? 554 : port };
  } catch (err) {
    return null;
  }
}

/**
 * Probes a TCP endpoint with timeout and latency measurement.
 */
export async function probeTcpEndpoint(host: string, port = 554, timeoutMs = 3000): Promise<ProbeResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isDone = false;

    const finish = (reachable: boolean, reason?: string) => {
      if (!isDone) {
        isDone = true;
        const latencyMs = Date.now() - start;
        socket.destroy();
        resolve({ reachable, latencyMs, reason });
      }
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false, 'Connection timed out'));
    socket.once('error', (err) => finish(false, err.message));

    try {
      socket.connect(port, host);
    } catch (err: any) {
      finish(false, err.message);
    }
  });
}

/**
 * Probes a camera's connectivity (RTSP, TCP, Device DVR, or SMB) and updates lastPolledAt if online.
 */
export async function probeCameraHealth(camera: {
  id: string;
  name: string;
  ipAddress?: string | null;
  rtspUrl?: string | null;
  smbSharePath?: string | null;
  smbUsername?: string | null;
  smbPasswordEncrypted?: string | null;
  smbDomain?: string | null;
  device?: { ipAddress: string; rtspPort: number } | null;
}): Promise<ProbeResult> {
  const prisma = getPrisma();

  // 1. If RTSP URL is provided, probe RTSP endpoint
  if (camera.rtspUrl) {
    const ep = parseRtspEndpoint(openRtspUrl(camera.rtspUrl) ?? '');
    if (ep) {
      const res = await probeTcpEndpoint(ep.host, ep.port);
      if (res.reachable) {
        await prisma.camera.update({
          where: { id: camera.id },
          data: { lastPolledAt: new Date() },
        });
      }
      return res;
    }
  }

  // 2. If camera has a linked DVR/NVR device, probe device IP:RTSP port
  if (camera.device?.ipAddress) {
    const res = await probeTcpEndpoint(camera.device.ipAddress, camera.device.rtspPort || 554);
    if (res.reachable) {
      await prisma.camera.update({
        where: { id: camera.id },
        data: { lastPolledAt: new Date() },
      });
    }
    return res;
  }

  // 3. If direct IP address is available
  if (camera.ipAddress) {
    const res = await probeTcpEndpoint(camera.ipAddress, 554);
    if (res.reachable) {
      await prisma.camera.update({
        where: { id: camera.id },
        data: { lastPolledAt: new Date() },
      });
    }
    return res;
  }

  // 4. Legacy SMB probe if configured
  if (camera.smbSharePath && camera.smbUsername && camera.smbPasswordEncrypted) {
    try {
      const { testConnection } = await import('../smb/smb.service.js');
      const { decrypt } = await import('../../lib/encryption.js');
      const start = Date.now();
      const res = await testConnection({
        smbSharePath: camera.smbSharePath,
        smbUsername: camera.smbUsername,
        smbPasswordEncrypted: decrypt(camera.smbPasswordEncrypted),
        smbDomain: camera.smbDomain ?? undefined,
      });
      const latencyMs = Date.now() - start;
      if (res.success) {
        await prisma.camera.update({
          where: { id: camera.id },
          data: { lastPolledAt: new Date() },
        });
        return { reachable: true, latencyMs };
      }
      return { reachable: false, latencyMs, reason: res.message };
    } catch (err: any) {
      return { reachable: false, latencyMs: 0, reason: err.message };
    }
  }

  return { reachable: false, latencyMs: 0, reason: 'No probe target configured' };
}
