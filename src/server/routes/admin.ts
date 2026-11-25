import { Router } from 'express';
import bcrypt from 'bcryptjs';
import type { DbClient } from '../db/client.js';
import { createAuthMiddlewares, type AuthTokenPayload } from '../middleware/auth.js';
import { getChinaDateString, getSystemPolicy } from './auth.js';
import {
  isPresent,
  sanitizeDisplayName,
  type AdminAiJobItem,
  type AdminAuditLogItem,
  type AdminBankItem,
  type AdminExamItem,
  type AdminOverview,
  type AdminUsageDailyPoint,
  type AdminUsageResponse,
  type AdminUsageUserRank,
  type AdminUserItem,
  type UserRole,
} from '../../shared/types.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(val: string): boolean {
  return UUID_RE.test(val);
}

function getChinaDateOffset(daysAgo: number): string {
  const now = new Date(Date.now() - daysAgo * 86400 * 1000);
  return getChinaDateString(now);
}

function getChinaDayUtcStartIso(chinaDateStr: string): string {
  return new Date(`${chinaDateStr}T00:00:00+08:00`).toISOString();
}

async function writeAuditLog(
  db: DbClient,
  actor: AuthTokenPayload,
  action: string,
  targetType: string,
  targetId: string,
  targetLabel: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO admin_audit_logs (actor_id, actor_name, action, target_type, target_id, target_label, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [actor.userId, actor.username, action, targetType, targetId, targetLabel, JSON.stringify(detail)]
    );
  } catch (err) {
    console.error('[admin audit log]', err);
  }
}

