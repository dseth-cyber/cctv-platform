import { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { getPrisma } from '../../lib/prisma.js';

/**
 * Which cameras a person may see. It is enforced here on the server, on every way to a camera: hiding something in
 * the page would stop nobody who calls the API. Anything out of reach answers "not found", so a person cannot use the
 * answers to learn what exists.
 */
export const cameraScopeSchema = z.object({
  all: z.boolean().optional(),
  siteIds: z.array(z.guid()).max(1000).optional(),
  zoneIds: z.array(z.guid()).max(1000).optional(),
  deviceIds: z.array(z.guid()).max(1000).optional(),
  groupIds: z.array(z.guid()).max(1000).optional(),
});
export type ScopeRules = z.infer<typeof cameraScopeSchema>;

export type CameraScope = { all: true } | { all: false; where: Prisma.CameraWhereInput };

const NOTHING: Prisma.CameraWhereInput = { id: { in: [] } };

/** A person sees what their role and their own rules allow together. With no rules at all, nothing. */
export function mergeCameraScope(rules: Array<ScopeRules | null | undefined>): CameraScope {
  const present = rules.filter((r): r is ScopeRules => !!r);
  if (present.some((r) => r.all === true)) return { all: true };
  const ids = (key: 'siteIds' | 'zoneIds' | 'deviceIds' | 'groupIds') => [...new Set(present.flatMap((r) => r[key] ?? []))];
  const [siteIds, zoneIds, deviceIds, groupIds] = [ids('siteIds'), ids('zoneIds'), ids('deviceIds'), ids('groupIds')];
  const any: Prisma.CameraWhereInput[] = [
    ...(siteIds.length ? [{ siteId: { in: siteIds } }] : []),
    ...(zoneIds.length ? [{ zoneId: { in: zoneIds } }] : []),
    ...(deviceIds.length ? [{ deviceId: { in: deviceIds } }] : []),
    ...(groupIds.length ? [{ groupMemberships: { some: { groupId: { in: groupIds } } } }] : []),
  ];
  return { all: false, where: any.length > 0 ? { OR: any } : NOTHING };
}

const scopeMemo = new WeakMap<object, Promise<CameraScope>>();
const idsMemo = new WeakMap<object, Promise<string[] | null>>();

async function readScope(request: FastifyRequest): Promise<CameraScope> {
  const user = (request as any).user as { id?: string; role?: string } | undefined;
  if (user?.role === 'admin' || user?.role === 'system') return { all: true };
  if (!user?.id) return { all: false, where: NOTHING };
  const prisma = getPrisma();
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { role: true, cameraScope: true } });
  if (!row) return { all: false, where: NOTHING };
  if (row.role === 'admin' || row.role === 'system') return { all: true };
  const role = await prisma.customRole.findUnique({ where: { code: row.role }, select: { cameraScope: true } });
  return mergeCameraScope([role?.cameraScope as ScopeRules | null, row.cameraScope as ScopeRules | null]);
}

/** Read once per request, however many checks that request makes. */
export function getCameraScope(request: FastifyRequest): Promise<CameraScope> {
  let scope = scopeMemo.get(request);
  if (!scope) {
    scope = readScope(request);
    scopeMemo.set(request, scope);
  }
  return scope;
}

/** A filter to add to a camera query. Undefined when the person may see everything. */
export async function cameraWhere(request: FastifyRequest): Promise<Prisma.CameraWhereInput | undefined> {
  const scope = await getCameraScope(request);
  return scope.all ? undefined : scope.where;
}

/** The ids within reach, deleted ones included so their history stays reachable. Null means everything. */
export function allowedCameraIds(request: FastifyRequest): Promise<string[] | null> {
  let ids = idsMemo.get(request);
  if (!ids) {
    ids = cameraWhere(request).then(async (where) =>
      where ? (await getPrisma().camera.findMany({ where, select: { id: true } })).map((c) => c.id) : null);
    idsMemo.set(request, ids);
  }
  return ids;
}

export async function assertCameraAccess(request: FastifyRequest, cameraId: string | null | undefined) {
  const allowed = await allowedCameraIds(request);
  if (allowed === null) return;
  if (!cameraId || !allowed.includes(cameraId)) throw new NotFoundError('Camera', cameraId ?? '');
}

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export const guardCameraParam = (name = 'id'): Guard => async (request) => {
  await assertCameraAccess(request, (request.params as Record<string, string>)[name]);
};

/** A camera named in the query. A request that names none is refused unless the person may see everything. */
export const guardCameraQuery = (name = 'cameraId'): Guard => async (request) => {
  await assertCameraAccess(request, (request.query as Record<string, string | undefined>)?.[name]);
};

export const guardCameraBody = (name = 'cameraId'): Guard => async (request) => {
  await assertCameraAccess(request, (request.body as Record<string, string | undefined> | undefined)?.[name]);
};

/** Every camera in a list in the body has to be within reach. */
export const guardCameraIdsBody = (name = 'ids'): Guard => async (request) => {
  const ids = (request.body as Record<string, unknown> | undefined)?.[name];
  if (!Array.isArray(ids)) return;
  for (const id of ids) await assertCameraAccess(request, String(id));
};

