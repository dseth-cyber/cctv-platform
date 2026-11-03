import { describe, it, expect, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { errorHandler } from './error-handler.js';

function mockReply() {
  const reply: any = { status: vi.fn(() => reply), send: vi.fn(async () => reply) };
  return reply;
}

function prismaError(code: string, message: string) {
  return new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });
}

describe('errorHandler', () => {
  it('maps a malformed UUID id (P2023) to 404', async () => {
    const reply = mockReply();
    await errorHandler(prismaError('P2023', 'Inconsistent column data: Error creating UUID, invalid length'), {} as any, reply);
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('keeps other P2023 data errors as 500', async () => {
    const reply = mockReply();
    await errorHandler(prismaError('P2023', 'Inconsistent column data: something else'), {} as any, reply);
    expect(reply.status).toHaveBeenCalledWith(500);
  });
});
