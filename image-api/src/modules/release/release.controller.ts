import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
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
    { preHandler: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const report = await getPreflightReadiness();
      return reply.status(200).send(report);
    }
  );

  // Pilot rollout gates & capacity planner
  app.get(
    '/pilot-plan',
    { preHandler: [app.authenticate] },
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
    { preHandler: [app.authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const records = listSignoffs();
      return reply.status(200).send(records);
    }
  );

  // Submit sign-off approval
  app.post(
    '/signoff',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        signedBy?: string;
        targetEnvironment?: string;
        scope?: string;
        notes?: string;
        checklistPassed?: boolean;
      };

      const user = (request as any).user;
      const signedBy = body.signedBy || user?.username || user?.email || 'Administrator';
      const targetEnv = body.targetEnvironment || 'pilot-staging';
      const scope = body.scope || 'CCTV Pilot Rollout Wave 1';
      const notes = body.notes || 'Pre-flight and UAT checks accepted.';
      const passed = body.checklistPassed !== false;

      const record = await recordSignoff(signedBy, targetEnv, scope, notes, passed);
      return reply.status(201).send(record);
    }
  );
}
