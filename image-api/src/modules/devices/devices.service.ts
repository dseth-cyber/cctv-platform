import { getPrisma } from '../../lib/prisma.js';
import { SECRET_MASK, sealRtspUrl, redactRtspUrl } from '../../lib/rtsp-credentials.js';
import { NotFoundError, ConflictError } from '../../lib/errors.js';
import { encrypt, decrypt } from '../../lib/encryption.js';
import type { CreateDeviceInput, UpdateDeviceInput, DeviceQueryInput } from './devices.schema.js';

/**
 * Builds standard RTSP URL for DVR/NVR channels based on common vendor URL schemes.
 */
export function buildChannelRtspUrl(
  brand: string | null | undefined,
  ip: string,
  port: number,
  channel: number,
  username?: string | null,
  password?: string | null,
  subtype: 'main' | 'sub' = 'main',
): string {
  const auth = username ? (password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : `${encodeURIComponent(username)}@`) : '';
  const b = (brand ?? 'generic').toLowerCase();

  // Hikvision / Hilook: rtsp://user:pass@ip:port/Streaming/Channels/{channel}01 (main) or {channel}02 (sub)
  if (b.includes('hik') || b.includes('hilook')) {
    const streamCode = subtype === 'main' ? '01' : '02';
    return `rtsp://${auth}${ip}:${port}/Streaming/Channels/${channel}${streamCode}`;
  }

  // Dahua / IMOU: rtsp://user:pass@ip:port/cam/realmonitor?channel={channel}&subtype=0 (main) or 1 (sub)
  if (b.includes('dahua') || b.includes('imou')) {
    const st = subtype === 'main' ? 0 : 1;
    return `rtsp://${auth}${ip}:${port}/cam/realmonitor?channel=${channel}&subtype=${st}`;
  }

  // Uniview / UNV: rtsp://user:pass@ip:port/unicast/c{channel}/s0/live (main) or s1 (sub)
  if (b.includes('uni') || b.includes('unv')) {
    const st = subtype === 'main' ? 0 : 1;
    return `rtsp://${auth}${ip}:${port}/unicast/c${channel}/s${st}/live`;
  }

  // Generic / Default
  return `rtsp://${auth}${ip}:${port}/ch${channel}/${subtype}`;
}

export async function listDevices(filters?: DeviceQueryInput) {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (filters?.deviceType) where.deviceType = filters.deviceType;
  if (filters?.siteId) where.siteId = filters.siteId;
  if (filters?.enabled !== undefined) where.enabled = filters.enabled;

  const devices = await prisma.device.findMany({
    where,
    include: {
      site: { select: { id: true, name: true, code: true } },
      _count: { select: { cameras: true } },
    },
    orderBy: { name: 'asc' },
  });

  return devices.map((d) => ({
    ...d,
    passwordEncrypted: d.passwordEncrypted ? '********' : null,
    cameraCount: d._count.cameras,
  }));
}

export async function getDeviceById(id: string) {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { id },
    include: {
      site: true,
      cameras: {
        select: {
          id: true,
          name: true,
          channelNumber: true,
          rtspUrl: true,
          rtspUrlSub: true,
          streamPath: true,
          status: true,
          enabled: true,
          operationalStatus: true,
        },
        orderBy: { channelNumber: 'asc' },
      },
    },
  });

  if (!device) {
    throw new NotFoundError('Device', id);
  }

  return {
    ...device,
    passwordEncrypted: device.passwordEncrypted ? SECRET_MASK : null,
    cameras: device.cameras.map((c) => ({ ...c, rtspUrl: redactRtspUrl(c.rtspUrl), rtspUrlSub: redactRtspUrl(c.rtspUrlSub) })),
  };
}

export async function createDevice(input: CreateDeviceInput) {
  const prisma = getPrisma();

  if (input.siteId) {
    const site = await prisma.site.findUnique({ where: { id: input.siteId } });
    if (!site) throw new NotFoundError('Site', input.siteId);
  }

  const encryptedPassword = input.password ? encrypt(input.password) : null;

  const device = await prisma.device.create({
    data: {
      name: input.name,
      description: input.description,
      deviceType: input.deviceType,
      brand: input.brand,
      model: input.model,
      serialNumber: input.serialNumber,
      ipAddress: input.ipAddress,
      rtspPort: input.rtspPort,
      httpPort: input.httpPort,
      onvifPort: input.onvifPort,
      username: input.username,
      passwordEncrypted: encryptedPassword,
      totalChannels: input.totalChannels,
      enabled: input.enabled,
      siteId: input.siteId,
    },
    include: { site: true },
  });

  // If autoCreateCameras is requested, provision cameras for each channel
  if (input.autoCreateCameras && input.totalChannels > 0) {
    await provisionDeviceChannels(device.id);
  }

  return {
    ...device,
    passwordEncrypted: device.passwordEncrypted ? '********' : null,
  };
}

