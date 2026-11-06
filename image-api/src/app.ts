import Fastify from 'fastify';
import cors from '@fastify/cors';
import { ForbiddenError } from './lib/errors.js';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { mkdirSync, existsSync } from 'fs';

// Ensure incident attachments directory exists on startup
const ATTACHMENT_DIR = '/app/incident-attachments';
if (!existsSync(ATTACHMENT_DIR)) {
  mkdirSync(ATTACHMENT_DIR, { recursive: true });
}

import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { authenticate } from './middleware/auth.js';
import { authRoutes } from './modules/auth/auth.controller.js';
import { cameraRoutes } from './modules/cameras/cameras.controller.js';
import { deviceRoutes } from './modules/devices/devices.controller.js';
import { cameraGroupRoutes } from './modules/camera-groups/camera-groups.controller.js';
import { snapshotRoutes, startSnapshotScheduler, stopSnapshotScheduler } from './modules/snapshots/snapshots.controller.js';
import { siteRoutes } from './modules/sites/sites.controller.js';
import { recordingsRoutes } from './modules/recordings/recordings.controller.js';
import { mediaAuthRoutes } from './modules/media/media-auth.controller.js';
import { mediaNodeRoutes } from './modules/media-nodes/media-nodes.controller.js';
import { releaseRoutes } from './modules/release/release.controller.js';
import { cameraTemplateRoutes } from './modules/camera-templates/camera-templates.controller.js';
import { retentionRoutes } from './modules/retention/retention.controller.js';
import { healthRoutes } from './modules/health/health.controller.js';
import { storageProviderRoutes } from './modules/storage-providers/storage-providers.controller.js';
import { alertRoutes } from './modules/alerts/alerts.controller.js';
import { userRoutes } from './modules/users/users.controller.js';
import { roleRoutes } from './modules/roles/roles.controller.js';
import { alertRuleRoutes } from './modules/alert-rules/alert-rules.controller.js';
import { systemSettingsRoutes } from './modules/system-settings/system-settings.controller.js';
import { telegramUserRoutes } from './modules/telegram-bot/telegram-users.controller.js';
import { apiKeyRoutes } from './modules/api-keys/api-keys.controller.js';
import { masterdataRoutes } from './modules/masterdata/masterdata.controller.js';
import { systemConfigRoutes } from './modules/system-config/system-config.controller.js';
import { auditRoutes } from './modules/audit/audit.controller.js';
import { backupRoutes } from './modules/backup/backup.controller.js';
import { startBackupScheduler, stopBackupScheduler } from './modules/backup/backup-scheduler.js';
import { searchRoutes } from './modules/search/search.controller.js';
import { startRetentionSweeper, stopRetentionSweeper } from './modules/retention-sweeper/retention-sweeper.controller.js';
import { startMetricCollector, stopMetricCollector } from './modules/provider-metrics/provider-metric-collector.js';
import { startCameraHealthMonitor, stopCameraHealthMonitor } from './modules/cameras/camera-health-monitor.js';
import { startRecordingReconciler, stopRecordingReconciler } from './modules/recordings/segment-indexer.js';
import { startCameraPathSync, stopCameraPathSync } from './modules/media/path-sync.js';
import { startTelegramBot, stopTelegramBot } from './modules/telegram-bot/telegram-bot.service.js';
import { startSystemCleanup, stopSystemCleanup } from './modules/system-cleanup/system-cleanup.controller.js';
import { metricsRoutes } from './modules/metrics/metrics.controller.js';
import { storageRouter } from './lib/storage/storage-router.js';
import { getPrisma } from './lib/prisma.js';

/** Allows requests without an Origin and origins in CORS_ALLOWED_ORIGINS; others get 403 (was 500). */
export function corsOriginCheck(origin: string | undefined, cb: (err: Error | null, allow: boolean) => void): void {
  if (!origin || config.corsAllowedOrigins.includes(origin)) return cb(null, true);
  cb(new ForbiddenError('Origin not allowed by CORS'), false);
}

