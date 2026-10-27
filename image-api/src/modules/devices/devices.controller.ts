import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createDeviceSchema,
  updateDeviceSchema,
  deviceQuerySchema,
  probeDeviceSchema,
  bulkImportDeviceSchema,
} from './devices.schema.js';
import * as devicesService from './devices.service.js';
import { requirePermission } from '../../middleware/rbac.js';

async function listDevicesHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = deviceQuerySchema.parse(request.query);
  const devices = await devicesService.listDevices(query);
  return reply.status(200).send(devices);
}

async function getDeviceTemplatesHandler(_request: FastifyRequest, reply: FastifyReply) {
  const templates = devicesService.getDeviceTemplates();
  return reply.status(200).send(templates);
}

async function getDashboardSummaryHandler(_request: FastifyRequest, reply: FastifyReply) {
  const summary = await devicesService.getDashboardSummary();
  return reply.status(200).send(summary);
}

async function probeDeviceHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = probeDeviceSchema.parse(request.body);
  const res = await devicesService.probeDeviceConnection(input.ipAddress, input.rtspPort, input.httpPort);
  return reply.status(200).send(res);
}

async function bulkImportHandler(request: FastifyRequest, reply: FastifyReply) {
  const { devices } = bulkImportDeviceSchema.parse(request.body);
  const res = await devicesService.bulkImportDevices(devices);
  return reply.status(201).send(res);
}

async function getDeviceHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const device = await devicesService.getDeviceById(id);
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

async function provisionChannelsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const res = await devicesService.provisionDeviceChannels(id);
  return reply.status(200).send(res);
}

export async function deviceRoutes(app: FastifyInstance) {
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
  app.post(
    '/bulk-import',
    { preHandler: [app.authenticate, requirePermission('cameras:create')] },
    bulkImportHandler,
  );
  app.get(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getDeviceHandler,
  );
  app.post(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:create')] },
    createDeviceHandler,
  );
  app.patch(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    updateDeviceHandler,
  );
  app.delete(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete')] },
    deleteDeviceHandler,
  );
  app.post(
    '/:id/provision-channels',
    { preHandler: [app.authenticate, requirePermission('cameras:create')] },
    provisionChannelsHandler,
  );
}