export async function updateDevice(id: string, input: UpdateDeviceInput) {
  const prisma = getPrisma();

  const existing = await prisma.device.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Device', id);

  if (input.siteId) {
    const site = await prisma.site.findUnique({ where: { id: input.siteId } });
    if (!site) throw new NotFoundError('Site', input.siteId);
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.deviceType !== undefined) data.deviceType = input.deviceType;
  if (input.brand !== undefined) data.brand = input.brand;
  if (input.model !== undefined) data.model = input.model;
  if (input.serialNumber !== undefined) data.serialNumber = input.serialNumber;
  if (input.ipAddress !== undefined) data.ipAddress = input.ipAddress;
  if (input.rtspPort !== undefined) data.rtspPort = input.rtspPort;
  if (input.httpPort !== undefined) data.httpPort = input.httpPort;
  if (input.onvifPort !== undefined) data.onvifPort = input.onvifPort;
  if (input.username !== undefined) data.username = input.username;
  if (input.password !== undefined && input.password !== SECRET_MASK) data.passwordEncrypted = input.password ? encrypt(input.password) : null;
  if (input.totalChannels !== undefined) data.totalChannels = input.totalChannels;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.status !== undefined) data.status = input.status;
  if (input.siteId !== undefined) data.siteId = input.siteId;

  const updated = await prisma.device.update({
    where: { id },
    data,
    include: { site: true },
  });

  return {
    ...updated,
    passwordEncrypted: updated.passwordEncrypted ? '********' : null,
  };
}

export async function deleteDevice(id: string) {
  const prisma = getPrisma();
  const existing = await prisma.device.findUnique({
    where: { id },
    include: { _count: { select: { cameras: true } } },
  });

  if (!existing) throw new NotFoundError('Device', id);
  if (existing._count.cameras > 0) {
    throw new ConflictError(`Cannot delete device with ${existing._count.cameras} linked cameras. Reassign or remove cameras first.`);
  }

  await prisma.device.delete({ where: { id } });
  return { success: true };
}

/**
 * Automatically creates Camera entities for any channel 1..totalChannels that doesn't yet exist.
 */
export async function provisionDeviceChannels(deviceId: string) {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { cameras: { select: { channelNumber: true } } },
  });

  if (!device) throw new NotFoundError('Device', deviceId);

  const existingChannels = new Set(device.cameras.map((c) => c.channelNumber).filter((n): n is number => n !== null));
  const rawPassword = device.passwordEncrypted ? decrypt(device.passwordEncrypted) : null;
  const createdCameras = [];

  for (let ch = 1; ch <= device.totalChannels; ch++) {
    if (!existingChannels.has(ch)) {
      const streamPath = `dvr_${device.id.replace(/-/g, '').substring(0, 8)}_ch${ch}`;
      const rtspUrl = buildChannelRtspUrl(device.brand, device.ipAddress, device.rtspPort, ch, device.username, rawPassword, 'main');
      const rtspUrlSub = buildChannelRtspUrl(device.brand, device.ipAddress, device.rtspPort, ch, device.username, rawPassword, 'sub');

      const cam = await prisma.camera.create({
        data: {
          name: `${device.name} - Ch ${ch}`,
          deviceId: device.id,
          channelNumber: ch,
          ipAddress: device.ipAddress,
          rtspUrl: sealRtspUrl(rtspUrl),
          rtspUrlSub: sealRtspUrl(rtspUrlSub),
          streamPath,
          siteId: device.siteId,
          status: 'inactive',
          operationalStatus: 'unknown',
          captureMode: 'continuous',
        },
      });
      createdCameras.push(cam);
    }
  }

  return {
    deviceId: device.id,
    provisionedCount: createdCameras.length,
    cameras: createdCameras.map((c) => ({ ...c, rtspUrl: redactRtspUrl(c.rtspUrl), rtspUrlSub: redactRtspUrl(c.rtspUrlSub) })),
  };
}

export interface DeviceVendorTemplate {
  brand: string;
  label: string;
  defaultRtspPort: number;
  defaultHttpPort: number;
  defaultOnvifPort?: number;
  mainStreamPattern: string;
  subStreamPattern: string;
  commonChannels: number[];
  description: string;
}

