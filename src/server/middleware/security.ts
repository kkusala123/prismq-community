import dns from 'node:dns/promises';
import net from 'node:net';
import cors, { type CorsOptions, type CorsRequest } from 'cors';
import type { NextFunction, Request, Response } from 'express';
import { getAppConfig, type AppConfig } from '../config.js';

/**
 * 生产/公网部署安全响应头：防止 MIME 嗅探、点击劫持，并在 HTTPS/反代终止 HTTPS 时下发 HSTS。
 */
export function securityHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (req.secure || forwardedProto === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}

function getRequestOrigin(req: CorsRequest & { protocol?: string }): string | null {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim();
  if (!host) return null;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = forwardedProto || req.protocol || 'http';
  return `${proto}://${host}`;
}

/**
 * 跨域资源共享中间件：
 * - 无 Origin 的原生 App（Android OkHttp）/ 健康检查 / CLI 请求直接放行
 * - 同源请求放行
 * - 生产环境按 CORS_ORIGINS / PUBLIC_URL 白名单精确校验 Origin，拒绝未授权跨域
 */
export function createCorsMiddleware(cfg: AppConfig) {
  const allowedSet = new Set(cfg.corsOrigins.map((o) => o.replace(/\/+$/, '')));

  return cors((req, callback) => {
    const reqOrigin = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    const baseOpts: CorsOptions = {
      exposedHeaders: ['Content-Disposition'],
      maxAge: 86400,
    };

    if (!reqOrigin) {
      callback(null, { ...baseOpts, origin: false });
      return;
    }

    const normalizedOrigin = reqOrigin.replace(/\/+$/, '');
    const sameOrigin = getRequestOrigin(req);
    if (sameOrigin && normalizedOrigin === sameOrigin) {
      callback(null, { ...baseOpts, origin: true });
      return;
    }

    if (allowedSet.size > 0) {
      callback(null, { ...baseOpts, origin: allowedSet.has(normalizedOrigin) });
      return;
    }

    // 未显式配置白名单时：开发环境放行本地联调（如 Vite），生产环境仅允许同源
    callback(null, { ...baseOpts, origin: cfg.nodeEnv !== 'production' });
  });
}

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message: string;
  keyPrefix: string;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * 轻量内存滑动窗口限流器（依赖 Express trust proxy 正确解析客户端真实 IP）。
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const buckets = new Map<string, RateBucket>();
  const cleanupMs = Math.max(30_000, Math.min(options.windowMs, 300_000));
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
      }
    }
  }, cleanupMs);
  timer.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (getAppConfig().disableRateLimit) {
      next();
      return;
    }

    const now = Date.now();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.keyPrefix}:${clientIp}`;

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 1, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    } else {
      bucket.count += 1;
    }

    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));

    if (bucket.count > options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({ error: options.message });
      return;
    }

    next();
  };
}

function isPrivateIpv4Bytes(b0: number, b1: number): boolean {
  if (b0 === 0) return true; // 0.0.0.0/8
  if (b0 === 10) return true; // 10.0.0.0/8
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true; // 100.64.0.0/10 CGNAT
  if (b0 === 127) return true; // 127.0.0.0/8 Loopback
  if (b0 === 169 && b1 === 254) return true; // 169.254.0.0/16 Link-local / Cloud Metadata
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true; // 172.16.0.0/12
  if (b0 === 192 && b1 === 168) return true; // 192.168.0.0/16
  if (b0 >= 224) return true; // Multicast & Reserved
  return false;
}

function parseIpv6Groups(addr: string): number[] | null {
  const zoneIdx = addr.indexOf('%');
  const bare = (zoneIdx >= 0 ? addr.slice(0, zoneIdx) : addr).toLowerCase();
  if (!bare) return null;

  const doubleColonParts = bare.split('::');
  if (doubleColonParts.length > 2) return null;

  const expandHalf = (half: string): number[] | null => {
    if (!half) return [];
    const tokens = half.split(':');
    const groups: number[] = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i];
      if (tok.includes('.')) {
        if (i !== tokens.length - 1 || net.isIPv4(tok) === false) return null;
        const octets = tok.split('.').map((n) => Number(n));
        if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null;
        }
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        groups.push(parseInt(tok, 16));
      }
    }
    return groups;
  };

  if (doubleColonParts.length === 1) {
    const groups = expandHalf(doubleColonParts[0]);
    return groups && groups.length === 8 ? groups : null;
  }

  const left = expandHalf(doubleColonParts[0]);
  const right = expandHalf(doubleColonParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...Array<number>(missing).fill(0), ...right];
}

export function isPrivateOrLocalIp(ip: string): boolean {
  const bare = ip.trim().replace(/^\[|\]$/g, '').split('%')[0];
  const ver = net.isIP(bare);
  if (ver === 4) {
    const parts = bare.split('.').map((n) => Number(n));
    return isPrivateIpv4Bytes(parts[0], parts[1]);
  }
  if (ver === 6) {
    const groups = parseIpv6Groups(bare);
    if (!groups) return true;

    const allZero = groups.every((g) => g === 0);
    if (allZero) return true; // ::

    const isLoopback = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
    if (isLoopback) return true; // ::1

    // ::ffff:0:0/96 IPv4-mapped IPv6
    const isV4Mapped =
      groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
    if (isV4Mapped) {
      const b0 = (groups[6] >> 8) & 0xff;
      const b1 = groups[6] & 0xff;
      return isPrivateIpv4Bytes(b0, b1);
    }

    const first = groups[0];
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 Unique local address
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 Link-local
    if ((first & 0xff00) === 0xff00) return true; // ff00::/8 Multicast
    return false;
  }
  return false;
}

const SSRF_BLOCK_MESSAGE =
  '个人自定义 API Base URL 仅允许公网 HTTP/HTTPS 域名，禁止访问本机或内网地址';

export function validateAiBaseUrlSync(
  rawUrl: string,
  options: { allowPrivate: boolean }
): string {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('AI 接口 Base URL 格式不合法，请输入完整的 http:// 或 https:// 地址');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI 接口 Base URL 仅支持 http:// 或 https:// 协议');
  }
  if (parsed.username || parsed.password) {
    throw new Error('AI 接口 Base URL 不得包含用户名或密码凭证');
  }
  if (!parsed.hostname) {
    throw new Error('AI 接口 Base URL 缺少有效主机名');
  }

  if (!options.allowPrivate) {
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      throw new Error(SSRF_BLOCK_MESSAGE);
    }

    const ipType = net.isIP(host);
    if (ipType === 0 && !host.includes('.')) {
      // 拦截 Docker/内网单标签主机名（如 postgres、redis）
      throw new Error(SSRF_BLOCK_MESSAGE);
    }
    if (ipType !== 0 && isPrivateOrLocalIp(host)) {
      throw new Error(SSRF_BLOCK_MESSAGE);
    }
  }

  return trimmed;
}

export async function assertSafeAiBaseUrl(
  rawUrl: string,
  options: { allowPrivate: boolean }
): Promise<string> {
  const validated = validateAiBaseUrlSync(rawUrl, options);
  if (!options.allowPrivate && getAppConfig().nodeEnv === 'production') {
    const parsed = new URL(validated);
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) === 0) {
      let records: Array<{ address: string; family: number }>;
      try {
        records = await dns.lookup(host, { all: true });
      } catch {
        throw new Error('AI 接口域名解析失败，请检查 Base URL 是否正确');
      }
      if (records.length === 0 || records.some((r) => isPrivateOrLocalIp(r.address))) {
        throw new Error(SSRF_BLOCK_MESSAGE);
      }
    }
  }
  return validated;
}
