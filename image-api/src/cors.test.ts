import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { config } from './config/index.js';
import { corsOriginCheck } from './app.js';
import { errorHandler } from './middleware/error-handler.js';

describe('CORS origin check', () => {
  it('answers 403 (not 500) for an origin outside CORS_ALLOWED_ORIGINS', async () => {
    (config as any).corsAllowedOrigins = ['http://ok.local'];
    const app = Fastify();
    app.setErrorHandler(errorHandler);
    await app.register(cors, { origin: corsOriginCheck });
    app.get('/x', async () => ({ ok: true }));

    expect((await app.inject({ method: 'GET', url: '/x', headers: { origin: 'http://evil.local' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/x', headers: { origin: 'http://ok.local' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/x' })).statusCode).toBe(200);
  });
});
