import Redis from 'ioredis';
import { config } from '../config/index.js';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      maxRetriesPerRequest: null,
    });
  }
  return redisClient;
}
