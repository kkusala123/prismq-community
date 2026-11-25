import { getAppConfig } from './config.js';
import { createDbClient } from './db/client.js';
import { createApp } from './app.js';
import { getAiJobManager } from './services/aiJobs.js';
import { startAppUpdatePoller, stopAppUpdatePoller } from './services/appUpdate.js';

const WEAK_JWT_SECRETS = new Set([
  'change-this-to-a-long-random-secret',
  'please_change_jwt_secret_key',
  'kaoshibao-pro-dev-secret-change-in-prod',
]);

async function bootstrap() {
  const cfg = getAppConfig();
  if (
    cfg.nodeEnv === 'production' &&
    (cfg.jwtSecret.length < 32 || WEAK_JWT_SECRETS.has(cfg.jwtSecret))
  ) {
    console.warn(
      '[棱题 · PrismQ][安全告警] 当前生产环境 JWT_SECRET 过短或仍为默认占位值！请立即更新为至少 32 位随机密钥（例如 openssl rand -hex 32）'
    );
  }
  const db = await createDbClient();
  const recovered = await getAiJobManager(db).recoverInterruptedJobs();
  if (recovered.recoveredFailed > 0 || recovered.requeued > 0) {
    console.log(
      `[棱题 · PrismQ] AI 后台任务恢复：标记中断 ${recovered.recoveredFailed} 个，重新入队 ${recovered.requeued} 个`
    );
  }

  const app = createApp(db);
  startAppUpdatePoller(db);
  const server = app.listen(cfg.port, '0.0.0.0', () => {
    console.log(`[棱题 · PrismQ] Server listening on http://0.0.0.0:${cfg.port} (DB: ${db.engine}, ENV: ${cfg.nodeEnv})`);
  });
  // 与 Nginx/OpenResty 默认 60s upstream keepalive 对齐，避免连接复用竞态 502
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;

  const shutdown = async (signal: string) => {
    console.log(`[棱题 · PrismQ] Received ${signal}, shutting down gracefully...`);
    stopAppUpdatePoller();
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[棱题 · PrismQ] Fatal startup error:', err);
  process.exit(1);
});
