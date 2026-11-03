import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export async function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (error instanceof AppError) {
    logger.warn({ statusCode: error.statusCode, message: error.message }, 'Application error');
    await reply.status(error.statusCode).send({
      statusCode: error.statusCode,
      error: error.name,
      message: error.message,
      details: error.details,
    });
    return;
  }

  if (error instanceof ZodError) {
    logger.warn({ issues: error.issues }, 'Zod validation error');
    await reply.status(400).send({
      statusCode: 400,
      error: 'ValidationError',
      message: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
      details: error.issues,
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2003') {
      logger.warn({ meta: error.meta }, 'Foreign key constraint violation');
      await reply.status(409).send({
        statusCode: 409,
        error: 'ConflictError',
        message: 'This action is blocked by related records that still reference it.',
      });
      return;
    }
    // Malformed id (e.g. not a UUID): such a record cannot exist.
    if (error.code === 'P2023' && /UUID/i.test(error.message)) {
      logger.warn({ meta: error.meta }, 'Malformed record id');
      await reply.status(404).send({
        statusCode: 404,
        error: 'NotFoundError',
        message: 'The requested record was not found.',
      });
      return;
    }
    if (error.code === 'P2025') {
      logger.warn({ meta: error.meta }, 'Record not found for Prisma operation');
      await reply.status(404).send({
        statusCode: 404,
        error: 'NotFoundError',
        message: 'The requested record was not found.',
      });
      return;
    }
  }

  if (error.name === 'FastifyError' || error.name === 'FST_ERR_VALIDATION') {
    const statusCode = (error as FastifyError).statusCode ?? 400;
    logger.warn({ statusCode, message: error.message }, 'Fastify error');
    await reply.status(statusCode).send({
      statusCode,
      error: 'ValidationError',
      message: error.message,
    });
    return;
  }

  logger.error({ err: error }, 'Unhandled error');
  await reply.status(500).send({
    statusCode: 500,
    error: 'InternalServerError',
    message: 'An unexpected error occurred',
  });
}
