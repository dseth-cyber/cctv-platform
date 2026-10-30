import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requirePermission } from '../../middleware/rbac.js';
import {
  getPreflightReadiness,
  getPilotRolloutPlan,
  recordSignoff,
  listSignoffs,
} from './release.service.js';

export async function releaseRoutes(app: FastifyInstance): Promise<void> {
  // Preflight readiness & secret audit check
  app.get(
    '/preflight',
    { preHandler: [app.authenticate, requirePermission('settings:read')] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const report = await getPreflightReadiness();
      return reply.status(200).send(report);
    }
  );

  // Pilot rollout gates & capacity planner
  app.get(
    '/pilot-plan',
    { preHandler: [app.authenticate, requirePermission('settings:read')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;
      const targetCameras = query.targetCameras ? parseInt(query.targetCameras, 10) : 25;
      const plan = getPilotRolloutPlan(targetCameras);
      return reply.status(200).send(plan);
    }
  );

  // Signoff list
  app.get(
    '/signoffs',
    { preHandler: [app.authenticate, requirePermission('settings:read')] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const records = await listSignoffs();
      return reply.status(200).send(records);
    }
  );

  // Submit sign-off approval
  app.post(
    '/signoff',
    { preHandler: [app.authenticate, requirePermission('settings:update')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        targetEnvironment?: string;
        scope?: string;
        notes?: string;
        checklistPassed?: boolean;
      };

      const user = (request as any).user;
      // The signer is always the authenticated user; a client-supplied name would let anyone sign as someone else.
      const signedBy = user?.username || user?.email;
      if (!signedBy) {
        return reply.status(401).send({ message: 'Authenticated user identity required for sign-off' });
      }
      const targetEnv = body.targetEnvironment || 'pilot-staging';
      const scope = body.scope || 'CCTV Pilot Rollout Wave 1';
      const notes = body.notes || 'Pre-flight and UAT checks accepted.';
      const passed = body.checklistPassed !== false;

      const record = await recordSignoff(signedBy, targetEnv, scope, notes, passed);
      return reply.status(201).send(record);
    }
  );
}
