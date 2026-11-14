import type { FastifyReply, FastifyRequest } from 'fastify';
import { getPrisma } from './prisma.js';

/**
 * Destructive actions ask for the signed-in person's password again (body `{ password }`).
 * Sends the refusal itself (400 PASSWORD_REQUIRED / 403 INVALID_PASSWORD) and returns false.
 */
export async function passwordConfirmed(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const user = (request as any).user;
  const { password } = (request.body ?? {}) as { password?: string };
  if (!password) {
    reply.status(400).send({ error: 'Password required', code: 'PASSWORD_REQUIRED' });
    return false;
  }
  const dbUser = user?.id ? await getPrisma().user.findUnique({ where: { id: user.id } }) : null;
  const bcrypt = await import('bcryptjs');
  const compare = bcrypt.default?.compare || bcrypt.compare;
  if (!dbUser || !(await compare(password, dbUser.password))) {
    reply.status(403).send({ error: 'Invalid password', code: 'INVALID_PASSWORD' });
    return false;
  }
  return true;
}
