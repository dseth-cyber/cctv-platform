import { sortByName } from '../../lib/natural-sort.js';
import type { Prisma } from '@prisma/client';
import { checkLogin, readDeviceInfo, RecorderError } from '../device-playback/hikvision-recorder.js';
import { getPrisma } from '../../lib/prisma.js';
import { SECRET_MASK, sealRtspUrl, redactRtspUrl } from '../../lib/rtsp-credentials.js';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import { encrypt, decrypt } from '../../lib/encryption.js';
import { resolveLocation } from '../sites/sites.service.js';
import { closeOfflineAlerts, enabledCameraFields } from '../cameras/camera-enabled.js';
import type { CreateDeviceInput, UpdateDeviceInput, DeviceQueryInput } from './devices.schema.js';

export const channelCameraName = (deviceName: string, channel: number) => `${deviceName} - Ch ${channel}`;

/** Vendor template for a brand name ("Hikvision", "hilook", "IMOU", ...); unknown brands get Generic. */
export function findDeviceTemplate(brand: string | null | undefined): DeviceVendorTemplate {
  const templates = getDeviceTemplates();
  const b = (brand ?? '').trim().toLowerCase();
  const exact = templates.find((t) => t.brand.toLowerCase() === b);
  if (exact) return exact;
  const alias: [RegExp, string][] = [
    [/hik|hilook/, 'Hikvision'],
    [/dahua|imou/, 'Dahua'],
    [/uniview|\bunv\b/, 'Uniview'],
    [/hanwha|samsung|wisenet/, 'Hanwha'],
    [/tiandy/, 'Tiandy'],
    [/xiongmai|xmeye|\bxm\b/, 'Xiongmai'],
  ];
  const hit = alias.find(([re]) => re.test(b));
  return templates.find((t) => t.brand === (hit?.[1] ?? 'Generic'))!;
}

