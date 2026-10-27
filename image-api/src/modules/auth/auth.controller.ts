import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginSchema, changePasswordSchema, refreshSchema, updateMenuPreferencesSchema, updatePreferencesSchema } from './auth.schema.js';
import * as authService from './auth.service.js';
import * as sessionService from './user-session.service.js';
import { config } from '../../config/index.js';
import type { AuthenticatedUser } from '../../types/index.js';
import { getUserPermissions } from '../../middleware/rbac.js';
import { getPrisma } from '../../lib/prisma.js';

async function loginHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = loginSchema.parse(request.body);
  const ipAddress = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || request.ip;

  const user = await authService.login(input, ipAddress);

  const accessToken = await reply.jwtSign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    { expiresIn: config.jwt.accessExpiresIn },
  );

  const refreshToken = await authService.createRefreshToken(user.id);
  const permissions = await getUserPermissions(user.id);

  // Track user session
  const userAgent = request.headers['user-agent'] || undefined;
  await sessionService.createSession({
    userId: user.id,
    username: user.username,
    ipAddress,
    userAgent,
  }).catch(() => {});

  return reply.status(200).send({
    accessToken,
    refreshToken,
    user: { ...user, permissions, lastLogin: new Date().toISOString() },
  });
}

async function refreshHandler(request: FastifyRequest, reply: FastifyReply) {
  const input = refreshSchema.parse(request.body);

  const user = await authService.verifyRefreshToken(input);

  const accessToken = await reply.jwtSign(
    { id: user.id, username: user.username, email: user.email, role: user.role },
    { expiresIn: config.jwt.accessExpiresIn },
  );

  const refreshToken = await authService.createRefreshToken(user.id);

  return reply.status(200).send({ accessToken, refreshToken });
}

async function meHandler(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as unknown as AuthenticatedUser | null;
  if (!user) {
    return reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Not authenticated' });
  }
  const [permissions, dbUser] = await Promise.all([
    getUserPermissions(user.id),
    getPrisma().user.findUnique({ where: { id: user.id }, select: { hiddenMenuItems: true, uiPreferences: true } }),
  ]);
  return reply.status(200).send({
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    permissions,
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
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    await authService.revokeRefreshToken(token);
  }
  // End the user session
  if (user?.id) {
    await sessionService.endSession(user.id).catch(() => {});
  }
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