export async function buildApp() {
  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
  });

  app.setErrorHandler(errorHandler);

  await app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5MB
      files: 1,
    },
  });

  await app.register(cors, {
    // Reflecting any origin (the old `origin: true`) is a standard scanner-flagged
    // anti-pattern when combined with credentials: true. The web app itself never hits
    // this — it calls the API same-origin through nginx's proxy (web-app/nginx.conf) —
    // so this only gates direct cross-origin browser callers. Configure via
    // CORS_ALLOWED_ORIGINS (comma-separated); empty means no browser origin is allowed
    // (non-browser callers, which send no Origin header, are unaffected either way).
    origin: corsOriginCheck,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(jwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.accessExpiresIn },
  });

  await app.register(rateLimit, {
    max: 10000,
    timeWindow: '1 minute',
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Image Service API',
        description: 'Enterprise image management API for Smart Factory Platform',
        version: '1.0.0',
      },
      servers: [
        { url: `http://localhost:${config.port}`, description: 'Local' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  app.decorate('authenticate', authenticate);

  // /docs exposes the full API surface (every route + schema) — was previously public,
  // handing an attacker a ready-made map of the API with zero effort. Gated behind the
  // same authenticate() every other route uses; registered in its own scope so the
  // onRequest hook doesn't leak out and apply to unrelated routes.
  await app.register(async (docs) => {
    docs.addHook('onRequest', authenticate);
    await docs.register(swaggerUi, {
      routePrefix: '/docs',
      uiConfig: { docExpansion: 'list' },
    });
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/api/v1/auth' });
      await api.register(cameraRoutes, { prefix: '/api/v1/cameras' });
      await api.register(deviceRoutes, { prefix: '/api/v1/devices' });
      await api.register(cameraGroupRoutes, { prefix: '/api/v1/camera-groups' });
      await api.register(snapshotRoutes, { prefix: '/api/v1/snapshots' });
      await api.register(siteRoutes, { prefix: '/api/v1/sites' });
      await api.register(recordingsRoutes, { prefix: '/api/v1/recordings' });
      await api.register(mediaAuthRoutes, { prefix: '/api/v1/media' });
      await api.register(mediaNodeRoutes, { prefix: '/api/v1/media-nodes' });
      await api.register(cameraTemplateRoutes, { prefix: '/api/v1/camera-templates' });
      await api.register(retentionRoutes, { prefix: '/api/v1/retention-policies' });
      await api.register(healthRoutes, { prefix: '/api/v1/health' });
      await api.register(alertRoutes, { prefix: '/api/v1/alerts' });
      await api.register(userRoutes, { prefix: '/api/v1/users' });
      await api.register(roleRoutes, { prefix: '/api/v1/roles' });
      await api.register(alertRuleRoutes, { prefix: '/api/v1/alert-rules' });
      await api.register(systemSettingsRoutes, { prefix: '/api/v1/settings' });
      await api.register(telegramUserRoutes, { prefix: '/api/v1/telegram-users' });
      await api.register(apiKeyRoutes, { prefix: '/api/v1/api-keys' });
      await api.register(masterdataRoutes, { prefix: '/api/v1/masterdata' });
      await api.register(systemConfigRoutes, { prefix: '/api/v1/system-config' });
      await api.register(auditRoutes, { prefix: '/api/v1/audit-logs' });
      await api.register(backupRoutes, { prefix: '/api/v1/backup' });
      await api.register(storageProviderRoutes, { prefix: '/api/v1/storage-providers' });
      await api.register(metricsRoutes, { prefix: '/api/v1/metrics' });
      await api.register(searchRoutes, { prefix: '/api/v1/search' });
      await api.register(releaseRoutes, { prefix: '/api/v1/release' });

    },
  );

  app.get('/api/v1', async (_req, reply) => {
    return reply.status(200).send({
      service: 'image-api',
      version: '1.0.0',
      docs: '/docs',
    });
  });

  return app;
}

export async function startApp() {
  // Security: warn about default secrets in production
  if (config.nodeEnv === 'production') {
    if (config.jwt.secret === 'change-me') {
      logger.warn('SECURITY WARNING: JWT_SECRET is using the default value. Change it in production!');
    }
    if (config.encryptionKey === 'change-me') {
      logger.warn('SECURITY WARNING: ENCRYPTION_KEY is using the default value. Change it in production!');
    }
  }

  const app = await buildApp();

  startRetentionSweeper();
  startBackupScheduler();
  startMetricCollector();
  startCameraHealthMonitor();
  startRecordingReconciler();
  startCameraPathSync();
  startSnapshotScheduler();
  startSystemCleanup();
  startTelegramBot();

  try {
    const prisma = getPrisma();
    const providers = await prisma.storageProvider.findMany({ where: { deletedAt: null } });
    for (const p of providers) {
      storageRouter.register({
        id: p.id,
        name: p.name,
        type: p.type as any,
        config: p.config as any,
        isDefault: p.isDefault,
        isActive: p.isActive,
      });
    }
    logger.info({ count: storageRouter.size() }, 'Storage providers registered');

    await app.listen({ host: config.host, port: config.port });
    logger.info({ port: config.port, env: config.nodeEnv }, 'Server started');
    logger.info(`Swagger docs at http://${config.host}:${config.port}/docs`);
  } catch (err) {
    logger.fatal({ err }, 'Failed to start server');
    process.exit(1);
  }

  const gracefulShutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    stopRetentionSweeper();
    stopBackupScheduler();
    stopMetricCollector();
    stopCameraHealthMonitor();
    stopRecordingReconciler();
    stopCameraPathSync();
    stopSnapshotScheduler();
    stopSystemCleanup();
    stopTelegramBot();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  return app;
}
