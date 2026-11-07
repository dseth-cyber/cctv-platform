import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPrisma } from '../../lib/prisma.js';

async function searchHandler(request: FastifyRequest, reply: FastifyReply) {
  const { q } = request.query as { q: string };
  if (!q || q.length < 2) return reply.send({ results: [] });

  const prisma = getPrisma();

  const [cameras, alerts, users] = await Promise.all([
    prisma.camera.findMany({
      where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { ipAddress: { contains: q } }] },
      select: { id: true, name: true, status: true, ipAddress: true },
      take: 5,
    }),
    prisma.alert.findMany({
      where: { deletedAt: null, OR: [{ title: { contains: q, mode: 'insensitive' } }, { message: { contains: q, mode: 'insensitive' } }], resolvedAt: null },
      select: { id: true, title: true, severity: true },
      take: 5,
    }),
    prisma.user.findMany({
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
