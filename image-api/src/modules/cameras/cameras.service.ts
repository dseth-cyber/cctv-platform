import { getPrisma } from '../../lib/prisma.js';
import { randomBytes } from 'node:crypto';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import { SECRET_MASK, sealRtspUrl, isMaskedRtspUrl, redactRtspUrl, extractRtspPassword } from '../../lib/rtsp-credentials.js';
import { resolveLocation } from '../sites/sites.service.js';
import { closeOfflineAlerts, enabledCameraFields } from './camera-enabled.js';
import { cameraDeletionImpact, removeRecordingFiles } from './camera-deletion.js';
import { buildChannelRtspUrl, findDeviceTemplate } from '../devices/devices.service.js';
import type { CreateCameraInput, UpdateCameraInput } from './cameras.schema.js';
import type { Prisma } from '@prisma/client';

export async function listCameras(filters?: { status?: string; enabled?: boolean; deviceId?: string; siteId?: string; zoneId?: string }) {
  const prisma = getPrisma();

  const where: Record<string, unknown> = { deletedAt: null };
  if (filters?.status) where.status = filters.status;
  if (filters?.enabled !== undefined) where.enabled = filters.enabled;
  if (filters?.deviceId) where.deviceId = filters.deviceId;
  if (filters?.siteId) where.siteId = filters.siteId;
  if (filters?.zoneId) where.zoneId = filters.zoneId;

  const cameras = await prisma.camera.findMany({
    where,
    include: {
      retentionPolicy: { select: { id: true, name: true } },
      template: true,
      device: { select: { id: true, name: true, shortCode: true, deviceType: true, brand: true, ipAddress: true, totalChannels: true, site: { select: { id: true, name: true } }, zone: { select: { id: true, name: true } } } },
      site: { select: { id: true, name: true, code: true } },
      zone: { select: { id: true, name: true, code: true } },
      groupMemberships: { select: { group: { select: { id: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  const cameraIds = cameras.map(c => c.id);

  const [allIncidents] = await Promise.all([
    cameraIds.length > 0
      ? (prisma as any).cameraIncident.findMany({
          where: { cameraId: { in: cameraIds } },
          select: {
            cameraId: true,
            assignedTo: true,
            reason: true,
            openedAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const statsMap = new Map<string, {
    incidentCount: number;
    technicians: Map<string, number>;
    reasons: Map<string, number>;
    hours: Map<number, number>;
  }>();

  for (const inc of allIncidents) {
    const cid = inc.cameraId;
    let s = statsMap.get(cid);
    if (!s) {
      s = {
        incidentCount: 0,
        technicians: new Map<string, number>(),
        reasons: new Map<string, number>(),
        hours: new Map<number, number>(),
      };
      statsMap.set(cid, s);
    }
    s.incidentCount += 1;
    if (inc.assignedTo) {
      s.technicians.set(inc.assignedTo, (s.technicians.get(inc.assignedTo) ?? 0) + 1);
    }
    if (inc.reason) {
      s.reasons.set(inc.reason, (s.reasons.get(inc.reason) ?? 0) + 1);
    }
    if (inc.openedAt) {
      const hr = new Date(inc.openedAt).getHours();
      s.hours.set(hr, (s.hours.get(hr) ?? 0) + 1);
    }
  }

  const getMaxKey = (m: Map<string, number>): string => {
    let maxK = '—';
    let maxV = -1;
    for (const [k, v] of m.entries()) {
      if (v > maxV) {
        maxV = v;
        maxK = k;
      }
    }
    return maxK;
  };

  const getPeakHourStr = (m: Map<number, number>): string => {
    let maxH = -1;
    let maxV = -1;
    for (const [k, v] of m.entries()) {
      if (v > maxV) {
        maxV = v;
        maxH = k;
      }
    }
    if (maxH === -1) return '—';
    const start = String(maxH).padStart(2, '0') + ':00';
    const end = String((maxH + 1) % 24).padStart(2, '0') + ':00';
    return `${start} - ${end}`;
  };

  return cameras.map((c) => {
    const cameraAgeDays = Math.max(1, Math.ceil((Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60 * 24)));
    const stats = statsMap.get(c.id);
    return {
      ...c,
      cameraAgeDays,
      incidentCount: stats?.incidentCount ?? 0,
      topTechnician: stats ? getMaxKey(stats.technicians) : '—',
      topReason: stats ? getMaxKey(stats.reasons) : '—',
      peakHour: stats ? getPeakHourStr(stats.hours) : '—',
    };
  });
}

export async function getCameraEvents(cameraId: string, params: { since?: string; until?: string; limit?: number }) {
  const prisma = getPrisma();
  const where: any = { cameraId };
  if (params.since || params.until) {
    where.createdAt = {};
    if (params.since) where.createdAt.gte = new Date(params.since);
    if (params.until) where.createdAt.lte = new Date(params.until);
  }
  return prisma.cameraEvent.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: params.limit ?? 100,
  });
}

export async function getCameraById(id: string) {
  const prisma = getPrisma();

  const camera = await prisma.camera.findUnique({
    where: { id },
    include: {
      retentionPolicy: true,
      template: true,
      device: true,
      site: true,
      zone: true,
      mediaNode: true,
    },
  });

  if (!camera) {
    throw new (await import('../../lib/errors.js')).NotFoundError('Camera', id);
  }

  const incidents = await (prisma as any).cameraIncident.findMany({
    where: { cameraId: id },
    select: { assignedTo: true, reason: true, openedAt: true }
  });

  const technicians = new Map<string, number>();
  const reasons = new Map<string, number>();
  const hours = new Map<number, number>();

  for (const inc of incidents) {
    if (inc.assignedTo) {
      technicians.set(inc.assignedTo, (technicians.get(inc.assignedTo) ?? 0) + 1);
    }
    if (inc.reason) {
      reasons.set(inc.reason, (reasons.get(inc.reason) ?? 0) + 1);
    }
    if (inc.openedAt) {
      const hr = new Date(inc.openedAt).getHours();
      hours.set(hr, (hours.get(hr) ?? 0) + 1);
    }
  }

  const getMaxKey = (m: Map<string, number>): string => {
    let maxK = '—';
    let maxV = -1;
    for (const [k, v] of m.entries()) {
      if (v > maxV) {
        maxV = v;
        maxK = k;
      }
    }
    return maxK;
  };

  const getPeakHourStr = (m: Map<number, number>): string => {
    let maxH = -1;
    let maxV = -1;
    for (const [k, v] of m.entries()) {
      if (v > maxV) {
        maxV = v;
        maxH = k;
      }
    }
    if (maxH === -1) return '—';
    const start = String(maxH).padStart(2, '0') + ':00';
    const end = String((maxH + 1) % 24).padStart(2, '0') + ':00';
    return `${start} - ${end}`;
  };

  const cameraAgeDays = Math.max(1, Math.ceil((Date.now() - new Date(camera.createdAt).getTime()) / (1000 * 60 * 60 * 24)));

  return {
    ...camera,
    cameraAgeDays,
    incidentCount: incidents.length,
    topTechnician: getMaxKey(technicians),
    topReason: getMaxKey(reasons),
    peakHour: getPeakHourStr(hours),
  };
}

type CameraConnection = NonNullable<CreateCameraInput['connection']>;

/**
 * RTSP URLs built from the simple setup fields. The password is never stored in metadata — only in
 * the sealed URLs; a blank password reuses the one in `currentRtspUrl` (editing without retyping it).
 */
function urlsFromConnection(conn: CameraConnection, ip: string | null | undefined, currentRtspUrl?: string | null) {
  if (!ip) throw new ValidationError('ipAddress is required to build the RTSP URL');
  const password = conn.password ? conn.password : extractRtspPassword(currentRtspUrl);
  const brand = findDeviceTemplate(conn.brand).brand;
  const build = (sub: 'main' | 'sub') => buildChannelRtspUrl(brand, ip, conn.port, conn.channel, conn.username || null, password, sub);
  return {
    rtspUrl: build('main'),
    rtspUrlSub: build('sub'),
    connectionMeta: { brand, port: conn.port, channel: conn.channel, username: conn.username },
  };
}

/** A unique MediaMTX path such as `cam/gate-1`, derived from the camera name. */
async function generateStreamPath(name: string): Promise<string> {
  const prisma = getPrisma();
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const base = `cam/${slug || randomBytes(3).toString('hex')}`;
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await prisma.camera.findFirst({ where: { streamPath: candidate }, select: { id: true } }))) return candidate;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

/**
 * Camera names are unique across active and trashed cameras, so a restore never produces two
 * cameras with the same name and the trash never holds two look-alikes. The error says which.
 */
async function assertCameraNameFree(name: string, exceptId?: string) {
  const prisma = getPrisma();
  const taken = await prisma.camera.findFirst({
    where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { deletedAt: true },
  });
  if (!taken) return;
  if (taken.deletedAt) {
    throw new ConflictError(`Camera name '${name}' is used by a camera in the trash`, { code: 'CAMERA_NAME_IN_TRASH' });
  }
  throw new ConflictError(`Camera with name '${name}' already exists`, { code: 'CAMERA_NAME_TAKEN' });
}

export async function createCamera(input: CreateCameraInput & { createdBy?: string }) {
  const prisma = getPrisma();

  if (input.retentionPolicyId) {
    const policy = await prisma.retentionPolicy.findUnique({ where: { id: input.retentionPolicyId } });
    if (!policy) {
      throw new NotFoundError('RetentionPolicy', input.retentionPolicyId);
    }
  }

  await assertCameraNameFree(input.name);

  const parent = input.deviceId ? await prisma.device.findUnique({ where: { id: input.deviceId }, select: { siteId: true, zoneId: true } }) : null;
  const ownLocation = input.locationFromDevice === false || !parent;
  const location = ownLocation ? await resolveLocation(input.siteId, input.zoneId) : { siteId: parent!.siteId, zoneId: parent!.zoneId };

  let streamPath = input.streamPath ?? null;
  if (!streamPath && input.deviceId && input.channelNumber) {
    streamPath = `device_${input.deviceId.substring(0, 8)}_ch${input.channelNumber}`;
  }
  // Without a path the camera is never registered in MediaMTX (no live view, no recording).
  if (!streamPath) streamPath = await generateStreamPath(input.name);

  let rtspUrl = input.rtspUrl;
  let rtspUrlSub = input.rtspUrlSub;
  let metadata = input.metadata as Record<string, unknown>;
  if (input.connection) {
    const built = urlsFromConnection(input.connection, input.ipAddress);
    rtspUrl = built.rtspUrl;
    rtspUrlSub = built.rtspUrlSub;
    metadata = { ...metadata, connection: built.connectionMeta };
  }

  const camera = await prisma.camera.create({
    data: {
      name: input.name,
      description: input.description,
      ipAddress: input.ipAddress ?? null,
      timezone: input.timezone,
      retentionPolicyId: input.retentionPolicyId ?? null,
      templateId: input.templateId ?? null,
      metadata: metadata as object,
      slaTargetPercent: input.slaTargetPercent ?? null,
      createdBy: input.createdBy ?? null,
      status: rtspUrl ? 'active' : 'inactive', // a live source is watched from the start; the health monitor decides online or offline
      deviceId: input.deviceId ?? null,
      channelNumber: input.channelNumber ?? null,
      rtspUrl: sealRtspUrl(rtspUrl) ?? null,
      rtspUrlSub: sealRtspUrl(rtspUrlSub) ?? null,
      streamProfile: input.streamProfile ?? undefined,
      mediaNodeId: input.mediaNodeId ?? null,
      streamPath,
      siteId: location.siteId,
      zoneId: location.zoneId,
      locationFromDevice: !ownLocation,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      onvifProfileToken: input.onvifProfileToken ?? null,
      recordingMode: input.recordingMode ?? 'live_only',
      cameraType: input.cameraType || null,
      cameraBrand: input.cameraBrand || null,
      cameraModel: input.cameraModel || null,
      shortCode: input.shortCode || null,
    },
    include: {
      retentionPolicy: true,
      template: true,
      device: true,
      site: true,
      zone: true,
    },
  });

  return camera;
}

export async function updateCamera(id: string, input: UpdateCameraInput) {
  const prisma = getPrisma();

  const existing = await prisma.camera.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError('Camera', id);
  }

  if (input.name !== undefined && input.name !== existing.name) {
    await assertCameraNameFree(input.name, id);
  }

  if (input.retentionPolicyId) {
    const policy = await prisma.retentionPolicy.findUnique({ where: { id: input.retentionPolicyId } });
    if (!policy) {
      throw new NotFoundError('RetentionPolicy', input.retentionPolicyId);
    }
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description;
  if (input.ipAddress !== undefined) data.ipAddress = input.ipAddress;
  if (input.timezone !== undefined) data.timezone = input.timezone;
  if (input.retentionPolicyId !== undefined) data.retentionPolicyId = input.retentionPolicyId;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  if (input.status !== undefined) data.status = input.status;
  if (input.lastPolledAt !== undefined) data.lastPolledAt = new Date(input.lastPolledAt);
  if (input.metadata !== undefined) data.metadata = input.metadata as object;
  if (input.templateId !== undefined) data.templateId = input.templateId;
  if (input.slaTargetPercent !== undefined) data.slaTargetPercent = input.slaTargetPercent;
  // CCTV & Streaming fields
  if (input.deviceId !== undefined) data.deviceId = input.deviceId;
  if (input.channelNumber !== undefined) data.channelNumber = input.channelNumber;
  // A redacted URL echoed back by an edit form means "unchanged".
  if (input.rtspUrl !== undefined && !isMaskedRtspUrl(input.rtspUrl)) data.rtspUrl = sealRtspUrl(input.rtspUrl);
  if (input.rtspUrlSub !== undefined && !isMaskedRtspUrl(input.rtspUrlSub)) data.rtspUrlSub = sealRtspUrl(input.rtspUrlSub);
  if (input.streamProfile !== undefined) data.streamProfile = input.streamProfile;
  if (input.mediaNodeId !== undefined) data.mediaNodeId = input.mediaNodeId;
  if (input.streamPath !== undefined) data.streamPath = input.streamPath;
  if (input.streamState !== undefined) data.streamState = input.streamState;
  if (input.locationFromDevice === true && existing.deviceId) {
    const parent = await prisma.device.findUnique({ where: { id: existing.deviceId }, select: { siteId: true, zoneId: true } });
    data.locationFromDevice = true;
    data.siteId = parent?.siteId ?? null;
    data.zoneId = parent?.zoneId ?? null;
  } else if (input.siteId !== undefined || input.zoneId !== undefined) {
    const location = await resolveLocation(
      input.siteId !== undefined ? input.siteId : existing.siteId,
      input.zoneId !== undefined ? input.zoneId : input.siteId !== undefined ? null : existing.zoneId,
    );
    data.siteId = location.siteId;
    data.zoneId = location.zoneId;
    // Setting a place by hand is what stops a camera following its device.
    if (existing.deviceId && (location.siteId !== existing.siteId || location.zoneId !== existing.zoneId || input.locationFromDevice === false)) data.locationFromDevice = false;
  } else if (input.locationFromDevice === false) {
    data.locationFromDevice = false;
  }
  if (input.latitude !== undefined) data.latitude = input.latitude;
  if (input.longitude !== undefined) data.longitude = input.longitude;
  if (input.onvifProfileToken !== undefined) data.onvifProfileToken = input.onvifProfileToken;
  if (input.recordingMode !== undefined) data.recordingMode = input.recordingMode;
  if (input.cameraType !== undefined) data.cameraType = input.cameraType || null;
  if (input.cameraBrand !== undefined) data.cameraBrand = input.cameraBrand || null;
  if (input.cameraModel !== undefined) data.cameraModel = input.cameraModel || null;
  if (input.shortCode !== undefined) data.shortCode = input.shortCode || null;
  if (input.connection) {
    const ip = input.ipAddress !== undefined ? input.ipAddress : existing.ipAddress;
    const built = urlsFromConnection(input.connection, ip, existing.rtspUrl);
    data.rtspUrl = sealRtspUrl(built.rtspUrl);
    data.rtspUrlSub = sealRtspUrl(built.rtspUrlSub);
    const base = (input.metadata ?? existing.metadata ?? {}) as Record<string, unknown>;
    data.metadata = { ...base, connection: built.connectionMeta };
  }

  const switching = input.enabled !== undefined && input.enabled !== existing.enabled;
  if (switching) Object.assign(data, enabledCameraFields(input.enabled as boolean, !!existing.rtspUrl));

  const updated = await prisma.camera.update({
    where: { id },
    data,
    include: {
      retentionPolicy: true,
      template: true,
      device: true,
      site: true,
      zone: true,
    },
  });
  if (switching && input.enabled === false) await closeOfflineAlerts(id);

  if (input.status !== undefined && input.status !== existing.status) {
    const eventType = input.status === 'active' ? 'online' as const
      : input.status === 'maintenance' ? 'maintenance_start' as const
      : 'offline' as const;

    await prisma.cameraEvent.create({
      data: {
        cameraId: id,
        eventType,
        message: `Camera "${existing.name}" status changed: ${existing.status} → ${input.status}`,
        metadata: { previousStatus: existing.status, newStatus: input.status, changedBy: (input as any)._changedBy ?? 'system' },
      },
    });
  }

  return updated;
}

export async function deactivateCamera(id: string) {
  const prisma = getPrisma();

  const existing = await prisma.camera.findUnique({ where: { id } });
  if (!existing) {
    throw new NotFoundError('Camera', id);
  }

  await prisma.camera.update({
    where: { id },
    data: { enabled: false, status: 'inactive' },
  });
}

export async function deleteCamera(id: string) {
  const prisma = getPrisma();
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) throw new NotFoundError('Camera', id);

  // Soft delete — set enabled=false, status=inactive, mark deletedAt
  await prisma.camera.update({
    where: { id },
    data: { enabled: false, status: 'inactive', deletedAt: new Date() },
  });
  return camera;
}

export async function restoreCamera(id: string) {
  const prisma = getPrisma();
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) throw new NotFoundError('Camera', id);
  const clash = await prisma.camera.findFirst({ where: { name: camera.name, deletedAt: null, id: { not: id } } });
  if (clash) {
    throw new ConflictError(`Camera with name '${camera.name}' already exists`, { code: 'CAMERA_NAME_TAKEN' });
  }

  await prisma.camera.update({
    where: { id },
    data: { enabled: true, status: 'inactive', deletedAt: null },
  });
  return { restored: true };
}

export async function listDeletedCameras() {
  const prisma = getPrisma();
  return prisma.camera.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    select: { id: true, name: true, ipAddress: true, status: true, deletedAt: true },
  });
}

// Deletes everything that references these cameras except images (images belong to
// the system and outlive the camera — Image.cameraId is nullable and gets SET NULL
// automatically when the camera row is deleted).
async function purgeCameraDependents(
  prisma: Prisma.TransactionClient,
  ids: string[],
) {
  await prisma.cameraIncident.deleteMany({ where: { cameraId: { in: ids } } });
  await prisma.cameraDailySummary.deleteMany({ where: { cameraId: { in: ids } } });
  await prisma.cameraEvent.deleteMany({ where: { cameraId: { in: ids } } });
}

/**
 * Deleting a camera takes its clips and recordings with it, files included. Legal Hold wins: a camera holding
 * anything under it cannot be deleted until the hold is released.
 */
export async function permanentlyDeleteCamera(id: string) {
  const prisma = getPrisma();
  const camera = await prisma.camera.findUnique({ where: { id } });
  if (!camera) throw new NotFoundError('Camera', id);

  const impact = await cameraDeletionImpact([id]);
  if (impact.legalHold > 0) {
    throw new ConflictError(`${impact.legalHold} clips or recordings of this camera are under Legal Hold`, { code: 'CAMERA_LEGAL_HOLD', legalHold: impact.legalHold });
  }

  await prisma.$transaction(async tx => {
    await purgeCameraDependents(tx, [id]);
    await tx.camera.delete({ where: { id } });
  });
  const files = await removeRecordingFiles(impact.files);
  return { deleted: true, impact, files };
}

/** Everything in the trash except what Legal Hold protects, which stays there and is reported. */
export async function emptyCameraTrash() {
  const prisma = getPrisma();
  const inTrash = await prisma.camera.findMany({
    where: { deletedAt: { not: null } },
    select: { id: true },
  });
  const all = inTrash.map(d => d.id);
  if (all.length === 0) return { deleted: 0, keptForLegalHold: 0 };

  const { heldCameraIds } = await cameraDeletionImpact(all);
  const ids = all.filter((id) => !heldCameraIds.includes(id));
  const impact = await cameraDeletionImpact(ids);

  const result = await prisma.$transaction(async tx => {
    await purgeCameraDependents(tx, ids);
    return tx.camera.deleteMany({ where: { id: { in: ids } } });
  });
  const files = await removeRecordingFiles(impact.files);
  return { deleted: result.count, keptForLegalHold: heldCameraIds.length, impact, files };
}

/**
 * Shape a camera for an API response: RTSP credentials are always redacted, the
 * device password is masked, and the decrypted SMB password is only kept for the
 * factory sync worker's service key (role 'system'), which needs it to mount shares.
 */
export function toPublicCamera<T extends Record<string, any>>(camera: T, viewerRole?: string): T {
  if (!camera) return camera;
  const out: Record<string, any> = {
    ...camera,
    rtspUrl: redactRtspUrl(camera.rtspUrl),
    rtspUrlSub: redactRtspUrl(camera.rtspUrlSub),
  };
  if (Array.isArray(camera.groupMemberships)) {
    out.groups = camera.groupMemberships.map((m: any) => m.group);
    delete out.groupMemberships;
  }
  if (viewerRole !== 'system' && 'smbPasswordEncrypted' in camera) {
    out.smbPasswordEncrypted = camera.smbPasswordEncrypted ? SECRET_MASK : null;
  }
  if (camera.device && typeof camera.device === 'object' && 'passwordEncrypted' in camera.device) {
    out.device = { ...camera.device, passwordEncrypted: camera.device.passwordEncrypted ? SECRET_MASK : null };
  }
  return out as T;
}
