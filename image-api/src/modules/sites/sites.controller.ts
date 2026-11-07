import { cameraWhere, guardAllCameras } from '../access/camera-scope.js';
import { NotFoundError } from '../../lib/errors.js';
import { getPrisma } from '../../lib/prisma.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createSiteSchema, updateSiteSchema, createZoneSchema, updateZoneSchema } from './sites.schema.js';
import * as sitesService from './sites.service.js';
import { requirePermission } from '../../middleware/rbac.js';

/** The sites and zones holding cameras within reach, with counts of only those. */
async function reachablePlaces(request: FastifyRequest) {
  const where = await cameraWhere(request);
  if (!where) return null;
  const cameras = await getPrisma().camera.findMany({ where: { AND: [where], deletedAt: null }, select: { siteId: true, zoneId: true, deviceId: true } });
  return cameras;
}

async function listSitesHandler(request: FastifyRequest, reply: FastifyReply) {
  const places = await reachablePlaces(request);
  let sites: any[] = await sitesService.listSites();
  if (places) {
    sites = sites
      .filter((site) => places.some((c) => c.siteId === site.id))
      .map((site) => {
        const here = places.filter((c) => c.siteId === site.id);
        return {
          ...site,
          zones: (site.zones ?? []).filter((zone: any) => here.some((c) => c.zoneId === zone.id)),
          _count: { cameras: here.length, devices: new Set(here.flatMap((c) => (c.deviceId ? [c.deviceId] : []))).size },
        };
      });
  }
  return reply.status(200).send(sites);
}

async function getSiteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const places = await reachablePlaces(request);
  if (places && !places.some((c) => c.siteId === id)) throw new NotFoundError('Site', id);
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
    { preHandler: [app.authenticate, requirePermission('cameras:create'), guardAllCameras] },
    createSiteHandler,
  );
  app.patch(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    updateSiteHandler,
  );
  app.delete(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardAllCameras] },
    deleteSiteHandler,
  );

  // Zones endpoints
  app.post(
    '/zones',
    { preHandler: [app.authenticate, requirePermission('cameras:create'), guardAllCameras] },
    createZoneHandler,
  );
  app.patch(
    '/zones/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:update'), guardAllCameras] },
    updateZoneHandler,
  );
  app.delete(
    '/zones/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete'), guardAllCameras] },
    deleteZoneHandler,
  );
}
