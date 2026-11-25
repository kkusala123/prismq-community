import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { DbClient } from '../db/client.js';
import { createAuthMiddlewares, signAuthToken } from '../middleware/auth.js';
import { createRateLimiter, validateAiBaseUrlSync } from '../middleware/security.js';
import { getSystemAIConfig, maskApiKey } from '../services/deepseek.js';
import { isPresent, sanitizeDisplayName, type PublicUser, type SystemPolicy, type UserRole, type UserSettings } from '../../shared/types.js';

interface UserDbRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  nickname: string;
  role: UserRole;
  is_disabled?: boolean;
  last_active_at?: string | Date | null;
  total_active_seconds?: number | string;
  settings: UserSettings;
  created_at: string;
}

export function getChinaDateString(date: Date = new Date()): string {
  return new Date(date.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getSystemPolicy(db: DbClient): Promise<SystemPolicy> {
  try {
    const { rows } = await db.query<{ value: Record<string, unknown> }>(
      `SELECT value FROM system_settings WHERE key = 'system_policy' LIMIT 1`
    );
    const val = rows[0]?.value;
    if (!val || typeof val !== 'object') {
      return { allowRegistration: true };
    }
    return {
      allowRegistration: val.allowRegistration !== false,
    };
  } catch {
    return { allowRegistration: true };
  }
}

function computeSystemAiVisible(
  role: UserRole,
  sysAi: Awaited<ReturnType<typeof getSystemAIConfig>>
): boolean {
  if (!sysAi.apiKey) return false;
  if (role === 'admin') return true;
  return sysAi.allowMemberUseSystemKey !== false;
}

function clampNumber(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(Math.min(max, Math.max(min, num)));
}

function toPublicUser(
  row: UserDbRow,
  sysAi: Awaited<ReturnType<typeof getSystemAIConfig>>
): PublicUser {
  const settings = row.settings || { removeAfterCorrectCount: 3, autoNextOnCorrect: true };
  const personalAi = settings.aiConfig;
  const hasPersonalAiKey = Boolean(personalAi?.apiKey && personalAi.apiKey.trim());

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    nickname: sanitizeDisplayName(row.nickname, row.username),
    role: row.role,
    isDisabled: Boolean(row.is_disabled),
    lastActiveAt: row.last_active_at ? new Date(row.last_active_at).toISOString() : null,
    totalActiveSeconds: Number(row.total_active_seconds ?? 0),
    settings: {
      removeAfterCorrectCount: Number(settings.removeAfterCorrectCount ?? 3) || 3,
      autoNextOnCorrect: settings.autoNextOnCorrect !== false,
      autoNextDelayMs: clampNumber(settings.autoNextDelayMs, 150, 2500, 650),
      switchAnimationMs: clampNumber(settings.switchAnimationMs, 0, 600, 260),
      aiConfig: personalAi
        ? {
            baseUrl: personalAi.baseUrl || 'https://api.deepseek.com/v1',
            model: personalAi.model || 'deepseek-chat',
            apiKey: maskApiKey(personalAi.apiKey || ''),
          }
        : undefined,
    },
    hasPersonalAiKey,
    systemAiAvailable: computeSystemAiVisible(row.role, sysAi),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export function createAuthRouter(db: DbClient): Router {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthMiddlewares(db);
  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 25,
    keyPrefix: 'auth:login',
    message: '登录尝试过于频繁，请 15 分钟后再试',
  });
  const registerLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 15,
    keyPrefix: 'auth:register',
    message: '注册请求过于频繁，请稍后再试',
  });

  router.get('/bootstrap-status', async (_req, res) => {
    try {
      const [{ rows }, policy] = await Promise.all([
        db.query<{ cnt: string | number }>('SELECT COUNT(*) AS cnt FROM users'),
        getSystemPolicy(db),
      ]);
      const needsSetup = Number(rows[0]?.cnt ?? 0) === 0;
      res.json({
        needsSetup,
        allowRegistration: needsSetup ? true : policy.allowRegistration,
      });
    } catch (err) {
      console.error('[bootstrap-status]', err);
      res.status(500).json({ error: '检查初始化状态失败' });
    }
  });

  router.post('/register', registerLimiter, async (req, res) => {
    try {
      const { rows: countRows } = await db.query<{ cnt: string | number }>('SELECT COUNT(*) AS cnt FROM users');
      const existingUsers = Number(countRows[0]?.cnt ?? 0);
      if (existingUsers > 0) {
        const policy = await getSystemPolicy(db);
        if (!policy.allowRegistration) {
          res.status(403).json({ error: '系统已关闭自助注册，请联系管理员开通账号' });
          return;
        }
      }

      const username = String(req.body?.username ?? '').trim();
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const nickname = sanitizeDisplayName(req.body?.nickname, username);

      if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username)) {
        res.status(400).json({ error: '用户名需为 3~32 位字母、数字、下划线或短横线' });
        return;
      }
      if (!email || !email.includes('@')) {
        res.status(400).json({ error: '请输入有效的邮箱地址' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: '密码长度不能少于 6 位' });
        return;
      }

      const { rows: dupRows } = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );
      if (dupRows.length > 0) {
        res.status(409).json({ error: '用户名或邮箱已被注册' });
        return;
      }

      const role: UserRole = existingUsers === 0 ? 'admin' : 'member';
      const passwordHash = await bcrypt.hash(password, 10);

      const { rows: inserted } = await db.query<UserDbRow>(
        `INSERT INTO users (username, email, password_hash, nickname, role, settings, last_active_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
         RETURNING *`,
        [
          username,
          email,
          passwordHash,
          nickname,
          role,
          JSON.stringify({ removeAfterCorrectCount: 3, autoNextOnCorrect: true }),
        ]
      );

      const sysAi = await getSystemAIConfig(db);
      const user = toPublicUser(inserted[0], sysAi);
      const token = signAuthToken({ userId: user.id, username: user.username, role: user.role });

      res.status(201).json({ token, user });
    } catch (err) {
      console.error('[register]', err);
      res.status(500).json({ error: '注册失败，请稍后重试' });
    }
  });

  router.post('/login', loginLimiter, async (req, res) => {
    try {
      const account = String(req.body?.account ?? req.body?.username ?? '').trim();
      const password = String(req.body?.password ?? '');
      if (!account || !password) {
        res.status(400).json({ error: '请输入账号和密码' });
        return;
      }

      const { rows } = await db.query<UserDbRow>(
        'SELECT * FROM users WHERE username = $1 OR email = $2 LIMIT 1',
        [account, account.toLowerCase()]
      );
      if (rows.length === 0) {
        res.status(401).json({ error: '账号或密码错误' });
        return;
      }

      const row = rows[0];
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) {
        res.status(401).json({ error: '账号或密码错误' });
        return;
      }

      if (row.is_disabled) {
        res.status(403).json({ error: '该账号已被管理员禁用，请联系系统管理员' });
        return;
      }

      await db.query('UPDATE users SET last_active_at = NOW() WHERE id = $1', [row.id]);
      row.last_active_at = new Date().toISOString();

      const sysAi = await getSystemAIConfig(db);
      const user = toPublicUser(row, sysAi);
      const token = signAuthToken({ userId: user.id, username: user.username, role: user.role });

      res.json({ token, user });
    } catch (err) {
      console.error('[login]', err);
      res.status(500).json({ error: '登录失败，请稍后重试' });
    }
  });

  router.post('/heartbeat', requireAuth, async (req, res) => {
    try {
      const rawDelta = req.body?.deltaSeconds;
      const numDelta = rawDelta !== undefined ? Number(rawDelta) : NaN;
      const delta = Number.isFinite(numDelta)
        ? Math.min(120, Math.max(1, Math.round(numDelta)))
        : 30;
      const rawMode = String(req.body?.mode ?? 'general').trim();
      const mode = rawMode === 'practice' || rawMode === 'exam' ? rawMode : 'general';
      const practiceDelta = mode === 'practice' ? delta : 0;
      const examDelta = mode === 'exam' ? delta : 0;
      const usageDate = getChinaDateString();
      const cleanPath = String(req.body?.path ?? '').trim().slice(0, 120);

      await db.query(
        `INSERT INTO user_usage_daily (
           user_id, usage_date, active_seconds, practice_seconds, exam_seconds, heartbeat_count, last_path, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, 1, $6, NOW())
         ON CONFLICT (user_id, usage_date) DO UPDATE SET
           active_seconds = user_usage_daily.active_seconds + EXCLUDED.active_seconds,
           practice_seconds = user_usage_daily.practice_seconds + EXCLUDED.practice_seconds,
           exam_seconds = user_usage_daily.exam_seconds + EXCLUDED.exam_seconds,
           heartbeat_count = user_usage_daily.heartbeat_count + 1,
           last_path = CASE WHEN EXCLUDED.last_path <> '' THEN EXCLUDED.last_path ELSE user_usage_daily.last_path END,
           updated_at = NOW()`,
        [req.user!.userId, usageDate, delta, practiceDelta, examDelta, cleanPath]
      );

      await db.query(
        `UPDATE users
         SET total_active_seconds = COALESCE(total_active_seconds, 0) + $1,
             last_active_at = NOW()
         WHERE id = $2`,
        [delta, req.user!.userId]
      );

      res.json({ ok: true, usageDate, addedSeconds: delta });
    } catch (err) {
      console.error('[heartbeat]', err);
      res.status(500).json({ error: '记录使用时长失败' });
    }
  });

  router.get('/me', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query<UserDbRow>('SELECT * FROM users WHERE id = $1', [req.user!.userId]);
      if (rows.length === 0) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }
      const sysAi = await getSystemAIConfig(db);
      res.json({ user: toPublicUser(rows[0], sysAi) });
    } catch (err) {
      console.error('[me]', err);
      res.status(500).json({ error: '获取用户信息失败' });
    }
  });

  router.put('/settings', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query<UserDbRow>('SELECT * FROM users WHERE id = $1', [req.user!.userId]);
      if (rows.length === 0) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }
      const current = rows[0];
      const existingSettings: UserSettings = current.settings || {
        removeAfterCorrectCount: 3,
        autoNextOnCorrect: true,
      };

      const currentNickname = sanitizeDisplayName(current.nickname, current.username);
      const nickname = isPresent(req.body?.nickname)
        ? sanitizeDisplayName(req.body.nickname, currentNickname)
        : currentNickname;
      const removeAfterCorrectCount = isPresent(req.body?.removeAfterCorrectCount)
        ? Math.min(20, Math.max(1, Number(req.body.removeAfterCorrectCount) || 3))
        : existingSettings.removeAfterCorrectCount;
      const autoNextOnCorrect = isPresent(req.body?.autoNextOnCorrect)
        ? Boolean(req.body.autoNextOnCorrect)
        : existingSettings.autoNextOnCorrect;
      const autoNextDelayMs = isPresent(req.body?.autoNextDelayMs)
        ? clampNumber(req.body.autoNextDelayMs, 150, 2500, 650)
        : clampNumber(existingSettings.autoNextDelayMs, 150, 2500, 650);
      const switchAnimationMs = isPresent(req.body?.switchAnimationMs)
        ? clampNumber(req.body.switchAnimationMs, 0, 600, 260)
        : clampNumber(existingSettings.switchAnimationMs, 0, 600, 260);

      let nextAiConfig = existingSettings.aiConfig;
      if (req.body?.clearPersonalAiKey) {
        nextAiConfig = undefined;
      } else if (req.body?.aiConfig && typeof req.body.aiConfig === 'object') {
        const incoming = req.body.aiConfig as { baseUrl?: string; apiKey?: string; model?: string };
        const rawKey = typeof incoming.apiKey === 'string' ? incoming.apiKey.trim() : '';
        // 如果传入的是脱敏字符串（包含 ****），保留原有真实 key
        const effectiveKey =
          rawKey && !rawKey.includes('****') ? rawKey : existingSettings.aiConfig?.apiKey || '';
        const rawBaseUrl = (
          incoming.baseUrl ||
          existingSettings.aiConfig?.baseUrl ||
          'https://api.deepseek.com/v1'
        ).trim();
        let safeBaseUrl = rawBaseUrl;
        try {
          safeBaseUrl = validateAiBaseUrlSync(rawBaseUrl, {
            allowPrivate: req.user!.role === 'admin',
          });
        } catch (err) {
          res.status(400).json({
            error: err instanceof Error ? err.message : '个人 AI Base URL 不合法',
          });
          return;
        }
        nextAiConfig = {
          baseUrl: safeBaseUrl,
          model: (incoming.model || existingSettings.aiConfig?.model || 'deepseek-chat').trim(),
          apiKey: effectiveKey,
        };
      }

      const nextSettings: UserSettings = {
        removeAfterCorrectCount,
        autoNextOnCorrect,
        autoNextDelayMs,
        switchAnimationMs,
        ...(nextAiConfig ? { aiConfig: nextAiConfig } : {}),
      };

      const { rows: updated } = await db.query<UserDbRow>(
        `UPDATE users SET nickname = $1, settings = $2::jsonb WHERE id = $3 RETURNING *`,
        [nickname, JSON.stringify(nextSettings), current.id]
      );

      const sysAi = await getSystemAIConfig(db);
      res.json({ user: toPublicUser(updated[0], sysAi) });
    } catch (err) {
      console.error('[update settings]', err);
      res.status(500).json({ error: '保存设置失败' });
    }
  });

  router.put('/password', requireAuth, async (req, res) => {
    try {
      const oldPassword = String(req.body?.oldPassword ?? '');
      const newPassword = String(req.body?.newPassword ?? '');
      if (newPassword.length < 6) {
        res.status(400).json({ error: '新密码长度不能少于 6 位' });
        return;
      }
      const { rows } = await db.query<UserDbRow>('SELECT * FROM users WHERE id = $1', [req.user!.userId]);
      if (rows.length === 0) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }
      const ok = await bcrypt.compare(oldPassword, rows[0].password_hash);
      if (!ok) {
        res.status(400).json({ error: '原密码不正确' });
        return;
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, rows[0].id]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[change password]', err);
      res.status(500).json({ error: '修改密码失败' });
    }
  });

  router.get('/admin/ai-config', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const cfg = await getSystemAIConfig(db);
      res.json({
        aiConfig: {
          baseUrl: cfg.baseUrl,
          model: cfg.model,
          apiKey: maskApiKey(cfg.apiKey),
          hasApiKey: Boolean(cfg.apiKey),
          allowMemberUseSystemKey: cfg.allowMemberUseSystemKey !== false,
        },
      });
    } catch (err) {
      console.error('[admin get ai config]', err);
      res.status(500).json({ error: '获取系统 AI 配置失败' });
    }
  });

  router.put('/admin/ai-config', requireAuth, requireAdmin, async (req, res) => {
    try {
      const current = await getSystemAIConfig(db);
      const rawKey = String(req.body?.apiKey ?? '').trim();
      const nextKey = req.body?.clearApiKey
        ? ''
        : rawKey && !rawKey.includes('****')
          ? rawKey
          : current.apiKey;

      const rawBaseUrl = String(
        req.body?.baseUrl || current.baseUrl || 'https://api.deepseek.com/v1'
      ).trim();
      let safeBaseUrl = rawBaseUrl;
      try {
        safeBaseUrl = validateAiBaseUrlSync(rawBaseUrl, { allowPrivate: true });
      } catch (err) {
        res.status(400).json({
          error: err instanceof Error ? err.message : '全局 AI Base URL 不合法',
        });
        return;
      }

      const nextCfg = {
        baseUrl: safeBaseUrl,
        model: String(req.body?.model || current.model || 'deepseek-chat').trim(),
        apiKey: nextKey,
        allowMemberUseSystemKey: isPresent(req.body?.allowMemberUseSystemKey)
          ? Boolean(req.body.allowMemberUseSystemKey)
          : current.allowMemberUseSystemKey !== false,
      };

      await db.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ('ai_config', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(nextCfg)]
      );

      res.json({
        aiConfig: {
          baseUrl: nextCfg.baseUrl,
          model: nextCfg.model,
          apiKey: maskApiKey(nextCfg.apiKey),
          hasApiKey: Boolean(nextCfg.apiKey),
          allowMemberUseSystemKey: nextCfg.allowMemberUseSystemKey,
        },
      });
    } catch (err) {
      console.error('[admin put ai config]', err);
      res.status(500).json({ error: '更新系统 AI 配置失败' });
    }
  });

  return router;
}
