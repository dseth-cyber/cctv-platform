import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createSiteSchema, updateSiteSchema, createZoneSchema, updateZoneSchema } from './sites.schema.js';
import * as sitesService from './sites.service.js';
import { requirePermission } from '../../middleware/rbac.js';

async function listSitesHandler(_request: FastifyRequest, reply: FastifyReply) {
  const sites = await sitesService.listSites();
  return reply.status(200).send(sites);
}

async function getSiteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const site = await sitesService.getSiteById(id);
  return reply.status(200).send(site);
}

async function createSiteHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createSiteSchema.parse(request.body);
  const site = await sitesService.createSite(input);
  return reply.status(201).send(site);
}

async function updateSiteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = updateSiteSchema.parse(request.body);
  const site = await sitesService.updateSite(id, input);
  return reply.status(200).send(site);
}

async function deleteSiteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const res = await sitesService.deleteSite(id);
  return reply.status(200).send(res);
}

async function createZoneHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createZoneSchema.parse(request.body);
  const zone = await sitesService.createZone(input);
  return reply.status(201).send(zone);
}

async function updateZoneHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = updateZoneSchema.parse(request.body);
  const zone = await sitesService.updateZone(id, input);
  return reply.status(200).send(zone);
}

async function deleteZoneHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const res = await sitesService.deleteZone(id);
  return reply.status(200).send(res);
}

export async function siteRoutes(app: FastifyInstance) {
  // Sites endpoints
  app.get(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    listSitesHandler,
  );
  app.get(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getSiteHandler,
  );
  app.post(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:create')] },
    createSiteHandler,
  );
  app.patch(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    updateSiteHandler,
  );
  app.delete(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete')] },
    deleteSiteHandler,
  );

  // Zones endpoints
  app.post(
    '/zones',
    { preHandler: [app.authenticate, requirePermission('cameras:create')] },
    createZoneHandler,
  );
  app.patch(
    '/zones/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    updateZoneHandler,
  );
  app.delete(
    '/zones/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete')] },
    deleteZoneHandler,
  );
}