/**
 * Builds the RTSP URL of one camera/channel from the brand's stream pattern (getDeviceTemplates).
 * Credentials go in the userinfo, or into the path when the pattern has {username}/{password}.
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
  const tpl = findDeviceTemplate(brand);
  const pattern = subtype === 'main' ? tpl.mainStreamPattern : tpl.subStreamPattern;
  const user = encodeURIComponent(username ?? '');
  const pass = encodeURIComponent(password ?? '');
  const credsInPath = /\{username\}|\{password\}/.test(pattern);
  const auth = !credsInPath && username ? (password ? `${user}:${pass}@` : `${user}@`) : '';
  const path = pattern
    .replace(/\{channel\}/g, String(channel))
    .replace(/\{username\}/g, user)
    .replace(/\{password\}/g, pass);
  return `rtsp://${auth}${ip}:${port}${path}`;
}

export async function listDevices(filters?: DeviceQueryInput, scope?: Prisma.CameraWhereInput) {
  const prisma = getPrisma();
  const where: Record<string, unknown> = {};

  if (filters?.deviceType) where.deviceType = filters.deviceType;
  if (filters?.siteId) where.siteId = filters.siteId;
  if (filters?.enabled !== undefined) where.enabled = filters.enabled;
  // A device shows when at least one of its cameras is within reach, and shows only those.
  const reachable: Prisma.CameraWhereInput = { deletedAt: null, ...(scope ? { AND: [scope] } : {}) };
  if (scope) where.cameras = { some: reachable };

  const devices = await prisma.device.findMany({
    where,
    include: {
      site: { select: { id: true, name: true, code: true } },
      zone: { select: { id: true, name: true, code: true } },
      cameras: { where: reachable, select: { channelNumber: true, enabled: true } },
    },
    orderBy: { name: 'asc' },
  });

  return sortByName(devices).map(({ cameras, ...d }) => ({
    ...d,
    passwordEncrypted: d.passwordEncrypted ? '********' : null,
    cameraCount: cameras.length,
    enabledChannels: cameras
      .filter((c) => c.enabled && c.channelNumber !== null)
      .map((c) => c.channelNumber as number)
      .sort((a, b) => a - b),
  }));
}

export async function getDeviceById(id: string) {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({
    where: { id },
    include: {
      site: true,
      zone: true,
      cameras: {
        where: { deletedAt: null },
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

async function assertDeviceNameFree(name: string, exceptId?: string) {
  const clash = await getPrisma().device.findFirst({ where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw new ConflictError(`Device with name '${name}' already exists`, { code: 'DEVICE_NAME_TAKEN' });
}

/** One address and RTSP port is one machine. A different port is allowed, for recorders behind port forwarding. */
async function assertDeviceAddressFree(ipAddress: string, rtspPort: number, exceptId?: string) {
  const clash = await getPrisma().device.findFirst({ where: { ipAddress, rtspPort, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { name: true } });
  if (clash) throw new ConflictError(`Device "${clash.name}" already uses ${ipAddress}:${rtspPort}`, { code: 'DEVICE_ADDRESS_TAKEN', device: clash.name });
}

async function assertDeviceTypeExists(code: string | undefined) {
  if (code === undefined) return;
  const found = await getPrisma().masterdata.findFirst({ where: { type: 'device_type', code }, select: { id: true } });
  if (!found) throw new ValidationError(`Unknown device type "${code}"`, { code: 'DEVICE_TYPE_UNKNOWN' });
}

export async function createDevice(input: CreateDeviceInput) {
  await assertDeviceTypeExists(input.deviceType);
  const prisma = getPrisma();

  const location = await resolveLocation(input.siteId, input.zoneId);

  // Channel cameras take their names from the device, so two devices cannot share one.
  await assertDeviceNameFree(input.name);
  await assertDeviceAddressFree(input.ipAddress, input.rtspPort);

  const encryptedPassword = input.password ? encrypt(input.password) : null;

  const device = await prisma.device.create({
    data: {
      name: input.name,
      description: input.description,
      deviceType: input.deviceType,
      brand: input.brand,
      model: input.model,
      serialNumber: input.serialNumber,
      macAddress: input.macAddress || null,
      firmwareVersion: input.firmwareVersion || null,
      shortCode: input.shortCode || null,
      alertLevel: input.alertLevel || null,
      snapshotRefreshSeconds: input.snapshotRefreshSeconds ?? null,
      ipAddress: input.ipAddress,
      rtspPort: input.rtspPort,
      httpPort: input.httpPort,
      onvifPort: input.onvifPort,
      username: input.username,
      passwordEncrypted: encryptedPassword,
      totalChannels: input.totalChannels,
      enabled: input.enabled,
      siteId: location.siteId,
      zoneId: location.zoneId,
    },
    include: { site: true },
  });

  // If autoCreateCameras is requested, provision cameras for each channel
  if (input.autoCreateCameras && input.totalChannels > 0) {
    await provisionDeviceChannels(device.id, { enabledChannels: input.enabledChannels });
  }

  return {
    ...device,
    passwordEncrypted: device.passwordEncrypted ? '********' : null,
  };
}

/**
 * A device's channels are its cameras: they keep its name, reach it at its address with its login, and
 * follow its channel count. A name someone set by hand is left alone.
 */
async function followDeviceChanges(
  before: { siteId: string | null; zoneId: string | null; name: string; brand: string | null; ipAddress: string; rtspPort: number; username: string | null; passwordEncrypted: string | null; totalChannels: number },
  after: { id: string; siteId: string | null; zoneId: string | null; name: string; brand: string | null; ipAddress: string; rtspPort: number; username: string | null; passwordEncrypted: string | null; totalChannels: number },
) {
  const prisma = getPrisma();
  if (before.siteId !== after.siteId || before.zoneId !== after.zoneId) {
    // Only those still following the device: a camera given its own place keeps it.
    await prisma.camera.updateMany({
      where: { deviceId: after.id, deletedAt: null, locationFromDevice: true },
      data: { siteId: after.siteId, zoneId: after.zoneId },
    });
  }
  const cameras = await prisma.camera.findMany({
    where: { deviceId: after.id, deletedAt: null, channelNumber: { not: null } },
    select: { id: true, name: true, channelNumber: true, enabled: true },
  });
  if (cameras.length === 0) return;

  const addressChanged = before.brand !== after.brand || before.ipAddress !== after.ipAddress || before.rtspPort !== after.rtspPort
    || before.username !== after.username || before.passwordEncrypted !== after.passwordEncrypted;
  const password = after.passwordEncrypted ? decrypt(after.passwordEncrypted) : null;

  for (const cam of cameras) {
    const channel = cam.channelNumber as number;
    const data: Record<string, unknown> = {};
    if (before.name !== after.name && cam.name === channelCameraName(before.name, channel)) {
      const wanted = channelCameraName(after.name, channel);
      const taken = await prisma.camera.findFirst({ where: { name: wanted, id: { not: cam.id } } });
      if (!taken) data.name = wanted;
    }
    if (addressChanged) {
      data.ipAddress = after.ipAddress;
      data.rtspUrl = sealRtspUrl(buildChannelRtspUrl(after.brand, after.ipAddress, after.rtspPort, channel, after.username, password, 'main'));
      data.rtspUrlSub = sealRtspUrl(buildChannelRtspUrl(after.brand, after.ipAddress, after.rtspPort, channel, after.username, password, 'sub'));
    }
    // Fewer channels than before: what is past the end no longer exists on the device.
    if (channel > after.totalChannels && cam.enabled) {
      data.enabled = false;
      data.status = 'inactive';
      data.operationalStatus = 'unknown';
    }
    if (Object.keys(data).length > 0) await prisma.camera.update({ where: { id: cam.id }, data });
  }

  if (after.totalChannels > before.totalChannels) await provisionDeviceChannels(after.id);
}

/** Which channels have a camera in use. A channel switched off is not watched, so it raises no alert. */
export async function setEnabledChannels(deviceId: string, enabledChannels: number[]) {
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new NotFoundError('Device', deviceId);
  const tooHigh = enabledChannels.filter((ch) => ch > device.totalChannels);
  if (tooHigh.length > 0) {
    throw new ValidationError(`This device has ${device.totalChannels} channels; it has no channel ${tooHigh[0]}`);
  }

  await provisionDeviceChannels(deviceId, { enabledChannels });

  const wanted = new Set(enabledChannels);
  const cameras = await prisma.camera.findMany({
    where: { deviceId, deletedAt: null, channelNumber: { not: null } },
    select: { id: true, channelNumber: true, enabled: true },
  });
  const changed: Array<{ channel: number; enabled: boolean }> = [];
  for (const cam of cameras) {
    const channel = cam.channelNumber as number;
    const enabled = wanted.has(channel);
    if (enabled === cam.enabled) continue;
    await prisma.camera.update({ where: { id: cam.id }, data: enabledCameraFields(enabled, true) });
    if (!enabled) await closeOfflineAlerts(cam.id);
    changed.push({ channel, enabled });
  }
  return { deviceId, changed, enabledChannels: [...wanted].sort((a, b) => a - b) };
}

export async function updateDevice(id: string, input: UpdateDeviceInput) {
  await assertDeviceTypeExists(input.deviceType);
  const prisma = getPrisma();

  const existing = await prisma.device.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Device', id);

  if (input.name !== undefined && input.name !== existing.name) await assertDeviceNameFree(input.name, id);
  if (input.ipAddress !== undefined || input.rtspPort !== undefined) {
    await assertDeviceAddressFree(input.ipAddress ?? existing.ipAddress, input.rtspPort ?? existing.rtspPort, id);
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.deviceType !== undefined) data.deviceType = input.deviceType;
  if (input.brand !== undefined) data.brand = input.brand;
  if (input.model !== undefined) data.model = input.model;
  if (input.serialNumber !== undefined) data.serialNumber = input.serialNumber;
  if (input.macAddress !== undefined) data.macAddress = input.macAddress || null;
  if (input.firmwareVersion !== undefined) data.firmwareVersion = input.firmwareVersion || null;
  if (input.shortCode !== undefined) data.shortCode = input.shortCode || null;
  if (input.alertLevel !== undefined) data.alertLevel = input.alertLevel || null;
  if (input.snapshotRefreshSeconds !== undefined) data.snapshotRefreshSeconds = input.snapshotRefreshSeconds;
  if (input.ipAddress !== undefined) data.ipAddress = input.ipAddress;
  if (input.rtspPort !== undefined) data.rtspPort = input.rtspPort;
  if (input.httpPort !== undefined) data.httpPort = input.httpPort;
  if (input.onvifPort !== undefined) data.onvifPort = input.onvifPort;
  if (input.username !== undefined) data.username = input.username;
  if (input.password !== undefined && input.password !== SECRET_MASK) data.passwordEncrypted = input.password ? encrypt(input.password) : null;
  if (input.totalChannels !== undefined) data.totalChannels = input.totalChannels;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.status !== undefined) data.status = input.status;
  if (input.siteId !== undefined || input.zoneId !== undefined) {
    const location = await resolveLocation(
      input.siteId !== undefined ? input.siteId : existing.siteId,
      // A site chosen on its own clears a zone that may belong to the old one.
      input.zoneId !== undefined ? input.zoneId : input.siteId !== undefined ? null : existing.zoneId,
    );
    data.siteId = location.siteId;
    data.zoneId = location.zoneId;
  }

  const updated = await prisma.device.update({
    where: { id },
    data,
    include: { site: true },
  });

  await followDeviceChanges(existing, updated);

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
export async function provisionDeviceChannels(deviceId: string, opts: { enabledChannels?: number[] } = {}) {
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

      // Names stay unique even against a camera in the trash or one added by hand under this name.
      const wantedName = channelCameraName(device.name, ch);
      const nameTaken = await prisma.camera.findFirst({ where: { name: wantedName }, select: { id: true } });
      const inUse = !opts.enabledChannels || opts.enabledChannels.includes(ch);
      const cam = await prisma.camera.create({
        data: {
          name: nameTaken ? `${wantedName} (${device.id.slice(0, 4)})` : wantedName,
          enabled: inUse,
          deviceId: device.id,
          channelNumber: ch,
          ipAddress: device.ipAddress,
          rtspUrl: sealRtspUrl(rtspUrl),
          rtspUrlSub: sealRtspUrl(rtspUrlSub),
          streamPath,
          siteId: device.siteId,
          zoneId: device.zoneId,
          status: inUse ? 'active' : 'inactive', // the health monitor decides online or offline from the device itself
          operationalStatus: 'unknown',
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

/** Brands added in master data, with their own stream patterns. Kept in memory because URLs are built synchronously. */
let customTemplates: DeviceVendorTemplate[] = [];
export function setCustomDeviceTemplates(templates: DeviceVendorTemplate[]) {
  customTemplates = templates;
}

export function getDeviceTemplates(): DeviceVendorTemplate[] {
  const custom = new Set(customTemplates.map((t) => t.brand.toLowerCase()));
  return [...customTemplates, ...builtInDeviceTemplates().filter((t) => !custom.has(t.brand.toLowerCase()))];
}

export function builtInDeviceTemplates(): DeviceVendorTemplate[] {
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
    // What the device form shows: both ports with their own timing, and one verdict.
    overallStatus: rtspResult.open && httpResult.open ? 'online' : reachable ? 'degraded' : 'offline',
    reachability: {
      rtsp: { reachable: rtspResult.open, latencyMs: rtspResult.latencyMs },
      http: { reachable: httpResult.open, latencyMs: httpResult.latencyMs },
    },
    message: reachable
      ? `Device reachable (${latencyMs}ms)${rtspResult.open ? ', RTSP active' : ''}`
      : `Cannot connect to ${ip}:${rtspPort} or ${ip}:${httpPort}`,
  };
}

/**
 * What the device says about itself, for the form. A stored password is only ever sent to the address it was
 * saved for, so typing another address into the form cannot send it elsewhere.
 */
export async function readDeviceInfoForForm(input: { deviceId?: string; ipAddress: string; httpPort?: number; username?: string; password?: string }) {
  let username = input.username ?? '';
  let password = input.password ?? '';
  if (!password && input.deviceId) {
    const saved = await getPrisma().device.findUnique({ where: { id: input.deviceId }, select: { ipAddress: true, username: true, passwordEncrypted: true } });
    if (saved?.passwordEncrypted && saved.ipAddress === input.ipAddress) {
      username = input.username || saved.username || '';
      password = decrypt(saved.passwordEncrypted);
    }
  }
  if (!password) return { status: 'no_login' as const };
  try {
    const login = { host: input.ipAddress, httpPort: input.httpPort ?? 80, rtspPort: 554, username, password };
    await checkLogin(login);
    const info = await readDeviceInfo(login);
    return info ? { status: 'ok' as const, brand: 'Hikvision', ...info } : { status: 'not_supported' as const };
  } catch (err) {
    if (err instanceof RecorderError && err.kind === 'login') {
      // A locked account refuses even the right password; say so, and for how long, so nobody keeps trying.
      return err.unlockSeconds === null
        ? { status: 'login_failed' as const }
        : { status: 'login_locked' as const, unlockMinutes: Math.max(1, Math.ceil(err.unlockSeconds / 60)) };
    }
    return { status: 'not_supported' as const };
  }
}

export async function bulkImportDevices(devicesInput: CreateDeviceInput[]) {
  const results = [];
  const failed: Array<{ name: string; message: string }> = [];
  let totalCamerasCreated = 0;

  for (const input of devicesInput) {
    try {
      const dev = await createDevice(input);
      results.push(dev);
      if (input.autoCreateCameras) totalCamerasCreated += input.totalChannels;
    } catch (err) {
      failed.push({ name: input.name, message: err instanceof Error ? err.message : 'Failed' });
    }
  }

  return {
    importedCount: results.length,
    devices: results,
    totalCamerasCreated,
    failed,
  };
}

export async function getDashboardSummary(scope?: Prisma.CameraWhereInput) {
  const prisma = getPrisma();
  const inScope = scope ? { AND: [scope] } : {};
  // Only what is within reach: the devices and sites holding those cameras, counted by those cameras.
  const reachableIds = scope ? (await prisma.camera.findMany({ where: { ...inScope, deletedAt: null }, select: { deviceId: true, siteId: true } })) : null;

  const [devices, cameras, sites, recentIncidents] = await Promise.all([
    prisma.device.findMany({
      where: reachableIds ? { id: { in: reachableIds.flatMap((c) => (c.deviceId ? [c.deviceId] : [])) } } : {},
      include: {
        _count: { select: { cameras: scope ? { where: { ...inScope, deletedAt: null } } : true } },
      },
    }),
    prisma.camera.findMany({
      where: { enabled: true, deletedAt: null, ...inScope },
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
      where: reachableIds ? { id: { in: reachableIds.flatMap((c) => (c.siteId ? [c.siteId] : [])) } } : {},
      include: {
        _count: { select: { devices: true, cameras: scope ? { where: { ...inScope, deletedAt: null } } : true } },
      },
    }),
    prisma.cameraIncident.findMany({
      where: { status: 'open', ...(scope ? { camera: scope } : {}) },
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
    const stats = siteMap.get(s.id) || { total: 0, online: 0, offline: 0 };
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


