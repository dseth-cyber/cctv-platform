import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logLevel,
  transport: config.nodeEnv === 'development'
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
    : undefined,
  redact: {
    paths: ['req.headers.authorization', 'req.body.password', 'req.body.smbPasswordEncrypted'],
    censor: '[REDACTED]',
  },
});
