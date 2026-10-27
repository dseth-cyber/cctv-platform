import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { imageSearchSchema, registerImageSchema, updateMetadataSchema, updateTagsSchema, processingResultSchema } from './images.schema.js';
import * as imagesService from './images.service.js';
import { requirePermission } from '../../middleware/rbac.js';
import { storageRouter } from '../../lib/storage/storage-router.js';
import { createAuditLog } from '../audit/audit.service.js';
import * as authService from '../auth/auth.service.js';
import { getBulkJob } from '../../lib/bulk-job.js';

// Seniority ranking by CustomRole.sortOrder — lower number = more senior
// (admin=1, operator=2, viewer=3). admin/system always outrank everyone; an
// unknown/unconfigured role is treated as the most junior (fails closed).
async function getRoleRank(roleCode: string | null | undefined): Promise<number> {
  if (!roleCode) return Number.MAX_SAFE_INTEGER;
  if (roleCode === 'admin' || roleCode === 'system') return -1;
  const prisma = (await import('../../lib/prisma.js')).getPrisma();
  const role = await prisma.customRole.findUnique({ where: { code: roleCode }, select: { sortOrder: true } });
  return role ? role.sortOrder : Number.MAX_SAFE_INTEGER;
}

async function registerImageHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = registerImageSchema.parse(request.body);
  const result = await imagesService.registerImage(input);
  return reply.status(201).send(result);
}

async function searchHandler(request: FastifyRequest, reply: FastifyReply) {
  const params = imageSearchSchema.parse(request.query);
  const result = await imagesService.searchImages(params);
  return reply.status(200).send(result);
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const image = await imagesService.getImageById(id);
  return reply.status(200).send(image);
}

async function updateMetadataHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = updateMetadataSchema.parse(request.body);
  const updated = await imagesService.updateImageMetadata(id, input);
  const user = (request as any).user;
  // This endpoint is shared between the human-facing "edit metadata" form and the
  // image-processing-worker submitting extracted technical metadata (dimensions, EXIF,
  // etc.) for every single image it processes — the latter authenticates with the
  // service API key (role 'system', see middleware/auth.ts), not a real user session.
  // Auditing every worker call flooded audit_logs to 152,591 rows (72% of the whole
  // table) with zero audit value; only genuine human edits are worth recording. See
  // incident_2026-08-07.
  if (user?.role !== 'system') {
    createAuditLog({
      userId: user?.id,
      action: 'metadata_update',
      entity: 'image',
      entityId: id,
      description: `Metadata updated for image ${id}`,
      metadata: { changes: input },
      ipAddress: request.ip,
    }).catch(() => {});
  }
  return reply.status(200).send(updated);
}

async function upsertTagsHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const tags = updateTagsSchema.parse(request.body);
  const result = await imagesService.upsertImageTags(id, tags);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'tags_update',
    entity: 'image',
    entityId: id,
    description: `Tags updated for image ${id}`,
    metadata: { tags },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(200).send(result);
}

async function deleteTagHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id, key } = request.params as { id: string; key: string };
  await imagesService.deleteImageTag(id, key);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'tag_delete',
    entity: 'image',
    entityId: id,
    description: `Tag '${key}' deleted from image ${id}`,
    metadata: { key },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(204).send();
}

async function processingResultHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = processingResultSchema.parse(request.body);
  const result = await imagesService.submitProcessingResult(id, input);
  return reply.status(200).send(result);
}

async function deleteImageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await imagesService.softDeleteImage(id);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'image_delete',
    entity: 'image',
    entityId: id,
    description: `Image ${id} soft-deleted`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(204).send();
}

async function bulkDeleteSelectedHandler(request: FastifyRequest, reply: FastifyReply) {
  const { ids } = request.body as { ids: string[] };
  const user = (request as any).user;
  const result = await imagesService.bulkSoftDeleteSelected(ids ?? []);
  createAuditLog({
    userId: user?.id,
    action: 'bulk_delete',
    entity: 'image',
    entityId: 'selected',
    description: `Soft-deleted ${result.deleted}/${ids?.length ?? 0} selected images by ${user?.username}`,
    metadata: { ids, deleted: result.deleted },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(200).send(result);
}

async function bulkDeletePreviewHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days, cameraIds, fileTypes, deleteMode } = request.query as {
    days: string;
    cameraIds?: string;
    fileTypes?: string;
    deleteMode?: 'files_only' | 'entire_record';
  };
  const d = parseInt(days, 10);
  if (isNaN(d) || d < 0) return reply.status(400).send({ error: 'Invalid days parameter' });
  const camIds = cameraIds ? cameraIds.split(',').filter(Boolean) : [];
  const fTypes = fileTypes ? fileTypes.split(',').filter(Boolean) : [];
  const result = await imagesService.bulkDeletePreview(d, camIds, fTypes, deleteMode);
  return reply.status(200).send(result);
}