export function getDeviceTemplates(): DeviceVendorTemplate[] {
  return [
    {
      brand: 'Hikvision',
      label: 'Hikvision / Hilook (DVR/NVR)',
      defaultRtspPort: 554,
      defaultHttpPort: 80,
      defaultOnvifPort: 8000,
      mainStreamPattern: '/Streaming/Channels/{channel}01',
      subStreamPattern: '/Streaming/Channels/{channel}02',
      commonChannels: [4, 8, 16, 32, 64],
      description: 'Standard Hikvision RTSP stream scheme with dual-stream support',
    },
    {
      brand: 'Dahua',
      label: 'Dahua / IMOU (XVR/NVR)',
      defaultRtspPort: 554,
      defaultHttpPort: 80,
      defaultOnvifPort: 37777,
      mainStreamPattern: '/cam/realmonitor?channel={channel}&subtype=0',
      subStreamPattern: '/cam/realmonitor?channel={channel}&subtype=1',
      commonChannels: [4, 8, 16, 32, 64],
      description: 'Standard Dahua realmonitor scheme with subtype=0 (main) and subtype=1 (sub)',
    },
    {
      brand: 'Uniview',
      label: 'Uniview / UNV',
      defaultRtspPort: 554,
      defaultHttpPort: 80,
      defaultOnvifPort: 80,
      mainStreamPattern: '/unicast/c{channel}/s0/live',
      subStreamPattern: '/unicast/c{channel}/s1/live',
      commonChannels: [4, 8, 16, 32],
      description: 'Uniview unicast RTSP live feed',
    },
    {
      brand: 'Hanwha',
      label: 'Hanwha Techwin (Samsung)',
      defaultRtspPort: 554,
      defaultHttpPort: 80,
      defaultOnvifPort: 80,
      mainStreamPattern: '/profile2/media.smp',
      subStreamPattern: '/profile3/media.smp',
      commonChannels: [4, 8, 16, 32],
      description: 'Hanwha Wisenet Profile 2 / Profile 3 scheme',
    },
    {
      brand: 'Tiandy',
      label: 'Tiandy',
      defaultRtspPort: 554,
      defaultHttpPort: 80,
      defaultOnvifPort: 80,
      mainStreamPattern: '/live/ch{channel}',
      subStreamPattern: '/live/ch{channel}_sub',
      commonChannels: [4, 8, 16, 32],
      description: 'Tiandy live channel scheme',
    },
    {
      brand: 'Xiongmai',
      label: 'XM / Xiongmai (NetSurveillance)',
      defaultRtspPort: 554,
      defaultHttpPort: 80,
      defaultOnvifPort: 34567,
      mainStreamPattern: '/user={username}&password={password}&channel={channel}&stream=0.sdp',
      subStreamPattern: '/user={username}&password={password}&channel={channel}&stream=1.sdp',
      commonChannels: [4, 8, 16, 32],
      description: 'Xiongmai XMeye RTSP stream with embedded credentials and stream parameter',
    },
    {
      brand: 'Generic',
      label: 'Generic RTSP / ONVIF',
      defaultRtspPort: 554,
      defaultHttpPort: 80,
      defaultOnvifPort: 80,
      mainStreamPattern: '/ch{channel}/main',
      subStreamPattern: '/ch{channel}/sub',
      commonChannels: [1, 4, 8, 16],
      description: 'Universal fallback RTSP scheme',
    },
  ];
}

async function testPort(host: string, port: number, timeoutMs = 2500): Promise<{ open: boolean; latencyMs: number }> {
  const net = await import('node:net');
  const start = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    socket.setTimeout(timeoutMs);

    socket.connect(port, host, () => {
      if (!isResolved) {
        isResolved = true;
        const latencyMs = Date.now() - start;
        socket.destroy();
        resolve({ open: true, latencyMs });
      }
    });

    socket.on('error', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ open: false, latencyMs: 0 });
      }
    });

    socket.on('timeout', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve({ open: false, latencyMs: 0 });
      }
    });
  });
}

export async function probeDeviceConnection(ip: string, rtspPort = 554, httpPort = 80) {
  const rtspResult = await testPort(ip, rtspPort);
  const httpResult = await testPort(ip, httpPort);

  const reachable = rtspResult.open || httpResult.open;
  const latencyMs = rtspResult.open ? rtspResult.latencyMs : httpResult.latencyMs;

  return {
    ipAddress: ip,
    reachable,
    rtspOpen: rtspResult.open,
    httpOpen: httpResult.open,
    latencyMs,
    message: reachable
      ? `Device reachable (${latencyMs}ms)${rtspResult.open ? ', RTSP active' : ''}`
      : `Cannot connect to ${ip}:${rtspPort} or ${ip}:${httpPort}`,
  };
}

export async function bulkImportDevices(devicesInput: CreateDeviceInput[]) {
  const results = [];
  let totalCamerasCreated = 0;

  for (const input of devicesInput) {
    const dev = await createDevice(input);
    results.push(dev);
    if (input.autoCreateCameras) {
      totalCamerasCreated += input.totalChannels;
    }
  }

  return {
    importedCount: results.length,
    devices: results,
    totalCamerasCreated,
  };
}

