import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { MediaNodesService } from './media-nodes.service.js';
import { requirePermission } from '../../middleware/rbac.js';

export async function listMediaNodesHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as { siteId?: string; status?: string };
  const nodes = await MediaNodesService.listMediaNodes(query);
  return reply.status(200).send({ items: nodes });
}

export async function getMediaNodeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  try {
    const node = await MediaNodesService.getMediaNodeById(id);
    return reply.status(200).send(node);
  } catch (err: any) {
    return reply.status(404).send({ message: err?.message || 'MediaNode not found' });
  }
}

export async function createMediaNodeHandler(request: FastifyRequest, reply: FastifyReply) {
  const body = request.body as any;
  if (!body.name || !body.apiBaseUrl || !body.rtspBaseUrl || !body.webrtcBaseUrl) {
    return reply.status(400).send({ message: 'name, apiBaseUrl, rtspBaseUrl, and webrtcBaseUrl are required' });
  }

  try {
    const node = await MediaNodesService.createMediaNode(body);
    return reply.status(201).send(node);
  } catch (err: any) {
    return reply.status(500).send({ message: err?.message || 'Failed to create MediaNode' });
  }
}

export async function updateMediaNodeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = request.body as any;
  try {
    const updated = await MediaNodesService.updateMediaNode(id, body);
    return reply.status(200).send(updated);
  } catch (err: any) {
    return reply.status(500).send({ message: err?.message || 'Failed to update MediaNode' });
  }
}

export async function deleteMediaNodeHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  try {
    const result = await MediaNodesService.deleteMediaNode(id);
    return reply.status(200).send(result);
  } catch (err: any) {
    return reply.status(500).send({ message: err?.message || 'Failed to delete MediaNode' });
  }
}

export async function heartbeatHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const metrics = request.body as any;
  try {
    const result = await MediaNodesService.reportHeartbeat(id, metrics || {});
    return reply.status(200).send(result);
  } catch (err: any) {
    return reply.status(500).send({ message: err?.message || 'Failed to report heartbeat' });
  }
}

export async function failoverHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const body = (request.body || {}) as { targetNodeId?: string };
  try {
    const result = await MediaNodesService.failoverNode(id, body.targetNodeId);
    return reply.status(200).send(result);
  } catch (err: any) {
    return reply.status(500).send({ message: err?.message || 'Failover execution failed' });
  }
}

export async function getBenchmarkHandler(request: FastifyRequest, reply: FastifyReply) {
  const query = request.query as {
    channels?: string;
    mainKbps?: string;
    subKbps?: string;
    viewers?: string;
    retentionDays?: string;
    codec?: 'h264' | 'h265';
    raidType?: 'raid0' | 'raid5' | 'raid6' | 'raid10';
    raidOverhead?: string;
    headroom?: string;
  };

  const channelCount = query.channels ? parseInt(query.channels, 10) : 100;
  const mainBitrateKbps = query.mainKbps ? parseInt(query.mainKbps, 10) : undefined;
  const subBitrateKbps = query.subKbps ? parseInt(query.subKbps, 10) : undefined;
  const concurrentViewers = query.viewers ? parseInt(query.viewers, 10) : 5;
  const retentionDays = query.retentionDays ? parseInt(query.retentionDays, 10) : 7;
  const codec = query.codec === 'h265' ? 'h265' : 'h264';
  const raidType = query.raidType;
  const raidOverheadPercent = query.raidOverhead ? parseFloat(query.raidOverhead) : undefined;
  const freeSpaceHeadroomPercent = query.headroom ? parseFloat(query.headroom) : 20;

  const benchmark = MediaNodesService.calculateBenchmark({
    channelCount,
    mainBitrateKbps,
    subBitrateKbps,
    concurrentViewers,
    retentionDays,
    codec,
    raidType,
    raidOverheadPercent,
    freeSpaceHeadroomPercent,
  });

  return reply.status(200).send(benchmark);
}

export async function getWfhIceConfigHandler(_request: FastifyRequest, reply: FastifyReply) {
  const ice = MediaNodesService.getWfhIceConfiguration();
  return reply.status(200).send(ice);
}

export async function mediaNodeRoutes(app: FastifyInstance) {
  app.get(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    listMediaNodesHandler,
  );
  app.get(
    '/benchmark',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getBenchmarkHandler,
  );
  app.get(
    '/wfh-ice-config',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getWfhIceConfigHandler,
  );
  app.get(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:read')] },
    getMediaNodeHandler,
  );
  app.post(
    '/',
    { preHandler: [app.authenticate, requirePermission('cameras:create')] },
    createMediaNodeHandler,
  );
  app.patch(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    updateMediaNodeHandler,
  );
  app.delete(
    '/:id',
    { preHandler: [app.authenticate, requirePermission('cameras:delete')] },
    deleteMediaNodeHandler,
  );
  app.post(
    '/:id/heartbeat',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    heartbeatHandler,
  );
  app.post(
    '/:id/failover',
    { preHandler: [app.authenticate, requirePermission('cameras:update')] },
    failoverHandler,
  );
}
