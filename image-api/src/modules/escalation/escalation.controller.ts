import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../../middleware/rbac.js';
import { createAuditLog } from '../audit/audit.service.js';
import { lastTelegramResult } from '../notifications/telegram.js';
import { createLinkCode, getWeeklySettings, linkStatus, sendWeeklyNow, unlinkTelegram } from './escalation-telegram.js';
import {
  deletePolicy, deleteRule, deleteTeam, EscalationError, getEscalationSettings, listPolicies, listRules, listTeams,
  policySchema, preview, ruleSchema, savePolicy, saveRule, saveTeam, sendSummaryNow, teamSchema, testPolicy,
} from './escalation.service.js';

// Reading the setup: escalation:read. Changing it, test messages and the summary on demand: escalation:manage.
// Admins hold every permission ('*'); other roles get these on the roles page.
const READ = 'escalation:read';
const MANAGE = 'escalation:manage';

async function respond(reply: FastifyReply, work: () => Promise<unknown>, okStatus = 200) {
  try {
    return reply.status(okStatus).send(await work());
  } catch (err) {
    if (err instanceof EscalationError) return reply.status(err.statusCode).send({ statusCode: err.statusCode, message: err.message, details: { code: err.code } });
    if (err instanceof z.ZodError) return reply.status(400).send({ statusCode: 400, message: 'Invalid input', details: err.issues });
    throw err;
  }
}

const audit = (request: FastifyRequest, action: string, entityId: string, description: string, metadata: Record<string, unknown> = {}) => {
  const user = (request as any).user;
  createAuditLog({ userId: user?.id, action, entity: 'escalation', entityId, description: `${description} by ${user?.username ?? 'system'}`, metadata, ipAddress: request.ip }).catch(() => {});
};

const idOf = (request: FastifyRequest) => (request.params as { id: string }).id;
const userOf = (request: FastifyRequest) => (request as any).user?.username ?? 'system';

export async function escalationRoutes(app: FastifyInstance) {
  const read = { preHandler: [app.authenticate, requirePermission(READ)] };
  const manage = { preHandler: [app.authenticate, requirePermission(MANAGE)] };

  app.get('/settings', read, async (_req, reply) => respond(reply, async () => ({ ...(await getEscalationSettings()), weekly: await getWeeklySettings(), telegram: await lastTelegramResult() })));

  // Linking one's own Telegram: any signed-in person, for their own account only.
  const self = { preHandler: [app.authenticate] };
  app.get('/link', self, async (request, reply) => respond(reply, () => linkStatus((request as any).user.id)));
  app.post('/link/code', self, async (request, reply) => respond(reply, () => createLinkCode((request as any).user.id)));
  app.delete('/link', self, async (request, reply) => respond(reply, async () => ({ unlinked: await unlinkTelegram((request as any).user.id, userOf(request)) })));

  app.post('/weekly/send', manage, async (request, reply) => respond(reply, async () => {
    const r = await sendWeeklyNow();
    audit(request, 'escalation_weekly_send', 'weekly', 'Weekly alert summary sent on demand', r);
    return r;
  }));

  app.get('/teams', read, async (_req, reply) => respond(reply, () => listTeams()));
  app.post('/teams', manage, async (request, reply) => respond(reply, async () => {
    const team = await saveTeam(null, teamSchema.parse(request.body));
    audit(request, 'escalation_team_create', team.id, `Team "${team.name}" created`, { members: team.memberIds.length, hasChat: !!team.telegramChatId });
    return team;
  }, 201));
  app.put('/teams/:id', manage, async (request, reply) => respond(reply, async () => {
    const team = await saveTeam(idOf(request), teamSchema.parse(request.body));
    audit(request, 'escalation_team_update', team.id, `Team "${team.name}" updated`, { members: team.memberIds.length, hasChat: !!team.telegramChatId, enabled: team.enabled });
    return team;
  }));
  app.delete('/teams/:id', manage, async (request, reply) => respond(reply, async () => {
    await deleteTeam(idOf(request));
    audit(request, 'escalation_team_delete', idOf(request), 'Team deleted');
    return { ok: true };
  }));

  app.get('/policies', read, async (_req, reply) => respond(reply, () => listPolicies()));
  app.post('/policies', manage, async (request, reply) => respond(reply, async () => {
    const input = policySchema.parse(request.body);
    const p = await savePolicy(null, input);
    audit(request, 'escalation_policy_create', p.id, `Escalation chain "${p.name}" created`, { steps: input.steps.length, repeatMinutes: input.repeatMinutes });
    return p;
  }, 201));
  app.put('/policies/:id', manage, async (request, reply) => respond(reply, async () => {
    const input = policySchema.parse(request.body);
    const p = await savePolicy(idOf(request), input);
    audit(request, 'escalation_policy_update', p.id, `Escalation chain "${p.name}" updated`, { steps: input.steps, repeatMinutes: input.repeatMinutes, enabled: p.enabled, isDefault: p.isDefault });
    return p;
  }));
  app.delete('/policies/:id', manage, async (request, reply) => respond(reply, async () => {
    await deletePolicy(idOf(request));
    audit(request, 'escalation_policy_delete', idOf(request), 'Escalation chain deleted');
    return { ok: true };
  }));
  app.post('/policies/:id/test', manage, async (request, reply) => respond(reply, async () => {
    const results = await testPolicy(idOf(request), userOf(request));
    audit(request, 'escalation_policy_test', idOf(request), 'Escalation chain test message sent', { results });
    return { results };
  }));

  app.get('/rules', read, async (_req, reply) => respond(reply, () => listRules()));
  app.post('/rules', manage, async (request, reply) => respond(reply, async () => {
    const r = await saveRule(null, ruleSchema.parse(request.body));
    audit(request, 'escalation_rule_create', r.id, 'Escalation rule created', { alertType: r.alertType, siteId: r.siteId, zoneId: r.zoneId, policyId: r.policyId });
    return r;
  }, 201));
  app.put('/rules/:id', manage, async (request, reply) => respond(reply, async () => {
    const r = await saveRule(idOf(request), ruleSchema.parse(request.body));
    audit(request, 'escalation_rule_update', r.id, 'Escalation rule updated', { alertType: r.alertType, siteId: r.siteId, zoneId: r.zoneId, policyId: r.policyId, enabled: r.enabled });
    return r;
  }));
  app.delete('/rules/:id', manage, async (request, reply) => respond(reply, async () => {
    await deleteRule(idOf(request));
    audit(request, 'escalation_rule_delete', idOf(request), 'Escalation rule deleted');
    return { ok: true };
  }));

  app.get('/preview', read, async (request, reply) => respond(reply, () => {
    const q = z.object({ alertType: z.string().min(1).max(64), cameraId: z.string().uuid().optional(), siteId: z.string().uuid().optional(), zoneId: z.string().uuid().optional() }).parse(request.query);
    return preview(q);
  }));

  app.post('/summary/send', manage, async (request, reply) => respond(reply, async () => {
    const r = await sendSummaryNow();
    audit(request, 'escalation_summary_send', 'summary', 'Daily alert summary sent on demand', r);
    return r;
  }));
}