export async function getDashboardSummary() {
  const prisma = getPrisma();

  const [devices, cameras, sites, recentIncidents] = await Promise.all([
    prisma.device.findMany({
      include: {
        _count: { select: { cameras: true } },
      },
    }),
    prisma.camera.findMany({
      where: { enabled: true },
      select: {
        id: true,
        name: true,
        operationalStatus: true,
        status: true,
        deviceId: true,
        siteId: true,
        zoneId: true,
        rtspUrl: true,
        rtspUrlSub: true,
        streamPath: true,
      },
    }),
    prisma.site.findMany({
      include: {
        _count: { select: { devices: true, cameras: true } },
      },
    }),
    prisma.cameraIncident.findMany({
      where: { status: 'open' },
      take: 6,
      orderBy: { openedAt: 'desc' },
      include: {
        camera: { select: { id: true, name: true } },
      },
    }),
  ]);

  const totalDevices = devices.length;
  const devicesOnline = devices.filter((d) => d.status === 'active' && d.enabled).length;
  const devicesOffline = totalDevices - devicesOnline;
  const totalConfiguredChannels = devices.reduce((acc, d) => acc + (d.totalChannels || 0), 0);

  const byDeviceType: Record<string, number> = { dvr: 0, nvr: 0, ip_camera: 0, other: 0 };
  const byBrand: Record<string, number> = {};
  for (const d of devices) {
    byDeviceType[d.deviceType] = (byDeviceType[d.deviceType] || 0) + 1;
    const b = d.brand || 'Generic';
    byBrand[b] = (byBrand[b] || 0) + 1;
  }

  const totalCameras = cameras.length;
  const camerasOnline = cameras.filter((c) => c.operationalStatus === 'online').length;
  const camerasStalled = cameras.filter((c) => c.operationalStatus === 'unknown').length;
  const camerasOffline = cameras.filter((c) => c.operationalStatus === 'offline').length;
  const healthPercent = totalCameras > 0 ? Math.round((camerasOnline / totalCameras) * 100) : 100;

  // Bandwidth estimation:
  // Main stream 1080p ~ 2.5 Mbps, Sub stream D1 ~ 0.5 Mbps
  const mainStreamsActive = camerasOnline;
  const subStreamsActive = cameras.filter((c) => Boolean(c.rtspUrlSub)).length;
  const estimatedMainMbps = Number((mainStreamsActive * 2.5).toFixed(1));
  const estimatedSubMbps = Number((subStreamsActive * 0.5).toFixed(1));
  const totalBitrateMbps = Number((estimatedMainMbps + estimatedSubMbps).toFixed(1));
  // Est monthly storage GB = (Mbps * 3600 * 24 * 30) / (8 * 1024) = Mbps * 324
  const estimatedMonthlyStorageGb = Math.round(totalBitrateMbps * 324);

  // Group cameras by Site
  const siteMap = new Map<string, { total: number; online: number; offline: number }>();
  for (const c of cameras) {
    if (c.siteId) {
      const curr = siteMap.get(c.siteId) || { total: 0, online: 0, offline: 0 };
      curr.total++;
      if (c.operationalStatus === 'online') curr.online++;
      else curr.offline++;
      siteMap.set(c.siteId, curr);
    }
  }

  const siteBreakdown = sites.map((s) => {
    const stats = siteMap.get(s.id) || { total: s._count.cameras, online: 0, offline: s._count.cameras };
    return {
      id: s.id,
      name: s.name,
      code: s.code,
      totalCameras: stats.total,
      onlineCameras: stats.online,
      offlineCameras: stats.offline,
      deviceCount: s._count.devices,
      healthPercent: stats.total > 0 ? Math.round((stats.online / stats.total) * 100) : 100,
    };
  });

  return {
    devices: {
      total: totalDevices,
      online: devicesOnline,
      offline: devicesOffline,
      totalChannels: totalConfiguredChannels,
      byType: byDeviceType,
      byBrand,
    },
    cameras: {
      total: totalCameras,
      online: camerasOnline,
      stalled: camerasStalled,
      offline: camerasOffline,
      healthPercent,
    },
    bandwidth: {
      totalBitrateMbps,
      estimatedMainMbps,
      estimatedSubMbps,
      mainStreamsActive,
      subStreamsActive,
      estimatedMonthlyStorageGb,
    },
    protocols: {
      webrtcWhep: camerasOnline,
      rtsp: totalCameras,
      hls: Math.min(camerasOnline, 16),
    },
    sites: siteBreakdown,
    recentIncidents,
  };
}


