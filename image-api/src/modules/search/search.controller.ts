import { allowedAlertSources, cameraWhere } from '../access/camera-scope.js';
import { getUserPermissions } from '../../middleware/rbac.js';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';

async function searchHandler(request: FastifyRequest, reply: FastifyReply) {
  const { q } = request.query as { q: string };
  if (!q || q.length < 2) return reply.send({ results: [] });

  const prisma = getPrisma();
  const scope = await cameraWhere(request);
  const sources = await allowedAlertSources(request);
  const permissions = await getUserPermissions((request as any).user?.id ?? '');
  const may = (permission: string) => permissions.includes('*') || permissions.includes(permission);

  const [cameras, alerts, users] = await Promise.all([
    !may('cameras:read') ? Promise.resolve([]) : prisma.camera.findMany({
      where: { deletedAt: null, ...(scope ? { AND: [scope] } : {}), OR: [{ name: { contains: q, mode: 'insensitive' } }, { ipAddress: { contains: q } }] },
      select: { id: true, name: true, status: true, ipAddress: true },
      take: 5,
    }),
    !may('alerts:read') ? Promise.resolve([]) : prisma.alert.findMany({
      where: { deletedAt: null, ...(sources ? { source: { in: sources } } : {}), OR: [{ title: { contains: q, mode: 'insensitive' } }, { message: { contains: q, mode: 'insensitive' } }], resolvedAt: null },
      select: { id: true, title: true, severity: true },
      take: 5,
    }),
    !may('users:read') ? Promise.resolve([]) : prisma.user.findMany({
      where: { OR: [{ username: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] },
      select: { id: true, username: true, role: true },
      take: 5,
    }),
  ]);

  return reply.send({
    results: [
      ...cameras.map(c => ({ type: 'camera', id: c.id, title: c.name, subtitle: `${c.status} · ${c.ipAddress}`, url: `/cctv/cameras?q=${encodeURIComponent(c.name)}` })),
      ...alerts.map(a => ({ type: 'alert', id: a.id, title: a.title, subtitle: a.severity, url: `/cctv/alerts?q=${encodeURIComponent(a.title)}` })),
      ...users.map(u => ({ type: 'user', id: u.id, title: u.username, subtitle: u.role, url: `/cctv/users?q=${encodeURIComponent(u.username)}` })),
    ],
  });
}

export async function searchRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', { preHandler: [app.authenticate] }, searchHandler);
}
