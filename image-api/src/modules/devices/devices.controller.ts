import { allowedCameraIds, cameraWhere, guardAllCameras, guardDeviceVisible } from '../access/camera-scope.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildDeviceReport, checkDeviceHealthNow } from './device-health.service.js';
import { createAuditLog } from '../audit/audit.service.js';
import { syncCameraPaths } from '../media/path-sync.js';
import { listMasterdataOptions } from '../masterdata/masterdata.service.js';
import {
  createDeviceSchema,
  updateDeviceSchema,
  deviceQuerySchema,
  probeDeviceSchema,
  readDeviceInfoSchema,
  bulkImportDeviceSchema,
  deviceChannelsSchema,
} from './devices.schema.js';
import * as devicesService from './devices.service.js';
import { requirePermission } from '../../middleware/rbac.js';

async function listDevicesHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = deviceQuerySchema.parse(request.query);
  const devices = await devicesService.listDevices(query, await cameraWhere(request));
  return reply.status(200).send(devices);
}

async function getDeviceTemplatesHandler(_request: FastifyRequest, reply: FastifyReply) {
  // What can be chosen follows master data; a brand switched off there keeps working for what already uses it.
  const active = new Set((await listMasterdataOptions('device_brand')).map((o) => o.code.toLowerCase()));
  const templates = devicesService.getDeviceTemplates().filter((t) => active.has(t.brand.toLowerCase()));
  return reply.status(200).send(templates);
}

async function getDashboardSummaryHandler(request: FastifyRequest, reply: FastifyReply) {
  const summary = await devicesService.getDashboardSummary(await cameraWhere(request));
  return reply.status(200).send(summary);
}

async function probeDeviceHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = probeDeviceSchema.parse(request.body);
  const res = await devicesService.probeDeviceConnection(input.ipAddress, input.rtspPort, input.httpPort);
  return reply.status(200).send(res);
}

async function readDeviceInfoHandler(request: FastifyRequest, reply: FastifyReply) {
  return reply.status(200).send(await devicesService.readDeviceInfoForForm(readDeviceInfoSchema.parse(request.body)));
}

async function checkHealthHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const health = await checkDeviceHealthNow(id);
  return reply.status(200).send({ health });
}

async function deviceReportHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days } = request.query as { days?: string };
  const period = Number(days);
  return reply.status(200).send(await buildDeviceReport([7, 30, 90].includes(period) ? period : 30, await cameraWhere(request)));
}

async function bulkImportHandler(request: FastifyRequest, reply: FastifyReply) {
  const { devices } = bulkImportDeviceSchema.parse(request.body);
  const res = await devicesService.bulkImportDevices(devices);
  return reply.status(201).send(res);
}

async function getDeviceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const device: any = await devicesService.getDeviceById(id);
  const allowed = await allowedCameraIds(request);
  if (allowed !== null && Array.isArray(device?.cameras)) device.cameras = device.cameras.filter((c: any) => allowed.includes(c.id));
  return reply.status(200).send(device);
}

async function createDeviceHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createDeviceSchema.parse(request.body);
  const device = await devicesService.createDevice(input);
  return reply.status(201).send(device);
}

async function updateDeviceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = updateDeviceSchema.parse(request.body);
  const device = await devicesService.updateDevice(id, input);
  return reply.status(200).send(device);
}

async function deleteDeviceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const res = await devicesService.deleteDevice(id);
  return reply.status(200).send(res);
}

async function setChannelsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { enabledChannels } = deviceChannelsSchema.parse(request.body);
  const res = await devicesService.setEnabledChannels(id, enabledChannels);
  const user = (request as any).user;
  await createAuditLog({
    userId: user?.id,
    action: 'update',
    entity: 'device',
    entityId: id,
    description: `Channels in use changed by ${user?.username ?? 'unknown'}`,
    metadata: { channels: res.changed },
    ipAddress: request.ip,
  }).catch(() => {});
  void syncCameraPaths().catch(() => {});
  return reply.status(200).send(res);
}

async function provisionChannelsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const res = await devicesService.provisionDeviceChannels(id);
  return reply.status(200).send(res);
}

export async function deviceRoutes(app: FastifyInstance) {
  app.put(
    '/:id/channels',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    setChannelsHandler,
  );
  app.get(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    listDevicesHandler,
  );
  app.get(
    '/dashboard-summary',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getDashboardSummaryHandler,
  );
  app.get(
    '/templates',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getDeviceTemplatesHandler,
  );
  app.post(
    '/probe',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    probeDeviceHandler,
  );
  // Sends a login to the device, so it takes more than being able to look at cameras.
  app.post(
    '/read-info',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    readDeviceInfoHandler,
  );
  app.get(
    '/report',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    deviceReportHandler,
  );
  app.post(
    '/:id/health/check',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    checkHealthHandler,
  );
  app.post(
    '/bulk-import',
    { preHandler: [app.authenticate, requirePermission('cameras:create'), guardAllCameras] },
    bulkImportHandler,
  );
  app.get(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read'), guardDeviceVisible()] },
    getDeviceHandler,
  );
  app.post(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:create'), guardAllCameras] },
    createDeviceHandler,
  );
  app.patch(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    updateDeviceHandler,
  );
  app.delete(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardAllCameras] },
    deleteDeviceHandler,
  );
  app.post(
    '/:id/provision-channels',
    { preHandler: [app.authenticate, requirePermission('cameras:create'), guardAllCameras] },
    provisionChannelsHandler,
  );
}
