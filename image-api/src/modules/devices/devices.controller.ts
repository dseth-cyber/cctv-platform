import { allowedCameraIds, cameraWhere, guardAllCameras, guardDeviceVisible } from '../access/camera-scope.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildDeviceReport, checkDeviceHealthNow } from './device-health.service.js';
import { createAuditLog } from '../audit/audit.service.js';
import { z } from 'zod';
import { getBulkJob } from '../../lib/bulk-job.js';
import { RecorderNtpError } from './recorder-ntp.js';
import { NtpBatchBusyError, pointAndRecord, recheckSoon, startNtpBatch } from './recorder-ntp-bulk.js';
import { syncCameraPaths } from '../media/path-sync.js';
import { listMasterdataOptions } from '../masterdata/masterdata.service.js';
import { getPrisma } from '../../lib/prisma.js';
import { ACK_NOTES, setAck, type HealthNotesAck } from './health-notes-ack.js';
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

/** Changes the recorder's clock source, so every press is in the audit log with what it was before. */
async function clockNtpHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;
  try {
    const result = await pointAndRecord(id, { id: user?.id, username: user?.username, ip: request.ip });
    if (!result) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Device not found' });
    recheckSoon([id]);
    return reply.status(200).send(result);
  } catch (err) {
    if (!(err instanceof RecorderNtpError)) throw err;
    const status = err.code === 'RECORDER_UNREACHABLE' || err.code === 'RECORDER_REFUSED' ? 502 : err.code === 'NOT_SUPPORTED' ? 400 : 409;
    return reply.status(status).send({ statusCode: status, error: err.code, message: err.code, details: { code: err.code, ...err.details } });
  }
}

const ntpBatchSchema = z.object({ deviceIds: z.array(z.string().uuid()).min(1).max(500) });

/** Many recorders at once, one after another in the background; the page follows the job. */
async function clockNtpBatchHandler(request: FastifyRequest, reply: FastifyReply) {
  const { deviceIds } = ntpBatchSchema.parse(request.body);
  const user = (request as any).user;
  try {
    const jobId = await startNtpBatch([...new Set(deviceIds)], { id: user?.id, username: user?.username, ip: request.ip });
    return reply.status(202).send({ jobId });
  } catch (err) {
    if (!(err instanceof NtpBatchBusyError)) throw err;
    return reply.status(409).send({ statusCode: 409, error: 'NTP_BATCH_BUSY', message: 'NTP_BATCH_BUSY', details: { code: 'NTP_BATCH_BUSY', jobId: err.jobId } });
  }
}

async function clockNtpBatchStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { jobId } = request.params as { jobId: string };
  const job = await getBulkJob(jobId);
  if (!job || job.kind !== 'device-ntp') return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Job not found' });
  return reply.status(200).send(job);
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

const ackParams = z.object({ id: z.guid(), note: z.enum(ACK_NOTES) });
const ackBody = z.object({ acknowledged: z.boolean() });

/** A person marks a recorder note as known (cannot or should not be changed), or takes that back. */
async function healthNoteAckHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id, note } = ackParams.parse(request.params);
  const { acknowledged } = ackBody.parse(request.body);
  const user = (request as any).user;
  const prisma = getPrisma();
  const device = await prisma.device.findUnique({ where: { id }, select: { id: true, name: true, healthNotesAck: true } });
  if (!device) return reply.status(404).send({ message: 'Device not found' });
  const next = setAck(device.healthNotesAck as HealthNotesAck | null, note, acknowledged, user?.username ?? 'unknown');
  await prisma.device.update({ where: { id }, data: { healthNotesAck: next as object } });
  await createAuditLog({
    userId: user?.id,
    action: acknowledged ? 'device_health_note_ack' : 'device_health_note_unack',
    entity: 'device',
    entityId: id,
    description: `${device.name}: note ${note} ${acknowledged ? 'acknowledged' : 'no longer acknowledged'} by ${user?.username ?? 'unknown'}`,
    metadata: { note },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send({ healthNotesAck: next });
}

async function provisionChannelsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const res = await devicesService.provisionDeviceChannels(id);
  return reply.status(200).send(res);
}

export async function deviceRoutes(app: FastifyInstance) {
  app.put(
    '/:id/health/notes/:note',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    healthNoteAckHandler,
  );
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
    '/:id/clock/ntp',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    clockNtpHandler,
  );
  app.post(
    '/clock/ntp/batch',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    clockNtpBatchHandler,
  );
  app.get(
    '/clock/ntp/batch/:jobId',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    clockNtpBatchStatusHandler,
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
