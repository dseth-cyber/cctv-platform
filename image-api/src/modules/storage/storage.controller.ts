import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { growthQuerySchema } from './storage.schema.js';
import * as storageService from './storage.service.js';

async function summaryHandler(_request: FastifyRequest, reply: FastifyReply) {
  const summary = await storageService.getStorageSummary();
  return reply.status(200).send(summary);
}

async function cameraStorageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { cameraId } = request.params as { cameraId: string };
  const result = await storageService.getCameraStorage(cameraId);
  return reply.status(200).send(result);
}

async function growthHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days } = growthQuerySchema.parse(request.query);
  const result = await storageService.getStorageGrowth(days);
  return reply.status(200).send(result);
}

async function forecastHandler(_request: FastifyRequest, reply: FastifyReply) {
  const forecast = await storageService.getStorageForecast();
  return reply.status(200).send(forecast);
}

export async function storageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/summary', { preHandler: [app.authenticate] }, summaryHandler);
  app.get('/cameras/:cameraId', { preHandler: [app.authenticate] }, cameraStorageHandler);
  app.get('/growth', { preHandler: [app.authenticate] }, growthHandler);
  app.get('/forecast', { preHandler: [app.authenticate] }, forecastHandler);
}