export function createAdminRouter(db: DbClient): Router {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthMiddlewares(db);

  router.use(requireAuth, requireAdmin);

  async function countActiveAdmins(): Promise<number> {
    const { rows } = await db.query<{ cnt: string | number }>(
      `SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin' AND COALESCE(is_disabled, FALSE) = FALSE`
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /* -------------------- 1. 总览看板 -------------------- */
  router.get('/overview', async (_req, res) => {
    try {
      const todayDate = getChinaDateString();
      const last7dStart = getChinaDateOffset(6);
      const trendStart = getChinaDateOffset(13);
      const todayUtcStart = getChinaDayUtcStartIso(todayDate);
      const last7dUtcStart = getChinaDayUtcStartIso(last7dStart);

      const [
        policy,
        userStatsRes,
        activeCountRes,
        contentRes,
        learningRes,
        examRes,
        aiRes,
        usageRes,
        trendRes,
      ] = await Promise.all([
        getSystemPolicy(db),
        db.query<Record<string, unknown>>(
          `SELECT
             COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) AS admins,
             COALESCE(SUM(CASE WHEN COALESCE(is_disabled, FALSE) = TRUE THEN 1 ELSE 0 END), 0) AS disabled,
             COALESCE(SUM(COALESCE(total_active_seconds, 0)), 0) AS total_seconds
           FROM users`
        ),
        db.query<{ today_active: string | number; last7d_active: string | number }>(
          `SELECT
             (SELECT COUNT(DISTINCT user_id) FROM (
               SELECT user_id FROM user_usage_daily WHERE usage_date = $1 AND active_seconds > 0
               UNION
               SELECT id AS user_id FROM users WHERE last_active_at >= $2::timestamptz
             ) t1) AS today_active,
             (SELECT COUNT(DISTINCT user_id) FROM (
               SELECT user_id FROM user_usage_daily WHERE usage_date >= $3 AND active_seconds > 0
               UNION
               SELECT id AS user_id FROM users WHERE last_active_at >= $4::timestamptz
             ) t2) AS last7d_active`,
          [todayDate, todayUtcStart, last7dStart, last7dUtcStart]
        ),
        db.query<Record<string, unknown>>(
          `SELECT
             (SELECT COUNT(*) FROM question_banks) AS total_banks,
             (SELECT COUNT(*) FROM question_banks WHERE visibility = 'public') AS public_banks,
             (SELECT COUNT(*) FROM question_banks WHERE visibility = 'private') AS private_banks,
             (SELECT COUNT(*) FROM questions) AS total_questions,
             (SELECT COUNT(*) FROM questions WHERE star_rating > 0) AS rated_questions`
        ),
        db.query<Record<string, unknown>>(
          `SELECT
             COALESCE(SUM(answered_count), 0) AS total_answered,
             COALESCE(SUM(correct_count), 0) AS total_correct
           FROM user_question_records`
        ),
        db.query<Record<string, unknown>>(
          `SELECT
             (SELECT COUNT(*) FROM exams) AS total_exams,
             (SELECT COUNT(*) FROM exams WHERE status = 'active') AS active_exams,
             (SELECT COUNT(*) FROM exam_submissions) AS total_submissions`
        ),
        db.query<Record<string, unknown>>(
          `SELECT
             COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END), 0) AS running,
             COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
           FROM ai_conversion_jobs`
        ),
        db.query<Record<string, unknown>>(
          `SELECT
             COALESCE(SUM(CASE WHEN usage_date = $1 THEN active_seconds ELSE 0 END), 0) AS today_seconds,
             COALESCE(SUM(CASE WHEN usage_date >= $2 THEN active_seconds ELSE 0 END), 0) AS last7d_seconds
           FROM user_usage_daily`,
          [todayDate, last7dStart]
        ),
        db.query<Record<string, unknown>>(
          `SELECT
             usage_date,
             COUNT(DISTINCT CASE WHEN active_seconds > 0 THEN user_id END) AS active_users,
             COALESCE(SUM(active_seconds), 0) AS active_seconds,
             COALESCE(SUM(practice_seconds), 0) AS practice_seconds,
             COALESCE(SUM(exam_seconds), 0) AS exam_seconds
           FROM user_usage_daily
           WHERE usage_date >= $1
           GROUP BY usage_date
           ORDER BY usage_date ASC`,
          [trendStart]
        ),
      ]);

      const uRow = userStatsRes.rows[0] || {};
      const aRow = activeCountRes.rows[0] || { today_active: 0, last7d_active: 0 };
      const cRow = contentRes.rows[0] || {};
      const lRow = learningRes.rows[0] || {};
      const eRow = examRes.rows[0] || {};
      const aiRow = aiRes.rows[0] || {};
      const usRow = usageRes.rows[0] || {};

      const totalAnswered = Number(lRow.total_answered ?? 0);
      const totalCorrect = Number(lRow.total_correct ?? 0);
      const accuracyPercent = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

      const trendMap = new Map<string, AdminUsageDailyPoint>();
      for (const r of trendRes.rows) {
        const d = String(r.usage_date);
        trendMap.set(d, {
          date: d,
          activeUsers: Number(r.active_users ?? 0),
          activeSeconds: Number(r.active_seconds ?? 0),
          practiceSeconds: Number(r.practice_seconds ?? 0),
          examSeconds: Number(r.exam_seconds ?? 0),
        });
      }

      const dailyTrend: AdminUsageDailyPoint[] = [];
      for (let i = 13; i >= 0; i -= 1) {
        const d = getChinaDateOffset(i);
        dailyTrend.push(
          trendMap.get(d) || {
            date: d,
            activeUsers: 0,
            activeSeconds: 0,
            practiceSeconds: 0,
            examSeconds: 0,
          }
        );
      }

      const overview: AdminOverview = {
        dbEngine: db.engine,
        policy,
        users: {
          total: Number(uRow.total ?? 0),
          admins: Number(uRow.admins ?? 0),
          disabled: Number(uRow.disabled ?? 0),
          todayActive: Number(aRow.today_active ?? 0),
          last7dActive: Number(aRow.last7d_active ?? 0),
        },
        content: {
          totalBanks: Number(cRow.total_banks ?? 0),
          publicBanks: Number(cRow.public_banks ?? 0),
          privateBanks: Number(cRow.private_banks ?? 0),
          totalQuestions: Number(cRow.total_questions ?? 0),
          ratedQuestions: Number(cRow.rated_questions ?? 0),
        },
        learning: {
          totalAnswered,
          totalCorrect,
          accuracyPercent,
        },
        exams: {
          totalExams: Number(eRow.total_exams ?? 0),
          activeExams: Number(eRow.active_exams ?? 0),
          totalSubmissions: Number(eRow.total_submissions ?? 0),
        },
        aiJobs: {
          total: Number(aiRow.total ?? 0),
          running: Number(aiRow.running ?? 0),
          failed: Number(aiRow.failed ?? 0),
        },
        usage: {
          todaySeconds: Number(usRow.today_seconds ?? 0),
          last7dSeconds: Number(usRow.last7d_seconds ?? 0),
          totalSeconds: Number(uRow.total_seconds ?? 0),
        },
        dailyTrend,
      };

      res.json(overview);
    } catch (err) {
      console.error('[admin overview]', err);
      res.status(500).json({ error: '加载系统管理概览失败' });
    }
  });

  /* -------------------- 2. 用户管理 -------------------- */
  router.get('/users', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim();
      const role = String(req.query.role ?? '').trim();
      const status = String(req.query.status ?? '').trim();
      const sort = String(req.query.sort ?? 'usage_desc').trim();

      const todayDate = getChinaDateString();
      const last7dStart = getChinaDateOffset(6);

      const params: unknown[] = [todayDate, last7dStart];
      const clauses: string[] = ['1 = 1'];

      if (q) {
        params.push(`%${q}%`);
        clauses.push(
          `(u.username ILIKE $${params.length} OR u.nickname ILIKE $${params.length} OR u.email ILIKE $${params.length})`
        );
      }
      if (role === 'admin' || role === 'member') {
        params.push(role);
        clauses.push(`u.role = $${params.length}`);
      }
      if (status === 'disabled') {
        clauses.push(`COALESCE(u.is_disabled, FALSE) = TRUE`);
      } else if (status === 'active') {
        clauses.push(`COALESCE(u.is_disabled, FALSE) = FALSE`);
      }

      const orderMap: Record<string, string> = {
        usage_desc: 'COALESCE(u.total_active_seconds, 0) DESC, u.created_at DESC',
        last_active: 'u.last_active_at DESC NULLS LAST, u.created_at DESC',
        created_desc: 'u.created_at DESC',
        questions_desc: 'answered_count DESC, u.created_at DESC',
      };
      const orderBy = orderMap[sort] || orderMap.usage_desc;

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT
           u.id,
           u.username,
           u.email,
           u.nickname,
           u.role,
           COALESCE(u.is_disabled, FALSE) AS is_disabled,
           u.created_at,
           u.last_active_at,
           COALESCE(u.total_active_seconds, 0) AS total_active_seconds,
           COALESCE(usage_agg.today_seconds, 0) AS today_active_seconds,
           COALESCE(usage_agg.last7d_seconds, 0) AS last7d_active_seconds,
           COALESCE(usage_agg.practice_seconds, 0) AS practice_seconds,
           COALESCE(usage_agg.exam_seconds, 0) AS exam_seconds,
           COALESCE(bank_agg.bank_count, 0) AS bank_count,
           COALESCE(bank_agg.question_count, 0) AS question_count,
           COALESCE(rec_agg.answered_count, 0) AS answered_count,
           COALESCE(sub_agg.submission_count, 0) AS submission_count
         FROM users u
         LEFT JOIN (
           SELECT
             user_id,
             COALESCE(SUM(CASE WHEN usage_date = $1 THEN active_seconds ELSE 0 END), 0) AS today_seconds,
             COALESCE(SUM(CASE WHEN usage_date >= $2 THEN active_seconds ELSE 0 END), 0) AS last7d_seconds,
             COALESCE(SUM(practice_seconds), 0) AS practice_seconds,
             COALESCE(SUM(exam_seconds), 0) AS exam_seconds
           FROM user_usage_daily
           GROUP BY user_id
         ) usage_agg ON usage_agg.user_id = u.id
         LEFT JOIN (
           SELECT
             b.owner_id,
             COUNT(DISTINCT b.id) AS bank_count,
             COUNT(DISTINCT q.id) AS question_count
           FROM question_banks b
           LEFT JOIN questions q ON q.bank_id = b.id
           GROUP BY b.owner_id
         ) bank_agg ON bank_agg.owner_id = u.id
         LEFT JOIN (
           SELECT
             user_id,
             COALESCE(SUM(answered_count), 0) AS answered_count
           FROM user_question_records
           GROUP BY user_id
         ) rec_agg ON rec_agg.user_id = u.id
         LEFT JOIN (
           SELECT
             user_id,
             COUNT(*) AS submission_count
           FROM exam_submissions
           WHERE user_id IS NOT NULL
           GROUP BY user_id
         ) sub_agg ON sub_agg.user_id = u.id
         WHERE ${clauses.join(' AND ')}
         ORDER BY ${orderBy}`,
        params
      );

      const users: AdminUserItem[] = rows.map((r) => {
        const uname = String(r.username);
        return {
          id: String(r.id),
          username: uname,
          email: String(r.email),
          nickname: sanitizeDisplayName(r.nickname, uname),
          role: (r.role as UserRole) || 'member',
          isDisabled: Boolean(r.is_disabled),
          createdAt: new Date(String(r.created_at)).toISOString(),
          lastActiveAt: r.last_active_at ? new Date(String(r.last_active_at)).toISOString() : null,
          totalActiveSeconds: Number(r.total_active_seconds ?? 0),
          todayActiveSeconds: Number(r.today_active_seconds ?? 0),
          last7dActiveSeconds: Number(r.last7d_active_seconds ?? 0),
          practiceSeconds: Number(r.practice_seconds ?? 0),
          examSeconds: Number(r.exam_seconds ?? 0),
          bankCount: Number(r.bank_count ?? 0),
          questionCount: Number(r.question_count ?? 0),
          answeredCount: Number(r.answered_count ?? 0),
          submissionCount: Number(r.submission_count ?? 0),
        };
      });

      res.json({ users });
    } catch (err) {
      console.error('[admin list users]', err);
      res.status(500).json({ error: '获取用户列表失败' });
    }
  });

  router.post('/users', async (req, res) => {
    try {
      const username = String(req.body?.username ?? '').trim();
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      const nickname = String(req.body?.nickname ?? username).trim();
      const role: UserRole = req.body?.role === 'admin' ? 'admin' : 'member';

      if (!/^[a-zA-Z0-9_\-]{3,32}$/.test(username)) {
        res.status(400).json({ error: '用户名需为 3~32 位字母、数字、下划线或短横线' });
        return;
      }
      if (!email || !email.includes('@')) {
        res.status(400).json({ error: '请输入有效的邮箱地址' });
        return;
      }
      if (password.length < 6) {
        res.status(400).json({ error: '初始密码长度不能少于 6 位' });
        return;
      }

      const { rows: dup } = await db.query<{ id: string }>(
        'SELECT id FROM users WHERE username = $1 OR email = $2',
        [username, email]
      );
      if (dup.length > 0) {
        res.status(409).json({ error: '用户名或邮箱已存在' });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const { rows: inserted } = await db.query<Record<string, unknown>>(
        `INSERT INTO users (username, email, password_hash, nickname, role, settings)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING id, username, email, nickname, role, COALESCE(is_disabled, FALSE) AS is_disabled, created_at`,
        [
          username,
          email,
          passwordHash,
          nickname || username,
          role,
          JSON.stringify({ removeAfterCorrectCount: 3, autoNextOnCorrect: true }),
        ]
      );

      const u = inserted[0];
      await writeAuditLog(db, req.user!, 'create_user', 'user', String(u.id), username, { role });

      res.status(201).json({
        user: {
          id: String(u.id),
          username: String(u.username),
          email: String(u.email),
          nickname: String(u.nickname),
          role: u.role as UserRole,
          isDisabled: Boolean(u.is_disabled),
          createdAt: new Date(String(u.created_at)).toISOString(),
        },
      });
    } catch (err) {
      console.error('[admin create user]', err);
      res.status(500).json({ error: '创建用户失败' });
    }
  });

  router.put('/users/:id', async (req, res) => {
    try {
      const targetId = String(req.params.id || '');
      if (!isUuid(targetId)) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }

      const { rows } = await db.query<{
        id: string;
        username: string;
        nickname: string;
        role: UserRole;
        is_disabled: boolean;
      }>('SELECT id, username, nickname, role, COALESCE(is_disabled, FALSE) AS is_disabled FROM users WHERE id = $1', [
        targetId,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }

      const target = rows[0];
      const nextRole: UserRole =
        req.body?.role === 'admin' || req.body?.role === 'member' ? req.body.role : target.role;
      const nextDisabled = isPresent(req.body?.isDisabled)
        ? Boolean(req.body.isDisabled)
        : target.is_disabled;
      const currentNickname = sanitizeDisplayName(target.nickname, target.username);
      const nextNickname = isPresent(req.body?.nickname)
        ? sanitizeDisplayName(req.body.nickname, currentNickname)
        : currentNickname;

      if (target.id === req.user!.userId) {
        if (nextDisabled) {
          res.status(400).json({ error: '不能禁用当前登录的管理员账号' });
          return;
        }
        if (nextRole !== 'admin') {
          res.status(400).json({ error: '不能将当前登录的管理员账号降级为普通成员' });
          return;
        }
      }

      const wasActiveAdmin = target.role === 'admin' && !target.is_disabled;
      const willBeActiveAdmin = nextRole === 'admin' && !nextDisabled;
      if (wasActiveAdmin && !willBeActiveAdmin) {
        const activeAdmins = await countActiveAdmins();
        if (activeAdmins <= 1) {
          res.status(400).json({ error: '系统至少需要保留 1 位处于启用状态的管理员' });
          return;
        }
      }

      await db.query(
        `UPDATE users SET nickname = $1, role = $2, is_disabled = $3 WHERE id = $4`,
        [nextNickname, nextRole, nextDisabled, target.id]
      );

      await writeAuditLog(db, req.user!, 'update_user', 'user', target.id, target.username, {
        role: nextRole,
        isDisabled: nextDisabled,
        nickname: nextNickname,
      });

      res.json({
        ok: true,
        user: {
          id: target.id,
          username: target.username,
          nickname: nextNickname,
          role: nextRole,
          isDisabled: nextDisabled,
        },
      });
    } catch (err) {
      console.error('[admin update user]', err);
      res.status(500).json({ error: '更新用户信息失败' });
    }
  });

  router.post('/users/:id/reset-password', async (req, res) => {
    try {
      const targetId = String(req.params.id || '');
      if (!isUuid(targetId)) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }
      const newPassword = String(req.body?.newPassword ?? '');
      if (newPassword.length < 6) {
        res.status(400).json({ error: '新密码长度不能少于 6 位' });
        return;
      }

      const { rows } = await db.query<{ id: string; username: string }>(
        'SELECT id, username FROM users WHERE id = $1',
        [targetId]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }

      const hash = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, rows[0].id]);
      await writeAuditLog(db, req.user!, 'reset_password', 'user', rows[0].id, rows[0].username);

      res.json({ ok: true });
    } catch (err) {
      console.error('[admin reset password]', err);
      res.status(500).json({ error: '重置用户密码失败' });
    }
  });

  router.delete('/users/:id', async (req, res) => {
    try {
      const targetId = String(req.params.id || '');
      if (!isUuid(targetId)) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }
      if (targetId === req.user!.userId) {
        res.status(400).json({ error: '不能删除当前正在使用的管理员账号' });
        return;
      }

      const { rows } = await db.query<{
        id: string;
        username: string;
        role: UserRole;
        is_disabled: boolean;
      }>('SELECT id, username, role, COALESCE(is_disabled, FALSE) AS is_disabled FROM users WHERE id = $1', [
        targetId,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: '用户不存在' });
        return;
      }

      const target = rows[0];
      if (target.role === 'admin' && !target.is_disabled) {
        const activeAdmins = await countActiveAdmins();
        if (activeAdmins <= 1) {
          res.status(400).json({ error: '无法删除系统中最后一位可用管理员' });
          return;
        }
      }

      await db.query('DELETE FROM users WHERE id = $1', [target.id]);
      await writeAuditLog(db, req.user!, 'delete_user', 'user', target.id, target.username);

      res.json({ ok: true });
    } catch (err) {
      console.error('[admin delete user]', err);
      res.status(500).json({ error: '删除用户失败' });
    }
  });

  /* -------------------- 3. 使用时长查询与趋势统计 -------------------- */
  router.get('/usage', async (req, res) => {
    try {
      const rawDays = String(req.query.days || '7').trim();
      const allowedDays = new Set(['1', '7', '30', '90', 'all']);
      const days = allowedDays.has(rawDays) ? rawDays : '7';
      const userIdFilter = String(req.query.userId || '').trim();
      const q = String(req.query.q || '').trim();

      const dayNum = days === 'all' ? null : Number(days);
      const startDate = dayNum !== null ? getChinaDateOffset(dayNum - 1) : null;

      const dailyWhere: string[] = [];
      const dailyParams: unknown[] = [];
      if (startDate) {
        dailyParams.push(startDate);
        dailyWhere.push(`usage_date >= $${dailyParams.length}`);
      }
      if (userIdFilter && isUuid(userIdFilter)) {
        dailyParams.push(userIdFilter);
        dailyWhere.push(`user_id = $${dailyParams.length}`);
      }
      const dailyWhereSql = dailyWhere.length > 0 ? `WHERE ${dailyWhere.join(' AND ')}` : '';

      const trendRes = await db.query<Record<string, unknown>>(
        `SELECT
           usage_date,
           COUNT(DISTINCT CASE WHEN active_seconds > 0 THEN user_id END) AS active_users,
           COALESCE(SUM(active_seconds), 0) AS active_seconds,
           COALESCE(SUM(practice_seconds), 0) AS practice_seconds,
           COALESCE(SUM(exam_seconds), 0) AS exam_seconds
         FROM user_usage_daily
         ${dailyWhereSql}
         GROUP BY usage_date
         ORDER BY usage_date ASC`,
        dailyParams
      );

      const trendMap = new Map<string, AdminUsageDailyPoint>();
      for (const r of trendRes.rows) {
        const d = String(r.usage_date);
        trendMap.set(d, {
          date: d,
          activeUsers: Number(r.active_users ?? 0),
          activeSeconds: Number(r.active_seconds ?? 0),
          practiceSeconds: Number(r.practice_seconds ?? 0),
          examSeconds: Number(r.exam_seconds ?? 0),
        });
      }

      const dailyTrend: AdminUsageDailyPoint[] = [];
      if (dayNum !== null && dayNum <= 31) {
        for (let i = dayNum - 1; i >= 0; i -= 1) {
          const d = getChinaDateOffset(i);
          dailyTrend.push(
            trendMap.get(d) || {
              date: d,
              activeUsers: 0,
              activeSeconds: 0,
              practiceSeconds: 0,
              examSeconds: 0,
            }
          );
        }
      } else {
        dailyTrend.push(...Array.from(trendMap.values()));
      }

      const rankJoinParts: string[] = ['d.user_id = u.id'];
      const rankParams: unknown[] = [];
      if (startDate) {
        rankParams.push(startDate);
        rankJoinParts.push(`d.usage_date >= $${rankParams.length}`);
      }
      const rankWhereParts: string[] = ['1 = 1'];
      if (q) {
        rankParams.push(`%${q}%`);
        rankWhereParts.push(
          `(u.username ILIKE $${rankParams.length} OR u.nickname ILIKE $${rankParams.length} OR u.email ILIKE $${rankParams.length})`
        );
      }

      const rankRes = await db.query<Record<string, unknown>>(
        `SELECT
           u.id AS user_id,
           u.username,
           u.nickname,
           u.role,
           COALESCE(u.is_disabled, FALSE) AS is_disabled,
           u.last_active_at,
           COALESCE(SUM(d.active_seconds), 0) AS active_seconds,
           COALESCE(SUM(d.practice_seconds), 0) AS practice_seconds,
           COALESCE(SUM(d.exam_seconds), 0) AS exam_seconds,
           COUNT(DISTINCT CASE WHEN d.active_seconds > 0 THEN d.usage_date END) AS active_days,
           COALESCE(MAX(d.last_path), '') AS last_path
         FROM users u
         LEFT JOIN user_usage_daily d ON ${rankJoinParts.join(' AND ')}
         WHERE ${rankWhereParts.join(' AND ')}
         GROUP BY u.id
         ORDER BY COALESCE(SUM(d.active_seconds), 0) DESC, u.last_active_at DESC NULLS LAST, u.created_at DESC`,
        rankParams
      );

      const userRanking: AdminUsageUserRank[] = rankRes.rows.map((r) => {
        const uname = String(r.username);
        return {
          userId: String(r.user_id),
          username: uname,
          nickname: sanitizeDisplayName(r.nickname, uname),
          role: (r.role as UserRole) || 'member',
          isDisabled: Boolean(r.is_disabled),
          activeSeconds: Number(r.active_seconds ?? 0),
          practiceSeconds: Number(r.practice_seconds ?? 0),
          examSeconds: Number(r.exam_seconds ?? 0),
          activeDays: Number(r.active_days ?? 0),
          lastActiveAt: r.last_active_at ? new Date(String(r.last_active_at)).toISOString() : null,
          lastPath: String(r.last_path || ''),
        };
      });

      const totalSeconds = userRanking.reduce((s, u) => s + u.activeSeconds, 0);
      const practiceSeconds = userRanking.reduce((s, u) => s + u.practiceSeconds, 0);
      const examSeconds = userRanking.reduce((s, u) => s + u.examSeconds, 0);
      const activeUsers = userRanking.filter((u) => u.activeSeconds > 0).length;

      let userDaily: AdminUsageResponse['userDaily'];
      if (userIdFilter && isUuid(userIdFilter)) {
        const uParams: unknown[] = [userIdFilter];
        const uDateClause = startDate ? `AND usage_date >= $2` : '';
        if (startDate) uParams.push(startDate);
        const { rows: uDailyRows } = await db.query<Record<string, unknown>>(
          `SELECT usage_date, active_seconds, practice_seconds, exam_seconds, heartbeat_count, last_path
           FROM user_usage_daily
           WHERE user_id = $1 ${uDateClause}
           ORDER BY usage_date DESC`,
          uParams
        );
        userDaily = uDailyRows.map((r) => ({
          date: String(r.usage_date),
          activeSeconds: Number(r.active_seconds ?? 0),
          practiceSeconds: Number(r.practice_seconds ?? 0),
          examSeconds: Number(r.exam_seconds ?? 0),
          heartbeatCount: Number(r.heartbeat_count ?? 0),
          lastPath: String(r.last_path || ''),
        }));
      }

      const payload: AdminUsageResponse = {
        days,
        startDate,
        summary: {
          totalSeconds,
          practiceSeconds,
          examSeconds,
          activeUsers,
          avgSecondsPerActiveUser: activeUsers > 0 ? Math.round(totalSeconds / activeUsers) : 0,
        },
        dailyTrend,
        userRanking,
        ...(userDaily ? { userDaily } : {}),
      };

      res.json(payload);
    } catch (err) {
      console.error('[admin usage]', err);
      res.status(500).json({ error: '查询使用时长统计失败' });
    }
  });

  /* -------------------- 4. 全站题库管理 -------------------- */
  router.get('/banks', async (req, res) => {
    try {
      const q = String(req.query.q ?? '').trim();
      const visibility = String(req.query.visibility ?? '').trim();
      const ownerId = String(req.query.ownerId ?? '').trim();

      const params: unknown[] = [];
      const clauses: string[] = ['1 = 1'];
      if (q) {
        params.push(`%${q}%`);
        clauses.push(
          `(b.title ILIKE $${params.length} OR b.category ILIKE $${params.length} OR u.username ILIKE $${params.length} OR u.nickname ILIKE $${params.length})`
        );
      }
      if (visibility === 'public' || visibility === 'private') {
        params.push(visibility);
        clauses.push(`b.visibility = $${params.length}`);
      }
      if (ownerId && isUuid(ownerId)) {
        params.push(ownerId);
        clauses.push(`b.owner_id = $${params.length}`);
      }

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT
           b.*,
           u.username AS owner_username,
           u.nickname AS owner_nickname,
           (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count,
           (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id AND q.star_rating > 0) AS rated_count,
           (SELECT COUNT(*) FROM chapters c WHERE c.bank_id = b.id) AS chapter_count,
           (SELECT COUNT(*) FROM bank_shares bs WHERE bs.bank_id = b.id) AS shared_user_count
         FROM question_banks b
         JOIN users u ON u.id = b.owner_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY b.updated_at DESC`,
        params
      );

      const banks: AdminBankItem[] = rows.map((r) => {
        const ownerUname = String(r.owner_username || '');
        return {
          id: String(r.id),
          ownerId: String(r.owner_id),
          ownerUsername: ownerUname,
          ownerNickname: sanitizeDisplayName(r.owner_nickname, ownerUname),
          title: String(r.title),
          description: String(r.description || ''),
          category: String(r.category || '默认分类'),
          visibility: (r.visibility as 'private' | 'public') || 'private',
          cloneCount: Number(r.clone_count ?? 0),
          questionCount: Number(r.question_count ?? 0),
          ratedCount: Number(r.rated_count ?? 0),
          chapterCount: Number(r.chapter_count ?? 0),
          shareEnabled: Boolean(r.share_enabled),
          sharedUserCount: Number(r.shared_user_count ?? 0),
          createdAt: new Date(String(r.created_at)).toISOString(),
          updatedAt: new Date(String(r.updated_at)).toISOString(),
        };
      });

      res.json({ banks });
    } catch (err) {
      console.error('[admin list banks]', err);
      res.status(500).json({ error: '获取全站题库列表失败' });
    }
  });

  router.put('/banks/:id', async (req, res) => {
    try {
      const bankId = String(req.params.id || '');
      if (!isUuid(bankId)) {
        res.status(404).json({ error: '题库不存在' });
        return;
      }

      const { rows } = await db.query<{
        id: string;
        owner_id: string;
        title: string;
        description: string;
        category: string;
        visibility: 'private' | 'public';
        share_enabled: boolean;
        share_code: string | null;
        share_password: string;
      }>('SELECT * FROM question_banks WHERE id = $1', [bankId]);
      if (rows.length === 0) {
        res.status(404).json({ error: '题库不存在' });
        return;
      }

      const bank = rows[0];
      const nextTitle = isPresent(req.body?.title)
        ? String(req.body.title).trim() || bank.title
        : bank.title;
      const nextDesc = isPresent(req.body?.description)
        ? String(req.body.description).trim()
        : bank.description;
      const nextCat = isPresent(req.body?.category)
        ? String(req.body.category).trim() || bank.category
        : bank.category;
      const nextVis =
        req.body?.visibility === 'public' || req.body?.visibility === 'private'
          ? req.body.visibility
          : bank.visibility;

      let nextOwnerId = bank.owner_id;
      if (isPresent(req.body?.ownerId) && String(req.body.ownerId) !== bank.owner_id) {
        const candidateOwner = String(req.body.ownerId).trim();
        if (!isUuid(candidateOwner)) {
          res.status(400).json({ error: '目标归属用户不存在' });
          return;
        }
        const { rows: ownerRows } = await db.query<{ id: string }>(
          'SELECT id FROM users WHERE id = $1',
          [candidateOwner]
        );
        if (ownerRows.length === 0) {
          res.status(400).json({ error: '目标归属用户不存在' });
          return;
        }
        nextOwnerId = candidateOwner;
      }

      const disableShare = Boolean(req.body?.disableShare);
      const nextShareEnabled = disableShare ? false : Boolean(bank.share_enabled);
      const nextShareCode = disableShare ? null : bank.share_code;
      const nextSharePassword = disableShare ? '' : bank.share_password;

      await db.query(
        `UPDATE question_banks
         SET owner_id = $1, title = $2, description = $3, category = $4, visibility = $5,
             share_enabled = $6, share_code = $7, share_password = $8, updated_at = NOW()
         WHERE id = $9`,
        [
          nextOwnerId,
          nextTitle,
          nextDesc,
          nextCat,
          nextVis,
          nextShareEnabled,
          nextShareCode,
          nextSharePassword,
          bank.id,
        ]
      );

      if (nextOwnerId !== bank.owner_id) {
        await db.query('DELETE FROM bank_shares WHERE bank_id = $1 AND user_id = $2', [
          bank.id,
          nextOwnerId,
        ]);
      }

      await writeAuditLog(db, req.user!, 'update_bank', 'bank', bank.id, nextTitle, {
        visibility: nextVis,
        ownerId: nextOwnerId,
        disableShare,
      });

      res.json({ ok: true });
    } catch (err) {
      console.error('[admin update bank]', err);
      res.status(500).json({ error: '更新题库失败' });
    }
  });

  router.delete('/banks/:id', async (req, res) => {
    try {
      const bankId = String(req.params.id || '');
      if (!isUuid(bankId)) {
        res.status(404).json({ error: '题库不存在' });
        return;
      }
      const { rows } = await db.query<{ id: string; title: string }>(
        'SELECT id, title FROM question_banks WHERE id = $1',
        [bankId]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: '题库不存在' });
        return;
      }

      await db.query('DELETE FROM question_banks WHERE id = $1', [rows[0].id]);
      await writeAuditLog(db, req.user!, 'delete_bank', 'bank', rows[0].id, rows[0].title);

      res.json({ ok: true });
    } catch (err) {
      console.error('[admin delete bank]', err);
      res.status(500).json({ error: '删除题库失败' });
    }
  });

  /* -------------------- 5. 全站考场与 AI 任务管理 -------------------- */
  router.get('/exams', async (_req, res) => {
    try {
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT
           e.*,
           u.username AS creator_username,
           u.nickname AS creator_nickname,
           b.title AS bank_title,
           (SELECT COUNT(*) FROM exam_submissions s WHERE s.exam_id = e.id) AS submission_count,
           (SELECT ROUND(AVG(s.score)::numeric, 1) FROM exam_submissions s WHERE s.exam_id = e.id) AS avg_score,
           (SELECT ROUND(100.0 * COALESCE(SUM(CASE WHEN s.is_passed THEN 1 ELSE 0 END), 0) / NULLIF(COUNT(*), 0), 0)
            FROM exam_submissions s WHERE s.exam_id = e.id) AS pass_rate
         FROM exams e
         JOIN users u ON u.id = e.creator_id
         LEFT JOIN question_banks b ON b.id = e.bank_id
         ORDER BY e.created_at DESC
         LIMIT 200`
      );

      const exams: AdminExamItem[] = rows.map((r) => {
        const snapshot = Array.isArray(r.questions_snapshot) ? r.questions_snapshot : [];
        const creatorUname = String(r.creator_username || '');
        return {
          id: String(r.id),
          creatorId: String(r.creator_id),
          creatorUsername: creatorUname,
          creatorNickname: sanitizeDisplayName(r.creator_nickname, creatorUname),
          bankId: r.bank_id ? String(r.bank_id) : null,
          bankTitle: String(r.bank_title || ''),
          title: String(r.title),
          examType: r.exam_type as 'mock' | 'published',
          shareCode: String(r.share_code),
          status: r.status as 'active' | 'closed',
          questionCount: snapshot.length,
          durationMinutes: Number(r.duration_minutes ?? 60),
          submissionCount: Number(r.submission_count ?? 0),
          avgScore: r.avg_score !== null && r.avg_score !== undefined ? Number(r.avg_score) : null,
          passRate: r.pass_rate !== null && r.pass_rate !== undefined ? Number(r.pass_rate) : null,
          createdAt: new Date(String(r.created_at)).toISOString(),
        };
      });

      res.json({ exams });
    } catch (err) {
      console.error('[admin list exams]', err);
      res.status(500).json({ error: '获取全站考场列表失败' });
    }
  });

  router.put('/exams/:id', async (req, res) => {
    try {
      const examId = String(req.params.id || '');
      if (!isUuid(examId)) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const { rows } = await db.query<{ id: string; title: string; status: string }>(
        'SELECT id, title, status FROM exams WHERE id = $1',
        [examId]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const cur = rows[0];
      const nextStatus =
        req.body?.status === 'active' || req.body?.status === 'closed'
          ? req.body.status
          : cur.status;
      const nextTitle = isPresent(req.body?.title)
        ? String(req.body.title).trim() || cur.title
        : cur.title;

      await db.query('UPDATE exams SET status = $1, title = $2 WHERE id = $3', [
        nextStatus,
        nextTitle,
        cur.id,
      ]);
      await writeAuditLog(db, req.user!, 'update_exam', 'exam', cur.id, nextTitle, {
        status: nextStatus,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('[admin update exam]', err);
      res.status(500).json({ error: '更新考试状态失败' });
    }
  });

  router.delete('/exams/:id', async (req, res) => {
    try {
      const examId = String(req.params.id || '');
      if (!isUuid(examId)) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const { rows } = await db.query<{ id: string; title: string }>(
        'SELECT id, title FROM exams WHERE id = $1',
        [examId]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      await db.query('DELETE FROM exams WHERE id = $1', [rows[0].id]);
      await writeAuditLog(db, req.user!, 'delete_exam', 'exam', rows[0].id, rows[0].title);
      res.json({ ok: true });
    } catch (err) {
      console.error('[admin delete exam]', err);
      res.status(500).json({ error: '删除考试失败' });
    }
  });

  router.get('/ai-jobs', async (_req, res) => {
    try {
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT
           j.id, j.user_id, j.job_type, j.status, j.source_filename, j.source_char_count,
           j.progress_pct, j.model_used, j.imported_count, j.error_message, j.created_at, j.finished_at,
           u.username, u.nickname
         FROM ai_conversion_jobs j
         JOIN users u ON u.id = j.user_id
         ORDER BY j.created_at DESC
         LIMIT 100`
      );

      const jobs: AdminAiJobItem[] = rows.map((r) => {
        const uname = String(r.username || '');
        return {
          id: String(r.id),
          userId: String(r.user_id),
          username: uname,
          nickname: sanitizeDisplayName(r.nickname, uname),
          jobType: String(r.job_type || 'extract'),
          status: String(r.status),
          sourceFilename: String(r.source_filename || ''),
          sourceCharCount: Number(r.source_char_count ?? 0),
          progressPct: Number(r.progress_pct ?? 0),
          modelUsed: String(r.model_used || ''),
          importedCount: Number(r.imported_count ?? 0),
          errorMessage: String(r.error_message || ''),
          createdAt: new Date(String(r.created_at)).toISOString(),
          finishedAt: r.finished_at ? new Date(String(r.finished_at)).toISOString() : null,
        };
      });

      res.json({ jobs });
    } catch (err) {
      console.error('[admin list ai jobs]', err);
      res.status(500).json({ error: '获取全站 AI 任务列表失败' });
    }
  });

  router.delete('/ai-jobs/:id', async (req, res) => {
    try {
      const jobId = String(req.params.id || '');
      if (!isUuid(jobId)) {
        res.status(404).json({ error: 'AI 任务不存在' });
        return;
      }
      const { rows } = await db.query<{ id: string; status: string; source_filename: string }>(
        'SELECT id, status, source_filename FROM ai_conversion_jobs WHERE id = $1',
        [jobId]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'AI 任务不存在' });
        return;
      }
      if (rows[0].status === 'running' || rows[0].status === 'queued') {
        res.status(400).json({ error: '运行或排队中的 AI 任务请先等待完成或由发起人取消后再清理' });
        return;
      }
      await db.query('DELETE FROM ai_conversion_jobs WHERE id = $1', [rows[0].id]);
      await writeAuditLog(
        db,
        req.user!,
        'delete_ai_job',
        'ai_job',
        rows[0].id,
        rows[0].source_filename || rows[0].id
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('[admin delete ai job]', err);
      res.status(500).json({ error: '删除 AI 任务记录失败' });
    }
  });

  /* -------------------- 6. 注册策略与审计日志 -------------------- */
  router.get('/policy', async (_req, res) => {
    try {
      const policy = await getSystemPolicy(db);
      res.json({ policy });
    } catch (err) {
      console.error('[admin get policy]', err);
      res.status(500).json({ error: '读取系统策略失败' });
    }
  });

  router.put('/policy', async (req, res) => {
    try {
      const current = await getSystemPolicy(db);
      const nextPolicy = {
        allowRegistration: isPresent(req.body?.allowRegistration)
          ? Boolean(req.body.allowRegistration)
          : current.allowRegistration,
      };
      await db.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ('system_policy', $1::jsonb, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [JSON.stringify(nextPolicy)]
      );
      await writeAuditLog(db, req.user!, 'update_policy', 'policy', 'system_policy', '系统策略', nextPolicy);
      res.json({ policy: nextPolicy });
    } catch (err) {
      console.error('[admin put policy]', err);
      res.status(500).json({ error: '更新系统策略失败' });
    }
  });

  router.get('/audit-logs', async (req, res) => {
    try {
      const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT * FROM admin_audit_logs ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      const logs: AdminAuditLogItem[] = rows.map((r) => ({
        id: String(r.id),
        actorId: r.actor_id ? String(r.actor_id) : null,
        actorName: String(r.actor_name || ''),
        action: String(r.action),
        targetType: String(r.target_type),
        targetId: String(r.target_id || ''),
        targetLabel: String(r.target_label || ''),
        detail: (r.detail as Record<string, unknown>) || {},
        createdAt: new Date(String(r.created_at)).toISOString(),
      }));
      res.json({ logs });
    } catch (err) {
      console.error('[admin audit logs]', err);
      res.status(500).json({ error: '读取审计日志失败' });
    }
  });

  return router;
}