async function incidentCamera(id: string) {
  const row = await getPrisma().cameraIncident.findUnique({ where: { id }, select: { cameraId: true } });
  if (!row) throw new NotFoundError('Incident', id);
  return row.cameraId;
}

export const guardIncidentParam = (name = 'id'): Guard => async (request) => {
  if ((await allowedCameraIds(request)) === null) return;
  const id = (request.params as Record<string, string>)[name];
  try {
    await assertCameraAccess(request, await incidentCamera(id));
  } catch {
    throw new NotFoundError('Incident', id);
  }
};

/** An incident's picture is named after the incident: <incident id>-<random>. */
export const guardIncidentAttachment: Guard = async (request) => {
  if ((await allowedCameraIds(request)) === null) return;
  const { filename } = request.params as { filename: string };
  const incidentId = filename.slice(0, 36);
  try {
    await assertCameraAccess(request, await incidentCamera(incidentId));
  } catch {
    throw new NotFoundError('Attachment', filename);
  }
};

export const guardClipParam = (name = 'id'): Guard => async (request) => {
  if ((await allowedCameraIds(request)) === null) return;
  const id = (request.params as Record<string, string>)[name];
  const clip = await getPrisma().recordingClip.findUnique({ where: { id }, select: { cameraId: true } });
  if (!clip) throw new NotFoundError('Clip', id);
  await assertCameraAccess(request, clip.cameraId).catch(() => { throw new NotFoundError('Clip', id); });
};

export const guardClipFilename: Guard = async (request) => {
  if ((await allowedCameraIds(request)) === null) return;
  const { filename } = request.params as { filename: string };
  const clip = await getPrisma().recordingClip.findFirst({ where: { filePath: `/recordings/clips/${filename}` }, select: { cameraId: true } });
  await assertCameraAccess(request, clip?.cameraId).catch(() => { throw new NotFoundError('Clip', filename); });
};

export const guardSegmentParam = (name = 'id'): Guard => async (request) => {
  if ((await allowedCameraIds(request)) === null) return;
  const id = (request.params as Record<string, string>)[name];
  const segment = await getPrisma().cameraRecording.findUnique({ where: { id }, select: { cameraId: true } });
  await assertCameraAccess(request, segment?.cameraId).catch(() => { throw new NotFoundError('Recording', id); });
};

/** A device is visible when at least one of its cameras is. */
export const guardDeviceVisible = (name = 'id'): Guard => async (request) => {
  const where = await cameraWhere(request);
  if (!where) return;
  const id = (request.params as Record<string, string>)[name];
  const found = await getPrisma().camera.count({ where: { AND: [where], deviceId: id } });
  if (found === 0) throw new NotFoundError('Device', id);
};

/**
 * Things that reach beyond one camera, such as adding a device or emptying the trash, take someone who can see
 * everything. Otherwise a person could act on what they cannot see, or make something they then cannot see.
 */
export const guardAllCameras: Guard = async (request) => {
  const scope = await getCameraScope(request);
  if (!scope.all) throw new ForbiddenError('This needs access to all cameras');
};

/** What an alert can name in `source`, within reach: cameras, their devices, and their incidents. Null means everything. */
export async function allowedAlertSources(request: FastifyRequest): Promise<string[] | null> {
  const where = await cameraWhere(request);
  if (!where) return null;
  const prisma = getPrisma();
  const cameras = await prisma.camera.findMany({ where, select: { id: true, deviceId: true } });
  const ids = cameras.map((c) => c.id);
  const incidents = await prisma.cameraIncident.findMany({ where: { cameraId: { in: ids } }, select: { id: true } });
  return [...new Set([...ids, ...cameras.flatMap((c) => (c.deviceId ? [c.deviceId] : [])), ...incidents.map((i) => i.id)])];
}

export const guardAlertParam = (name = 'id'): Guard => async (request) => {
  const sources = await allowedAlertSources(request);
  if (sources === null) return;
  const id = (request.params as Record<string, string>)[name];
  const alert = await getPrisma().alert.findUnique({ where: { id }, select: { source: true } });
  if (!alert?.source || !sources.includes(alert.source)) throw new NotFoundError('Alert', id);
};

export const guardWorkOrderParam = (name = 'id'): Guard => async (request) => {
  if ((await allowedCameraIds(request)) === null) return;
  const id = (request.params as Record<string, string>)[name];
  const order = await getPrisma().workOrder.findUnique({ where: { id }, select: { incident: { select: { cameraId: true } } } });
  await assertCameraAccess(request, order?.incident.cameraId).catch(() => { throw new NotFoundError('Work order', id); });
};

/** Scopes reached people with this release: everyone there already keeps what they could see. Runs once, ever. */
export async function ensureCameraScopeDefaults() {
  const prisma = getPrisma();
  const FLAG = 'camera_scope_ready';
  if (await prisma.systemConfig.findUnique({ where: { key: FLAG } })) return;
  const { count } = await prisma.user.updateMany({ where: { cameraScope: { equals: Prisma.DbNull } }, data: { cameraScope: { all: true } } });
  await prisma.systemConfig.create({ data: { key: FLAG, value: 'true', valueType: 'boolean', category: 'internal', description: 'Existing users were given all cameras when camera scopes arrived' } });
  logger.info({ count }, 'Existing users keep all cameras');
}
