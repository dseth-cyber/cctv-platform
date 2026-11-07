import type { FastifyReply, FastifyRequest } from 'fastify';
import crypto from 'node:crypto';
import { UnauthorizedError } from '../lib/errors.js';
import { config } from '../config/index.js';
import { getPrisma } from '../lib/prisma.js';

const SERVICE_USER_ID = 'system-service';

export interface AuthenticatedUser {
  id: string;
  username: string;
  email: string;
  role: string;
}

// Plain `===` leaks how many leading bytes matched via response-time differences —
// timingSafeEqual doesn't. Lengths are compared first (a length mismatch also leaks
// via timing, but that's a far smaller signal than a byte-by-byte match position, and
// timingSafeEqual requires equal-length buffers anyway).
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * A token proves who someone was when it was issued. Whether that account still exists and is switched on is read
 * every time, so ending an account takes effect at once. This sits outside the token check on purpose: the database
 * being unavailable has to stay an error, not turn into "your token is invalid" and sign everyone out.
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await verifyToken(request, reply);
  const user = (request as unknown as { user: AuthenticatedUser }).user;
  if (user.id === SERVICE_USER_ID) return;
  const account = await getPrisma().user.findUnique({ where: { id: user.id }, select: { enabled: true, deletedAt: true } });
  if (!account || !account.enabled || account.deletedAt) throw new UnauthorizedError('This account is no longer active');
}

async function verifyToken(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Service-to-service API key authentication
  const apiKey = request.headers['x-service-api-key'];
  const apiKeyStr = Array.isArray(apiKey) ? apiKey[0] : apiKey;
  if (apiKeyStr && config.serviceApiKey && safeEqual(apiKeyStr, config.serviceApiKey)) {
    (request as unknown as { user: AuthenticatedUser }).user = {
      id: SERVICE_USER_ID,
      username: 'system',
      email: 'system@image-service.local',
      role: 'system',
    };
    return;
  }

  // JWT authentication
  try {
    await request.jwtVerify();
    const payload = request.user as unknown as AuthenticatedUser;
    if (!payload || !payload.id) {
      throw new UnauthorizedError('Invalid token payload');
    }
  } catch (err) {
    // Fallback: token in query parameter (for GET file downloads via window.open)
    if (request.method === 'GET') {
      const queryToken = (request.query as Record<string, string>)?.['token'];
      if (queryToken) {
        try {
          const decoded = request.server.jwt.verify(queryToken) as AuthenticatedUser;
          if (decoded && decoded.id) {
            (request as unknown as { user: AuthenticatedUser }).user = {
              id: decoded.id, username: decoded.username ?? 'unknown',
              email: decoded.email ?? '', role: decoded.role ?? 'user',
            };
            return;
          }
        } catch { /* fall through to error */ }
      }
    }
    if (err instanceof UnauthorizedError) {
      throw err;
    }
    throw new UnauthorizedError('Invalid or expired token');
  }
}
