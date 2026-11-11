export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  // Which installation this is, for people (Release Center). NODE_ENV is 'production' in every container, the Dev
  // machine's too, so it cannot say. Unset means the Dev machine; the production server sets DEPLOY_ENV=production.
  deployEnv: process.env.DEPLOY_ENV ?? 'dev',
  host: process.env.HOST ?? '0.0.0.0',
  port: parseInt(process.env.PORT ?? '3002', 10),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  database: {
    url: process.env.DATABASE_URL ?? 'postgresql://image_user:image_pass@postgres:5432/image_db',
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'change-me',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },

  minio: {
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
    accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    bucket: process.env.MINIO_BUCKET ?? 'image-service',
    useSSL: process.env.MINIO_USE_SSL === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
  },

  storage: {
    localPath: process.env.LOCAL_STORAGE_PATH ?? '/data/images',
  },

  encryptionKey: process.env.ENCRYPTION_KEY ?? 'change-me',

  serviceApiKey: process.env.SERVICE_API_KEY ?? '',

  // Comma-separated list of allowed CORS origins (e.g. "https://images.lc.co.th"). Empty
  // means no cross-origin browser requests are allowed — the web app talks to this API
  // same-origin through nginx's proxy (see web-app/nginx.conf) regardless, so this only
  // matters for direct cross-origin callers.
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  notifications: {
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    },
    line: {
      accessToken: process.env.LINE_ACCESS_TOKEN ?? '',
    },
  },

  mediamtx: {
    apiUrl: process.env.MEDIAMTX_API_URL ?? 'http://localhost:9997',
    rtspUrl: process.env.MEDIAMTX_RTSP_URL ?? 'rtsp://localhost:8554',
    webrtcUrl: process.env.MEDIAMTX_WEBRTC_URL ?? 'http://localhost:8889',
    hlsUrl: process.env.MEDIAMTX_HLS_URL ?? 'http://localhost:8888',
    // Browser-facing MediaMTX playback server (recorded segments); nginx proxies /mediamtx/playback/.
    playbackUrl: process.env.MEDIAMTX_PLAYBACK_URL ?? '/mediamtx/playback',
    webhookSecret: process.env.MEDIA_WEBHOOK_SECRET ?? 'cctv-media-webhook-secret-dev',
  },

  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? 'http://localhost:5173',

  cctv: {
    maxConcurrentExports: parseInt(process.env.MAX_CONCURRENT_EXPORTS ?? '2', 10),
    // Longest clip one export may cover (wall-clock window, buffers included).
    maxExportHours: parseFloat(process.env.MAX_EXPORT_HOURS ?? '24'),
    diskWarningThresholdPct: parseInt(process.env.DISK_WARNING_THRESHOLD_PCT ?? '85', 10),
    diskCriticalThresholdPct: parseInt(process.env.DISK_CRITICAL_THRESHOLD_PCT ?? '92', 10),
    turnServerUrl: process.env.TURN_SERVER_URL ?? 'turn.cctv-local.lc.co.th:3478',
    turnSecret: process.env.TURN_SECRET ?? 'cctv-secure-turn-key-prod-default',
    seedSyntheticRecordings: process.env.SEED_SYNTHETIC_RECORDINGS === 'true',
  },
} as const;

// Fail closed rather than silently running with a guessable secret — this exact class
// of mistake (every secret left at its documented placeholder default) was found and
// fixed 2026-08-10; this stops it from happening silently again on a future deploy.
// Only enforced in production so local/dev setups without a full .env still work.
if (config.nodeEnv === 'production') {
  const weakDefaults: Record<string, string> = {
    JWT_SECRET: 'change-me',
    ENCRYPTION_KEY: 'change-me',
  };
  const problems: string[] = [];
  for (const [key, weak] of Object.entries(weakDefaults)) {
    const value = process.env[key];
    if (!value || value === weak) problems.push(key);
  }
  if (!process.env.SERVICE_API_KEY) problems.push('SERVICE_API_KEY');
  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production with missing/default secret(s): ${problems.join(', ')}. ` +
      'Set real values in .env (see .env.example) before deploying.',
    );
  }
}
