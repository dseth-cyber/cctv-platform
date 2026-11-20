import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission, getUserPermissions } from '../../middleware/rbac.js';
import { cameraWhere, guardAllCameras, guardCameraParam, guardDeviceVisible, assertCameraAccess } from '../access/camera-scope.js';
import { createAuditLog } from '../audit/audit.service.js';
import { ForbiddenError } from '../../lib/errors.js';
import { assetInputSchema, assetReport, deleteAsset, getAsset, importAssets, importRowSchema, listVendors, saveAsset, type AssetKind } from './assets.service.js';
import { WARRANTY_MONTH_CHOICES } from './asset-logic.js';

/**
 * Purchase and warranty cards of recorders and cameras.
 * Reading: cameras:read within the person's camera scope. Changing a camera's card: cameras:update and that camera
 * in scope; a recorder's card: cameras:update and every camera (as for changing the recorder itself).
 * Price: only with assets:price (admins have it; other roles get it on the roles page).
 */
const PRICE = 'assets:price';

async function canPrice(request: FastifyRequest): Promise<boolean> {
  const user = (request as any).user;
  if (user?.role === 'system') return true;
  const perms = await getUserPermissions(user?.id);
  return perms.includes('*') || perms.includes(PRICE);
}

const by = (request: FastifyRequest) => (request as any).user?.username ?? 'system';
const idOf = (request: FastifyRequest) => (request.params as { id: string }).id;

function audit(request: FastifyRequest, action: string, entityId: string, description: string, metadata: Record<string, unknown>) {
  const user = (request as any).user;
  createAuditLog({ userId: user?.id, action, entity: 'asset', entityId, description: `${description} by ${user?.username ?? 'system'}`, metadata, ipAddress: request.ip }).catch(() => {});
}

export async function assetRoutes(app: FastifyInstance) {
  const read = [app.authenticate, requirePermission('cameras:read')];
  const update = [app.authenticate, requirePermission('cameras:update')];

  app.get('/options', { preHandler: read }, async (request) => ({
    monthChoices: WARRANTY_MONTH_CHOICES,
    vendors: [...(await listVendors()).values()].filter((v) => v.isActive),
    canPrice: await canPrice(request),
  }));

  const kinds: { kind: AssetKind; readGuard: any; writeGuard: any }[] = [
    { kind: 'device', readGuard: guardDeviceVisible(), writeGuard: guardAllCameras },
    { kind: 'camera', readGuard: guardCameraParam(), writeGuard: guardCameraParam() },
  ];
  for (const { kind, readGuard, writeGuard } of kinds) {
    app.get(`/${kind}/:id`, { preHandler: [...read, readGuard] }, async (request) => getAsset(kind, idOf(request), await canPrice(request)));
    app.put(`/${kind}/:id`, { preHandler: [...update, writeGuard] }, async (request) => {
      const input = assetInputSchema.parse(request.body);
      const price = await canPrice(request);
      const r = await saveAsset(kind, idOf(request), input, { by: by(request), canPrice: price });
      audit(request, 'asset_update', idOf(request), `Purchase/warranty of ${kind} updated`, { kind, changed: r.changed });
      return getAsset(kind, idOf(request), price);
    });
    app.delete(`/${kind}/:id`, { preHandler: [...update, writeGuard] }, async (request) => {
      const removed = await deleteAsset(kind, idOf(request), by(request));
      if (removed) audit(request, 'asset_delete', idOf(request), `Purchase/warranty of ${kind} removed`, { kind });
      return { removed };
    });
  }

  app.get('/report', { preHandler: read }, async (request) => assetReport(await cameraWhere(request), await canPrice(request)));

  const importSchema = z.object({ dryRun: z.boolean().default(true), items: z.array(importRowSchema).min(1).max(2000) });
  app.post('/import', { preHandler: update }, async (request) => {
    const { dryRun, items } = importSchema.parse(request.body);
    // A recorder's card takes access to every camera, a camera's card that camera.
    if (items.some((i) => i.kind === 'device')) await guardAllCameras(request, undefined as any);
    for (const item of items.filter((i) => i.kind === 'camera')) {
      await assertCameraAccess(request, item.id).catch(() => { throw new ForbiddenError('A camera in the sheet is outside your cameras'); });
    }
    const result = await importAssets(items, { dryRun, by: by(request), canPrice: await canPrice(request) });
    if (!dryRun && result.applied) audit(request, 'asset_import', 'sheet', `Purchase/warranty sheet imported (${result.applied} items)`, { applied: result.applied });
    return result;
  });
}
