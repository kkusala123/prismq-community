export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  pgliteDataDir: string;
  jwtSecret: string;
  deepseekBaseUrl: string;
  deepseekApiKey: string;
  deepseekModel: string;
  seedDemoData: boolean;
  publicUrl: string;
  corsOrigins: string[];
  trustProxy: boolean | number | string;
  disableRateLimit: boolean;
  githubRepo: string;
  githubToken: string;
  appUpdateCacheDir: string;
  appUpdatePollIntervalMinutes: number;
  wechatAppId: string;
  wechatAppSecret: string;
}

function normalizeOriginEntry(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.origin;
    }
  } catch {
    // ignore malformed URL and keep trimmed literal
  }
  return trimmed;
}

function parseCorsOrigins(rawEnv: string | undefined, publicUrl: string): string[] {
  const origins = new Set<string>();
  if (rawEnv) {
    for (const part of rawEnv.split(',')) {
      const normalized = normalizeOriginEntry(part);
      if (normalized) origins.add(normalized);
    }
  }
  if (publicUrl) {
    const normalizedPublic = normalizeOriginEntry(publicUrl);
    if (normalizedPublic) origins.add(normalizedPublic);
  }
  return Array.from(origins);
}

function parseTrustProxy(rawEnv: string | undefined, nodeEnv: string): boolean | number | string {
  const raw = (rawEnv ?? '').trim();
  if (!raw) {
    return nodeEnv === 'production' ? 1 : false;
  }
  const lower = raw.toLowerCase();
  if (lower === 'false' || lower === '0') return false;
  if (lower === 'true') return true;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

export function getAppConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const publicUrl = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return {
    port: Number(process.env.PORT || 3000),
    nodeEnv,
    databaseUrl: (process.env.DATABASE_URL || '').trim(),
    pgliteDataDir: process.env.PGLITE_DATA_DIR || './data/pglite',
    jwtSecret: process.env.JWT_SECRET || 'kaoshibao-pro-dev-secret-change-in-prod',
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
    deepseekApiKey: (process.env.DEEPSEEK_API_KEY || '').trim(),
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    seedDemoData: process.env.SEED_DEMO_DATA === 'true',
    publicUrl,
    corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS, publicUrl),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY, nodeEnv),
    disableRateLimit: process.env.DISABLE_RATE_LIMIT === 'true',
    githubRepo: (process.env.GITHUB_REPO || '').trim(),
    githubToken: (process.env.GITHUB_TOKEN || '').trim(),
    appUpdateCacheDir: (process.env.APP_UPDATE_CACHE_DIR || './data/updates').trim(),
    appUpdatePollIntervalMinutes: Math.max(1, Number(process.env.APP_UPDATE_POLL_INTERVAL_MINUTES || 15) || 15),
    // 微信小程序「一键登录」：AppID 与 AppSecret 只从服务端环境变量读取，绝不下发到客户端
    wechatAppId: (process.env.WECHAT_APPID || '').trim(),
    wechatAppSecret: (process.env.WECHAT_APPSECRET || '').trim(),
  };
}