async function bulkDeleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { days, password, cameraIds, fileTypes, deleteMode } = request.body as {
    days: number;
    password: string;
    cameraIds?: string[];
    fileTypes?: string[];
    deleteMode?: 'files_only' | 'entire_record';
  };
  const user = (request as any).user;

  // Verify password
  const authService = await import('../auth/auth.service.js');
  try {
    await authService.login({ username: user.username, password });
  } catch {
    return reply.status(401).send({ error: 'Invalid password' });
  }

  const result = await imagesService.bulkDeleteByAge(days, user.username, cameraIds, fileTypes, deleteMode);
  const isAsync = deleteMode === 'files_only' && 'jobId' in result;

  createAuditLog({
    userId: user.id,
    action: deleteMode === 'files_only' ? 'bulk_files_delete' : 'bulk_delete',
    entity: 'image',
    entityId: days > 0 ? `age>${days}d` : 'all',
    description: isAsync
      ? `Started bulk delete of ${(result as { total: number }).total} files (types: ${fileTypes?.join(',')}). Filter: cameras=${cameraIds && cameraIds.length > 0 ? cameraIds.join(',') : 'all'}, age=${days > 0 ? `${days}d` : 'all'} by ${user.username} (job ${(result as { jobId: string }).jobId})`
      : `Bulk deleted ${(result as { deleted: number }).deleted} images. Filter: cameras=${cameraIds && cameraIds.length > 0 ? cameraIds.join(',') : 'all'}, age=${days > 0 ? `${days}d` : 'all'} by ${user.username}`,
    metadata: { cameraIds, fileTypes, deleteMode, ...result },
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.status(isAsync ? 202 : 200).send(result);
}

// Progress polling for the background jobs bulk-delete/trash-purge kick off — see
// lib/bulk-job.ts. Frontend polls this to drive the progress modal.
async function bulkJobStatusHandler(request: FastifyRequest, reply: FastifyReply) {
  const { jobId } = request.params as { jobId: string };
  const job = await getBulkJob(jobId);
  if (!job) return reply.status(404).send({ error: 'Job not found or expired' });
  return reply.status(200).send(job);
}

async function bulkReprocessAllHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = await imagesService.bulkReprocessAll();
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'image_bulk_reprocess',
    entity: 'image',
    entityId: 'all',
    description: `Bulk reprocess queued: ${result.queued}/${result.total} images`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(200).send(result);
}

async function reprocessHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const result = await imagesService.reprocessImage(id);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'image_reprocess',
    entity: 'image',
    entityId: id,
    description: `Image ${id} queued for reprocessing`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(200).send(result);
}

async function trashListHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as {
    page?: string;
    limit?: string;
    q?: string;
    cameraId?: string;
    startDate?: string;
    endDate?: string;
  };
  const result = await imagesService.listDeletedImages({
    page: query.page ? parseInt(query.page) : 1,
    limit: query.limit ? parseInt(query.limit) : 20,
    q: query.q,
    cameraId: query.cameraId,
    startDate: query.startDate,
    endDate: query.endDate,
  });
  return reply.send(result);
}

async function restoreHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await imagesService.restoreImage(id);
  const user = (request as any).user;
  createAuditLog({ userId: user?.id, action: 'image_restore', entity: 'image', entityId: id, description: `Image ${id} restored from trash by ${user?.username}`, ipAddress: request.ip }).catch(() => {});
  return reply.send({ restored: true });
}

async function restoreAllHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = await imagesService.restoreAllImages();
  const user = (request as any).user;
  createAuditLog({ userId: user?.id, action: 'image_restore_all', entity: 'image', entityId: 'all', description: `Restored ${result.restored} images from trash by ${user?.username}`, ipAddress: request.ip }).catch(() => {});
  return reply.send(result);
}

async function restoreBulkHandler(request: FastifyRequest, reply: FastifyReply) {
  const { ids } = request.body as { ids: string[] };
  const result = await imagesService.restoreImagesBulk(ids);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'image_restore',
    entity: 'image',
    entityId: 'bulk',
    description: `Restored ${result.restored} images from trash by ${user?.username}`,
    metadata: { ids },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.send(result);
}

async function emptyTrashHandler(request: FastifyRequest, reply: FastifyReply) {
  const { password } = request.body as { password: string };
  const user = (request as any).user;
  // Verify password
  const authService = await import('../auth/auth.service.js');
  try { await authService.login({ username: user.username, password }); } catch { return reply.status(401).send({ error: 'Invalid password' }); }

  const result = await imagesService.emptyTrash(user.username);
  createAuditLog({ userId: user?.id, action: 'trash_empty', entity: 'image', entityId: 'all', description: `Started permanent delete of ${result.total} files from trash by ${user?.username} (job ${result.jobId})`, ipAddress: request.ip }).catch(() => {});
  return reply.status(202).send(result);
}

