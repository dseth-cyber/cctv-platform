import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createRetentionPolicySchema, updateRetentionPolicySchema } from './retention.schema.js';
import * as retentionService from './retention.service.js';
import { sweepExpiredImages } from '../retention-sweeper/retention-sweeper.service.js';
import { createAuditLog } from '../audit/audit.service.js';
import { requirePermission } from '../../middleware/rbac.js';

async function listHandler(_request: FastifyRequest, reply: FastifyReply) {
  const policies = await retentionService.listPolicies();
  return reply.status(200).send(policies);
}

async function getByIdHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const policy = await retentionService.getPolicyById(id);
  return reply.status(200).send(policy);
}

async function createHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = createRetentionPolicySchema.parse(request.body);
  const policy = await retentionService.createPolicy(input);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'policy_create',
    entity: 'retention_policy',
    entityId: policy.id,
    description: `Retention policy '${input.name}' created`,
    metadata: { name: input.name },
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(201).send(policy);
}

async function updateHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  const input = updateRetentionPolicySchema.parse(request.body);
  const policy = await retentionService.updatePolicy(id, input);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'policy_update',
    entity: 'retention_policy',
    entityId: id,
    description: `Retention policy ${id} updated`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(200).send(policy);
}

async function deleteHandler(request: FastifyRequest, reply: FastifyReply) {
  const { id } = request.params as { id: string };
  await retentionService.deletePolicy(id);
  const user = (request as any).user;
  createAuditLog({
    userId: user?.id,
    action: 'policy_delete',
    entity: 'retention_policy',
    entityId: id,
    description: `Retention policy ${id} deleted`,
    ipAddress: request.ip,
  }).catch(() => {});
  return reply.status(204).send();
}

export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, listHandler);
  app.get('/:id', { preHandler: [app.authenticate] }, getByIdHandler);
  app.post('/', { preHandler: [app.authenticate, requirePermission('retention:create')] }, createHandler);
  app.patch('/:id', { preHandler: [app.authenticate, requirePermission('retention:update')] }, updateHandler);
  app.delete('/:id', { preHandler: [app.authenticate, requirePermission('retention:delete')] }, deleteHandler);
  app.post('/sweep', { preHandler: [app.authenticate, requirePermission('retention:update')] }, async (_req, reply) => {
    const result = await sweepExpiredImages();
    return reply.send(result);
  });
}
