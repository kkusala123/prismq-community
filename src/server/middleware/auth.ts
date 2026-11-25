import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getAppConfig } from '../config.js';
import type { DbClient } from '../db/client.js';
import type { UserRole } from '../../shared/types.js';

export interface AuthTokenPayload {
  userId: string;
  username: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export function signAuthToken(payload: AuthTokenPayload): string {
  const cfg = getAppConfig();
  return jwt.sign(payload, cfg.jwtSecret, { expiresIn: '14d' });
}

export function verifyAuthToken(token: string): AuthTokenPayload {
  const cfg = getAppConfig();
  return jwt.verify(token, cfg.jwtSecret) as AuthTokenPayload;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function createAuthMiddlewares(db: DbClient) {
  const requireAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      res.status(401).json({ error: '请先登录后再进行此操作' });
      return;
    }
    try {
      const payload = verifyAuthToken(token);
      const { rows } = await db.query<{
        id: string;
        username: string;
        role: UserRole;
        is_disabled?: boolean;
      }>('SELECT id, username, role, is_disabled FROM users WHERE id = $1', [payload.userId]);
      if (rows.length === 0) {
        res.status(401).json({ error: '账号不存在或会话已失效，请重新登录' });
        return;
      }
      if (rows[0].is_disabled) {
        res.status(403).json({ error: '该账号已被管理员禁用，请联系系统管理员' });
        return;
      }
      req.user = {
        userId: rows[0].id,
        username: rows[0].username,
        role: rows[0].role,
      };
      next();
    } catch {
      res.status(401).json({ error: '登录凭证无效或已过期，请重新登录' });
    }
  };

  const optionalAuth = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      next();
      return;
    }
    try {
      const payload = verifyAuthToken(token);
      const { rows } = await db.query<{
        id: string;
        username: string;
        role: UserRole;
        is_disabled?: boolean;
      }>('SELECT id, username, role, is_disabled FROM users WHERE id = $1', [payload.userId]);
      if (rows.length > 0 && !rows[0].is_disabled) {
        req.user = {
          userId: rows[0].id,
          username: rows[0].username,
          role: rows[0].role,
        };
      }
    } catch {
      // 忽略无效 token，降级为访客
    }
    next();
  };

  const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || req.user.role !== 'admin') {
      res.status(403).json({ error: '仅系统管理员可执行此操作' });
      return;
    }
    next();
  };

  return { requireAuth, optionalAuth, requireAdmin };
}
