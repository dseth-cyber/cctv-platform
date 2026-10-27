import type { FastifyRequest, FastifyReply } from 'fastify';
import { testConnection, listShares, browseDirectory } from './smb.service.js';

const testSchema = {
  type: 'object',
  required: ['smbSharePath', 'smbUsername', 'smbPasswordEncrypted'],
  properties: {
    smbSharePath: { type: 'string' },
    smbUsername: { type: 'string' },
    smbPasswordEncrypted: { type: 'string' },
    smbDomain: { type: 'string' },
  },
};

const listSharesSchema = {
  type: 'object',
  required: ['host', 'smbUsername', 'smbPasswordEncrypted'],
  properties: {
    host: { type: 'string' },
    smbUsername: { type: 'string' },
    smbPasswordEncrypted: { type: 'string' },
    smbDomain: { type: 'string' },
  },
};

const browseSchema = {
  type: 'object',
  required: ['smbSharePath', 'smbUsername', 'smbPasswordEncrypted'],
  properties: {
    smbSharePath: { type: 'string' },
    smbUsername: { type: 'string' },
    smbPasswordEncrypted: { type: 'string' },
    smbDomain: { type: 'string' },
    path: { type: 'string' },
  },
};

async function testConnectionHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = await testConnection(request.body as any);
  return reply.send(result);
}

async function listSharesHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = await listShares(request.body as any);
  return reply.send(result);
}

async function browseHandler(request: FastifyRequest, reply: FastifyReply) {
  const result = await browseDirectory(request.body as any);
  return reply.send(result);
}

export async function smbRoutes(app: any) {
  app.post('/smb/test-connection', { schema: { body: testSchema } }, testConnectionHandler);
  app.post('/smb/list-shares', { schema: { body: listSharesSchema } }, listSharesHandler);
  app.post('/smb/browse', { schema: { body: browseSchema } }, browseHandler);
}