async function trashDeleteBulkHandler(request: FastifyRequest, reply: FastifyReply) {
  const { ids, password } = request.body as { ids: string[]; password?: string };
  const user = (request as any).user;
  // Verify password
  const authService = await import('../auth/auth.service.js');
  try { await authService.login({ username: user.username, password: password ?? '' }); } catch { return reply.status(401).send({ error: 'Invalid password' }); }

  const result = await imagesService.deleteImagesBulkPermanently(ids, user.username);
  createAuditLog({
    userId: user?.id,
    action: 'trash_empty',
    entity: 'image',
    entityId: 'bulk',
    description: `Started permanent delete of ${ids.length} images from trash by ${user?.username} (job ${result.jobId})`,
    metadata: { ids, jobId: result.jobId },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(202).send(result);
}

async function lockImageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const { reason, expireAt } = request.body as { reason?: string; expireAt?: string };
  const user = (request as any).user;

  const prisma = (await import('../../lib/prisma.js')).getPrisma();
  const image = await prisma.image.update({
    where: { id },
    data: {
      locked: true,
      lockedBy: user?.username ?? 'system',
      lockedByRole: user?.role ?? null,
      lockedAt: new Date(),
      lockReason: reason ?? null,
      lockExpireAt: expireAt ? new Date(expireAt) : null,
    },
  });

  createAuditLog({
    userId: user?.id,
    action: 'image_lock',
    entity: 'image',
    entityId: id,
    description: `Locked image ${id}${reason ? ` (${reason})` : ''} by ${user?.username ?? 'system'}`,
    metadata: { reason, expireAt },
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.send(image);
}

// Decide whether `user` may unlock an image locked by `lockedBy`/`lockedByRole`.
// Allowed when: actor is admin/system, actor locked it themselves, or actor's
// role is strictly more senior than the lock's snapshotted role. Locks with no
// role snapshot (pre-feature) can only be cleared by their owner or admin/system.
async function canUnlock(
  user: { username?: string; role?: string } | undefined,
  lock: { lockedBy: string | null; lockedByRole: string | null },
): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin' || user.role === 'system') return true;
  if (lock.lockedBy && user.username && lock.lockedBy === user.username) return true;
  if (!lock.lockedByRole) return false;
  const [actorRank, lockRank] = await Promise.all([
    getRoleRank(user.role),
    getRoleRank(lock.lockedByRole),
  ]);
  return actorRank < lockRank;
}

async function unlockImageHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const user = (request as any).user;

  const prisma = (await import('../../lib/prisma.js')).getPrisma();
  const existing = await prisma.image.findUnique({
    where: { id },
    select: { locked: true, lockedBy: true, lockedByRole: true },
  });
  if (!existing) return reply.status(404).send({ error: 'Image not found' });

  if (existing.locked && !(await canUnlock(user, existing))) {
    return reply.status(403).send({
      error: 'You do not have permission to unlock an image locked by a more senior role or another user',
      lockedBy: existing.lockedBy,
      lockedByRole: existing.lockedByRole,
    });
  }

  const image = await prisma.image.update({
    where: { id },
    data: { locked: false, lockedBy: null, lockedByRole: null, lockedAt: null, lockReason: null, lockExpireAt: null },
  });

  createAuditLog({
    userId: user?.id,
    action: 'image_unlock',
    entity: 'image',
    entityId: id,
    description: `Unlocked image ${id} by ${user?.username ?? 'system'}`,
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.send(image);
}

// Admin-only "unlock everything" escape hatch, guarded by a password re-entry.
// Ignores the per-image seniority rules on purpose — it is gated on the admin
// role itself, which already outranks every lock.
async function unlockAllImagesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user;
  const { password } = request.body as { password?: string };

  if (user?.role !== 'admin' && user?.role !== 'system') {
    return reply.status(403).send({ error: 'Only an admin can unlock all images' });
  }
  if (!password) {
    return reply.status(400).send({ error: 'Password is required' });
  }
  try {
    await authService.login({ username: user.username, password });
  } catch {
    return reply.status(401).send({ error: 'Invalid password' });
  }

  const prisma = (await import('../../lib/prisma.js')).getPrisma();
  const result = await prisma.image.updateMany({
    where: { locked: true },
    data: { locked: false, lockedBy: null, lockedByRole: null, lockedAt: null, lockReason: null, lockExpireAt: null },
  });

  createAuditLog({
    userId: user?.id,
    action: 'image_unlock',
    entity: 'image',
    entityId: 'ALL',
    description: `Unlocked all ${result.count} locked image(s) by ${user?.username ?? 'system'}`,
    metadata: { count: result.count, scope: 'all' },
    ipAddress: request.ip,
  }).catch(() => {});

  return reply.send({ unlocked: result.count });
}

async function getFileStreamHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id, fileType } = request.params as { id: string; fileType: string };
  const image = await imagesService.getImageById(id);

  const files = (image as Record<string, unknown>)?.imageFiles as Array<Record<string, unknown>> ?? [];
  const file = files.find((f: Record<string, unknown>) => f.fileType === fileType) as Record<string, unknown> | undefined;

  if (!file) {
    return reply.status(404).send({
      statusCode: 404,
      error: 'NotFoundError',
      message: `File type '${fileType}' not found for image ${id}`,
    });
  }

  try {
    const provider = (file.storageProviderId as string)
      ? storageRouter.get(file.storageProviderId as string)
      : storageRouter.getDefault();
    const stream = await provider.getStream(file.objectKey as string);
    reply.header('Content-Type', (file.mimeType as string) ?? 'application/octet-stream');
    reply.header('Cache-Control', 'no-store');
    reply.header('Transfer-Encoding', 'chunked');
    const user = (request as any).user;
    createAuditLog({
      userId: user?.id,
      action: 'file_download',
      entity: 'image_file',
      entityId: `${id}/${fileType}`,
      description: `File '${fileType}' downloaded for image ${id}`,
      ipAddress: request.ip,
    }).catch(() => {});
    return reply.send(stream);
  } catch (err) {
    return reply.status(500).send({
      statusCode: 500,
      error: 'InternalServerError',
      message: 'Failed to retrieve file from storage',
    });
  }
}

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/',
    { preHandler: [app.authenticate] },
    registerImageHandler,
  );

  app.get(
    '/',
    { preHandler: [app.authenticate] },
    searchHandler,
  );

  app.get(
    '/trash',
    { preHandler: [app.authenticate, requirePermission('search:read')] },
    trashListHandler,
  );

  app.post(
    '/trash/restore-all',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    restoreAllHandler,
  );

  app.post(
    '/trash/empty',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    emptyTrashHandler,
  );

  app.post(
    '/trash/restore-bulk',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    restoreBulkHandler,
  );

  app.post(
    '/trash/delete-bulk',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    trashDeleteBulkHandler,
  );

  app.get(
    '/bulk-delete-preview',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    bulkDeletePreviewHandler,
  );

  app.post(
    '/bulk-delete',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    bulkDeleteHandler,
  );

  app.post(
    '/bulk-delete-selected',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    bulkDeleteSelectedHandler,
  );

  app.get(
    '/jobs/:jobId',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    bulkJobStatusHandler,
  );

  app.get(
    '/:id',
    { preHandler: [app.authenticate] },
    getByIdHandler,
  );

  app.patch(
    '/:id/metadata',
    { preHandler: [app.authenticate, requirePermission('search:update')] },
    updateMetadataHandler,
  );

  app.post(
    '/:id/tags',
    { preHandler: [app.authenticate, requirePermission('search:update')] },
    upsertTagsHandler,
  );

  app.delete(
    '/:id/tags/:key',
    { preHandler: [app.authenticate, requirePermission('search:update')] },
    deleteTagHandler,
  );

  app.post(
    '/:id/result',
    { preHandler: [app.authenticate, requirePermission('search:update')] },
    processingResultHandler,
  );

  app.delete(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    deleteImageHandler,
  );

  app.post(
    '/:id/restore',
    { preHandler: [app.authenticate, requirePermission('search:delete')] },
    restoreHandler,
  );

  app.post(
    '/reprocess-all',
    { preHandler: [app.authenticate, requirePermission('processing:create')] },
    bulkReprocessAllHandler,
  );

  app.post(
    '/:id/reprocess',
    { preHandler: [app.authenticate, requirePermission('processing:create')] },
    reprocessHandler,
  );

  app.get(
    '/:id/files/:fileType',
    { preHandler: [app.authenticate] },
    getFileStreamHandler,
  );

  app.post(
    '/:id/lock',
    { preHandler: [app.authenticate, requirePermission('search:update')] },
    lockImageHandler,
  );

  app.post(
    '/:id/unlock',
    { preHandler: [app.authenticate, requirePermission('search:update')] },
    unlockImageHandler,
  );

  app.post(
    '/unlock-all',
    { preHandler: [app.authenticate, requirePermission('search:update')] },
    unlockAllImagesHandler,
  );
}
