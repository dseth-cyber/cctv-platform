import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema, changePasswordSchema, refreshSchema, updateMenuPreferencesSchema, updatePreferencesSchema } from './auth.schema.js';
import * as authService from './auth.service.js';
import * as sessionService from './user-session.service.js';
import * as deviceSessions from './device-sessions.js';
import { createAuditLog } from '../audit/audit.service.js';
import { config } from '../../config/index.js';
import type { AuthenticatedUser } from '../../types/index.js';
import { getUserPermissions } from '../../middleware/rbac.js';
import { getPrisma } from '../../lib/prisma.js';
import { scopeOfUser } from '../access/camera-scope.js';

async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = loginSchema.parse(request.body);
  const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip;

  const user = await authService.login(input, ipAddress);

  // One device = one session; past the limit, the device used least recently is signed out.
  const userAgent = request.headers['user-agent'] || undefined;
  const session = await deviceSessions.startSession({ userId: user.id, username: user.username, ipAddress, userAgent });
  await signOutExtraDevices(request, user, session.id);

  const accessToken = await reply.jwtSign(
    { id: user.id, username: user.username, email: user.email, role: user.role, sid: session.id },
    { expiresIn: config.jwt.accessExpiresIn },
  );

  const refreshToken = await authService.createRefreshToken(user.id, session.id);
  const permissions = await getUserPermissions(user.id);
  // Tells the page whether to offer what needs every camera, such as the audit log. The server checks again anyway.
  const allCameras = (await scopeOfUser(user.id)).all;

  return reply.status(200).send({
    accessToken,
    refreshToken,
    user: { ...user, permissions, allCameras, lastLogin: new Date().toISOString() },
  });
}

async function signOutExtraDevices(request: FastifyRequest, user: { id: string; username: string; role: string }, keepSessionId: string) {
  const limit = await deviceSessions.sessionLimitFor(user.role);
  const signedOut = await deviceSessions.enforceSessionLimit(user.id, keepSessionId, limit);
  if (signedOut.length === 0) return;
  createAuditLog({
    userId: user.id,
    action: 'session_replaced',
    entity: 'user_session',
    entityId: keepSessionId,
    description: `${user.username} signed in on another device; ${signedOut.length} older sign-in(s) ended (limit ${limit})`,
    metadata: { limit, ended: signedOut.map((s) => ({ id: s.id, ipAddress: s.ipAddress, lastActiveAt: s.lastActiveAt })) },
    ipAddress: request.ip,
  }).catch(() => {});
}

async function refreshHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = refreshSchema.parse(request.body);

  const user = await authService.verifyRefreshToken(input);

  // Tokens from before sessions were tracked get a session now, and count toward the limit from here on.
  let sessionId = user.sessionId ?? null;
  if (sessionId) {
    await deviceSessions.touchSession(sessionId);
  } else {
    const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip;
    const session = await deviceSessions.startSession({ userId: user.id, username: user.username, ipAddress, userAgent: request.headers['user-agent'] || undefined });
    sessionId = session.id;
    await signOutExtraDevices(request, user, session.id);
  }

  const accessToken = await reply.jwtSign(
    { id: user.id, username: user.username, email: user.email, role: user.role, sid: sessionId },
    { expiresIn: config.jwt.accessExpiresIn },
  );

  const refreshToken = await authService.createRefreshToken(user.id, sessionId);

  return reply.status(200).send({ accessToken, refreshToken });
}

async function meHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as unknown as AuthenticatedUser | null;
  if (!user) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' });
  }
  const [permissions, scope, dbUser] = await Promise.all([
    getUserPermissions(user.id),
    scopeOfUser(user.id),
    getPrisma().user.findUnique({ where: { id: user.id }, select: { hiddenMenuItems: true, uiPreferences: true } }),
  ]);
  return reply.status(200).send({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    permissions,
    allCameras: scope.all,
    hiddenMenuItems: Array.isArray(dbUser?.hiddenMenuItems) ? dbUser.hiddenMenuItems : [],
    uiPreferences: (dbUser?.uiPreferences && typeof dbUser.uiPreferences === 'object') ? dbUser.uiPreferences : {},
    lastLogin: null,
  });
}

async function updateMenuPreferencesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as unknown as AuthenticatedUser | null;
  if (!user) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' });
  }
  const input = updateMenuPreferencesSchema.parse(request.body);
  const result = await authService.updateMenuPreferences(user.id, input);
  return reply.status(200).send(result);
}

async function updatePreferencesHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as unknown as AuthenticatedUser | null;
  if (!user) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' });
  }
  const input = updatePreferencesSchema.parse(request.body);
  const result = await authService.updateUiPreferences(user.id, input.patch);
  return reply.status(200).send(result);
}

async function changePasswordHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as unknown as AuthenticatedUser | null;
  if (!user) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' });
  }
  const input = changePasswordSchema.parse(request.body);
  await authService.changePassword(user.id, input);
  return reply.status(204).send();
}

async function logoutHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as unknown as AuthenticatedUser | null;
  // This device only: its session and the refresh tokens that keep it alive. (Before, the access token was passed
  // as if it were a refresh token, so the real refresh token stayed valid for its 7 days.)
  if (user?.sid) {
    await deviceSessions.endSession(user.sid).catch(() => {});
  } else if (user?.id) {
    await sessionService.endSession(user.id).catch(() => {});
  }
  const body = (request.body ?? {}) as { refreshToken?: string };
  if (typeof body.refreshToken === 'string' && body.refreshToken) await authService.revokeRefreshToken(body.refreshToken);
  return reply.status(204).send();
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/login', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    },
  }, loginHandler);
  app.post('/refresh', refreshHandler);
  app.get('/me', { preHandler: [app.authenticate] }, meHandler);
  app.patch('/me/menu-preferences', { preHandler: [app.authenticate] }, updateMenuPreferencesHandler);
  app.patch('/me/preferences', { preHandler: [app.authenticate] }, updatePreferencesHandler);
  app.post('/change-password', { preHandler: [app.authenticate] }, changePasswordHandler);
  app.post('/logout', { preHandler: [app.authenticate] }, logoutHandler);
}
