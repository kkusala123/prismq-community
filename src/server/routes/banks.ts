import { Router } from 'express';
import crypto from 'node:crypto';
import type { DbClient } from '../db/client.js';
import { createAuthMiddlewares } from '../middleware/auth.js';
import { createRateLimiter } from '../middleware/security.js';
import { normalizeAnswer } from '../services/grader.js';
import { exportQuestionsToDocx, exportQuestionsToWorkbook } from '../services/parser.js';
import { batchInsertQuestionsToBank } from '../services/bankImport.js';
import { getAppConfig } from '../config.js';
import { normalizeCodeInText } from '../../shared/codeFormatter.js';
import {
  generateQrDataUrl,
  generateQrPngBuffer,
  generateQrSvg,
  resolveShareOrigin,
} from '../services/qrcode.js';
import {
  isPresent,
  sanitizeDisplayName,
  type BankShareMember,
  type BankStatsSummary,
  type ChapterItem,
  type QuestionBankSummary,
  type QuestionItem,
  type QuestionOption,
  type QuestionType,
} from '../../shared/types.js';

const SHARE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateShareCode(len = 8): string {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += SHARE_CODE_ALPHABET[bytes[i] % SHARE_CODE_ALPHABET.length];
  }
  return out;
}

async function generateUniqueBankShareCode(db: DbClient): Promise<string> {
  for (let i = 0; i < 6; i += 1) {
    const code = generateShareCode(8);
    const { rowCount } = await db.query(
      'SELECT 1 FROM question_banks WHERE UPPER(share_code) = $1',
      [code]
    );
    if (rowCount === 0) return code;
  }
  return `${generateShareCode(6)}${crypto.randomBytes(1)[0].toString(36).toUpperCase().slice(0, 2)}`;
}

function sanitizeOptions(type: QuestionType, rawOptions: unknown): QuestionOption[] {
  if (type === 'boolean') {
    return [
      { key: 'A', content: '正确' },
      { key: 'B', content: '错误' },
    ];
  }
  if (!Array.isArray(rawOptions)) return [];
  return rawOptions
    .map((o, idx) => {
      if (typeof o === 'string') {
        return { key: String.fromCharCode(65 + idx), content: o.trim() };
      }
      if (o && typeof o === 'object') {
        const obj = o as Record<string, unknown>;
        return {
          key: String(obj.key || String.fromCharCode(65 + idx)).trim().toUpperCase(),
          content: String(obj.content || '').trim(),
        };
      }
      return null;
    })
    .filter((o): o is QuestionOption => Boolean(o && o.content));
}

export function createBanksRouter(db: DbClient): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddlewares(db);
  const shareAccessLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 40,
    keyPrefix: 'banks:share',
    message: '分享码查询或加入过于频繁，请稍后再试',
  });

  async function findBankWithAccess(bankId: string, userId: string, role: string) {
    const { rows } = await db.query<{
      id: string;
      owner_id: string;
      owner_name: string;
      owner_username: string;
      title: string;
      description: string;
      category: string;
      visibility: 'private' | 'public';
      clone_count: number;
      share_code: string | null;
      share_password: string;
      share_enabled: boolean;
      is_shared_with_me: boolean;
      shared_user_count: number | string;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT
         b.*,
         CASE
           WHEN BTRIM(COALESCE(u.nickname, '')) = '' OR LOWER(BTRIM(u.nickname)) IN ('null', 'undefined')
           THEN u.username
           ELSE BTRIM(u.nickname)
         END AS owner_name,
         u.username AS owner_username,
         EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2) AS is_shared_with_me,
         (SELECT COUNT(*) FROM bank_shares bs WHERE bs.bank_id = b.id) AS shared_user_count
       FROM question_banks b
       JOIN users u ON u.id = b.owner_id
       WHERE b.id = $1`,
      [bankId, userId]
    );
    const bank = rows[0];
    if (!bank) return null;
    bank.owner_name = sanitizeDisplayName(bank.owner_name, sanitizeDisplayName(bank.owner_username, '匿名'));
    const isSharedWithMe = Boolean(bank.is_shared_with_me) && bank.owner_id !== userId;
    const canRead =
      bank.visibility === 'public' ||
      bank.owner_id === userId ||
      Boolean(bank.is_shared_with_me) ||
      role === 'admin';
    const canEdit = bank.owner_id === userId || role === 'admin';
    return { bank, canRead, canEdit, isSharedWithMe };
  }

  async function listBankShareMembers(bankId: string): Promise<BankShareMember[]> {
    const { rows } = await db.query<{
      user_id: string;
      username: string;
      email: string;
      nickname: string;
      via: string;
      created_at: string;
    }>(
      `SELECT bs.user_id, u.username, u.email, u.nickname, bs.via, bs.created_at
       FROM bank_shares bs
       JOIN users u ON u.id = bs.user_id
       WHERE bs.bank_id = $1
       ORDER BY bs.created_at DESC`,
      [bankId]
    );
    return rows.map((r) => ({
      userId: String(r.user_id),
      username: String(r.username),
      email: String(r.email),
      nickname: sanitizeDisplayName(r.nickname, String(r.username)),
      via: r.via === 'code' ? 'code' : 'direct',
      createdAt: new Date(String(r.created_at)).toISOString(),
    }));
  }

  router.get('/', requireAuth, async (req, res) => {
    try {
      const scope = String(req.query.scope || 'mine');
      const category = String(req.query.category || '').trim();
      const keyword = String(req.query.q || '').trim();

      const params: unknown[] = [req.user!.userId];
      const clauses: string[] = [];

      if (scope === 'mine') {
        clauses.push(`b.owner_id = $1`);
      } else if (scope === 'shared') {
        clauses.push(
          `b.owner_id <> $1 AND EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $1)`
        );
      } else if (scope === 'public') {
        clauses.push(`b.visibility = 'public'`);
      } else if (scope === 'admin' && req.user!.role === 'admin') {
        clauses.push(`1 = 1`);
      } else {
        clauses.push(
          `(b.owner_id = $1 OR b.visibility = 'public' OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $1))`
        );
      }

      if (category && category !== '全部') {
        params.push(category);
        clauses.push(`b.category = $${params.length}`);
      }
      if (keyword) {
        params.push(`%${keyword}%`);
        clauses.push(`(b.title ILIKE $${params.length} OR b.description ILIKE $${params.length})`);
      }

      const sql = `
        SELECT
          b.*,
          CASE
            WHEN BTRIM(COALESCE(u.nickname, '')) = '' OR LOWER(BTRIM(u.nickname)) IN ('null', 'undefined')
            THEN u.username
            ELSE BTRIM(u.nickname)
          END AS owner_name,
          u.username AS owner_username,
          (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count,
          (SELECT COUNT(*) FROM chapters c WHERE c.bank_id = b.id) AS chapter_count,
          (SELECT COUNT(*) FROM user_question_records r WHERE r.bank_id = b.id AND r.user_id = $1 AND r.answered_count > 0) AS practiced_count,
          (SELECT COUNT(*) FROM user_question_records r WHERE r.bank_id = b.id AND r.user_id = $1 AND r.in_mistake_book = TRUE) AS mistake_count,
          (SELECT COUNT(*) FROM user_question_records r WHERE r.bank_id = b.id AND r.user_id = $1 AND r.is_mastered = TRUE) AS mastered_count,
          COALESCE((SELECT p.last_question_index FROM user_bank_progress p WHERE p.bank_id = b.id AND p.user_id = $1), 0) AS last_progress_index,
          (b.owner_id <> $1 AND EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $1)) AS shared_with_me,
          (SELECT COUNT(*) FROM bank_shares bs WHERE bs.bank_id = b.id) AS shared_user_count
        FROM question_banks b
        JOIN users u ON u.id = b.owner_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY b.updated_at DESC
      `;

      const { rows } = await db.query<Record<string, unknown>>(sql, params);
      const banks: QuestionBankSummary[] = rows.map((r) => ({
        id: String(r.id),
        ownerId: String(r.owner_id),
        ownerName: sanitizeDisplayName(r.owner_name, sanitizeDisplayName(r.owner_username, '匿名')),
        title: String(r.title),
        description: String(r.description || ''),
        category: String(r.category || '默认分类'),
        visibility: (r.visibility as 'private' | 'public') || 'private',
        cloneCount: Number(r.clone_count ?? 0),
        questionCount: Number(r.question_count ?? 0),
        chapterCount: Number(r.chapter_count ?? 0),
        practicedCount: Number(r.practiced_count ?? 0),
        mistakeCount: Number(r.mistake_count ?? 0),
        masteredCount: Number(r.mastered_count ?? 0),
        lastProgressIndex: Number(r.last_progress_index ?? 0),
        sharedWithMe: Boolean(r.shared_with_me),
        sharedUserCount: Number(r.shared_user_count ?? 0),
        shareEnabled: Boolean(r.share_enabled),
        createdAt: new Date(String(r.created_at)).toISOString(),
        updatedAt: new Date(String(r.updated_at)).toISOString(),
      }));

      res.json({ banks });
    } catch (err) {
      console.error('[list banks]', err);
      res.status(500).json({ error: '获取题库列表失败' });
    }
  });

  // 静态分享码查询与加入接口必须在 /:id 之前声明，防止 Express 将 "share" 当作 :id
  router.get('/share/:code', requireAuth, shareAccessLimiter, async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      if (!code) {
        res.status(404).json({ error: '分享码无效或分享已关闭' });
        return;
      }

      const { rows } = await db.query<{
        id: string;
        owner_id: string;
        owner_name: string;
        owner_username: string;
        title: string;
        description: string;
        category: string;
        visibility: 'private' | 'public';
        share_password: string;
        share_enabled: boolean;
        question_count: number | string;
        is_shared: boolean;
      }>(
        `SELECT
           b.id, b.owner_id,
           CASE
             WHEN BTRIM(COALESCE(u.nickname, '')) = '' OR LOWER(BTRIM(u.nickname)) IN ('null', 'undefined')
             THEN u.username
             ELSE BTRIM(u.nickname)
           END AS owner_name,
           u.username AS owner_username,
           b.title, b.description,
           b.category, b.visibility, b.share_password, b.share_enabled,
           (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count,
           EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2) AS is_shared
         FROM question_banks b
         JOIN users u ON u.id = b.owner_id
         WHERE UPPER(b.share_code) = $1 AND (b.share_enabled = TRUE OR b.visibility = 'public')`,
        [code, req.user!.userId]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: '分享码无效或题库分享已关闭' });
        return;
      }

      const bank = rows[0];
      res.json({
        bank: {
          id: bank.id,
          title: bank.title,
          description: bank.description || '',
          category: bank.category || '默认分类',
          ownerName: sanitizeDisplayName(bank.owner_name, sanitizeDisplayName(bank.owner_username, '匿名')),
          visibility: bank.visibility,
          questionCount: Number(bank.question_count ?? 0),
          requiresPassword: Boolean(bank.share_password && bank.share_password.trim()),
          alreadyAccessible:
            bank.owner_id === req.user!.userId ||
            Boolean(bank.is_shared) ||
            bank.visibility === 'public' ||
            req.user!.role === 'admin',
        },
      });
    } catch (err) {
      console.error('[preview shared bank]', err);
      res.status(500).json({ error: '查询私密分享题库失败' });
    }
  });

  router.post('/share/join', requireAuth, shareAccessLimiter, async (req, res) => {
    try {
      const code = String(req.body?.shareCode ?? req.body?.code ?? '').trim().toUpperCase();
      const password = String(req.body?.password ?? '').trim();
      if (!code) {
        res.status(400).json({ error: '请输入题库分享码' });
        return;
      }

      const { rows } = await db.query<{
        id: string;
        owner_id: string;
        title: string;
        visibility: 'private' | 'public';
        share_password: string;
      }>(
        `SELECT id, owner_id, title, visibility, share_password
         FROM question_banks
         WHERE UPPER(share_code) = $1 AND (share_enabled = TRUE OR visibility = 'public')`,
        [code]
      );

      if (rows.length === 0) {
        res.status(404).json({ error: '分享码无效或题库分享已关闭' });
        return;
      }

      const bank = rows[0];
      const requiredPwd = (bank.share_password || '').trim();
      if (requiredPwd && bank.owner_id !== req.user!.userId && password !== requiredPwd) {
        res.status(403).json({ error: '私密访问口令不正确，请向分享者确认后重试' });
        return;
      }

      if (bank.owner_id !== req.user!.userId) {
        await db.query(
          `INSERT INTO bank_shares (bank_id, user_id, granted_by, via)
           VALUES ($1, $2, $3, 'code')
           ON CONFLICT (bank_id, user_id) DO NOTHING`,
          [bank.id, req.user!.userId, bank.owner_id]
        );
      }

      res.json({
        bankId: bank.id,
        title: bank.title,
        visibility: bank.visibility,
      });
    } catch (err) {
      console.error('[join shared bank]', err);
      res.status(500).json({ error: '加入私密分享题库失败' });
    }
  });

  router.post('/', requireAuth, async (req, res) => {
    try {
      const title = String(req.body?.title ?? '').trim();
      const description = String(req.body?.description ?? '').trim();
      const category = String(req.body?.category ?? '默认分类').trim() || '默认分类';
      const visibility = req.body?.visibility === 'public' ? 'public' : 'private';

      if (!title) {
        res.status(400).json({ error: '题库名称不能为空' });
        return;
      }

      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO question_banks (owner_id, title, description, category, visibility)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [req.user!.userId, title, description, category, visibility]
      );

      res.status(201).json({ id: rows[0].id, title, category, visibility });
    } catch (err) {
      console.error('[create bank]', err);
      res.status(500).json({ error: '创建题库失败' });
    }
  });

  router.get('/:id', requireAuth, async (req, res) => {
    try {
      const bankId = String(req.params.id);
      const access = await findBankWithAccess(bankId, req.user!.userId, req.user!.role);
      if (!access || !access.canRead) {
        res.status(404).json({ error: '题库不存在或无权访问' });
        return;
      }

      const { rows: chapterRows } = await db.query<Record<string, unknown>>(
        `SELECT c.*, (SELECT COUNT(*) FROM questions q WHERE q.chapter_id = c.id) AS question_count
         FROM chapters c
         WHERE c.bank_id = $1
         ORDER BY c.sort_order ASC, c.created_at ASC`,
        [bankId]
      );

      const chapters: ChapterItem[] = chapterRows.map((c) => ({
        id: String(c.id),
        bankId: String(c.bank_id),
        title: String(c.title),
        sortOrder: Number(c.sort_order ?? 0),
        questionCount: Number(c.question_count ?? 0),
      }));

      const qParams: unknown[] = [bankId, req.user!.userId];
      const qClauses: string[] = ['q.bank_id = $1'];
      const chapterFilter = String(req.query.chapterId || '').trim();
      const typeFilter = String(req.query.type || '').trim();
      const difficultyTier = String(req.query.difficultyTier || '').trim();
      const minStar = Math.min(5, Math.max(0, Number(req.query.minStar || 0) || 0));
      const keyword = String(req.query.q || '').trim();

      if (chapterFilter) {
        if (chapterFilter === 'none') {
          qClauses.push('q.chapter_id IS NULL');
        } else {
          qParams.push(chapterFilter);
          qClauses.push(`q.chapter_id = $${qParams.length}`);
        }
      }
      if (typeFilter && ['single', 'multiple', 'boolean', 'fill', 'short'].includes(typeFilter)) {
        qParams.push(typeFilter);
        qClauses.push(`q.type = $${qParams.length}`);
      }
      if (difficultyTier === 'easy') {
        qClauses.push('q.difficulty <= 2');
      } else if (difficultyTier === 'medium') {
        qClauses.push('q.difficulty = 3');
      } else if (difficultyTier === 'hard') {
        qClauses.push('q.difficulty >= 4');
      }
      if (minStar > 0) {
        qParams.push(minStar);
        qClauses.push(`q.star_rating >= $${qParams.length}`);
      }
      if (keyword) {
        qParams.push(`%${keyword}%`);
        qClauses.push(
          `(q.stem ILIKE $${qParams.length} OR q.explanation ILIKE $${qParams.length} OR q.options::text ILIKE $${qParams.length})`
        );
      }

      const { rows: statsRows } = await db.query<Record<string, unknown>>(
        `SELECT
           COUNT(*) AS total_count,
           COALESCE(SUM(CASE WHEN type = 'single' THEN 1 ELSE 0 END), 0) AS single_count,
           COALESCE(SUM(CASE WHEN type = 'multiple' THEN 1 ELSE 0 END), 0) AS multiple_count,
           COALESCE(SUM(CASE WHEN type = 'boolean' THEN 1 ELSE 0 END), 0) AS boolean_count,
           COALESCE(SUM(CASE WHEN type = 'fill' THEN 1 ELSE 0 END), 0) AS fill_count,
           COALESCE(SUM(CASE WHEN type = 'short' THEN 1 ELSE 0 END), 0) AS short_count,
           COALESCE(SUM(CASE WHEN difficulty <= 2 THEN 1 ELSE 0 END), 0) AS easy_count,
           COALESCE(SUM(CASE WHEN difficulty = 3 THEN 1 ELSE 0 END), 0) AS medium_count,
           COALESCE(SUM(CASE WHEN difficulty >= 4 THEN 1 ELSE 0 END), 0) AS hard_count,
           COALESCE(SUM(CASE WHEN star_rating > 0 THEN 1 ELSE 0 END), 0) AS rated_count,
           COALESCE(AVG(difficulty), 2) AS avg_difficulty,
           COALESCE(AVG(NULLIF(star_rating, 0)), 0) AS avg_star_rating
         FROM questions
         WHERE bank_id = $1`,
        [bankId]
      );
      const st = statsRows[0] || {};
      const bankStats: BankStatsSummary = {
        typeCounts: {
          single: Number(st.single_count ?? 0),
          multiple: Number(st.multiple_count ?? 0),
          boolean: Number(st.boolean_count ?? 0),
          fill: Number(st.fill_count ?? 0),
          short: Number(st.short_count ?? 0),
        },
        difficultyCounts: {
          easy: Number(st.easy_count ?? 0),
          medium: Number(st.medium_count ?? 0),
          hard: Number(st.hard_count ?? 0),
        },
        ratedCount: Number(st.rated_count ?? 0),
        totalCount: Number(st.total_count ?? 0),
        avgDifficulty: Number(Number(st.avg_difficulty ?? 2).toFixed(2)),
        avgStarRating: Number(Number(st.avg_star_rating ?? 0).toFixed(2)),
      };

      const { rows: qRows } = await db.query<Record<string, unknown>>(
        `SELECT
           q.*,
           c.title AS chapter_title,
           r.answered_count, r.correct_count, r.wrong_count, r.consecutive_correct,
           r.in_mistake_book, r.is_mastered, r.is_favorited, r.note, r.last_answer, r.last_is_correct
         FROM questions q
         LEFT JOIN chapters c ON c.id = q.chapter_id
         LEFT JOIN user_question_records r ON r.question_id = q.id AND r.user_id = $2
         WHERE ${qClauses.join(' AND ')}
         ORDER BY q.sort_order ASC, q.created_at ASC`,
        qParams
      );

      const questions: QuestionItem[] = qRows.map((q) => ({
        id: String(q.id),
        bankId: String(q.bank_id),
        chapterId: q.chapter_id ? String(q.chapter_id) : null,
        chapterTitle: q.chapter_title ? String(q.chapter_title) : '',
        type: q.type as QuestionType,
        stem: String(q.stem),
        options: Array.isArray(q.options) ? (q.options as QuestionOption[]) : [],
        answer: String(q.answer),
        explanation: String(q.explanation || ''),
        difficulty: Number(q.difficulty ?? 2),
        starRating: Number(q.star_rating ?? 0),
        ratingReason: String(q.rating_reason || ''),
        ratedAt: q.rated_at ? new Date(String(q.rated_at)).toISOString() : null,
        tags: Array.isArray(q.tags) ? (q.tags as string[]) : [],
        sortOrder: Number(q.sort_order ?? 0),
        createdAt: new Date(String(q.created_at)).toISOString(),
        record: q.answered_count !== null && q.answered_count !== undefined
          ? {
              answeredCount: Number(q.answered_count ?? 0),
              correctCount: Number(q.correct_count ?? 0),
              wrongCount: Number(q.wrong_count ?? 0),
              consecutiveCorrect: Number(q.consecutive_correct ?? 0),
              inMistakeBook: Boolean(q.in_mistake_book),
              isMastered: Boolean(q.is_mastered),
              isFavorited: Boolean(q.is_favorited),
              note: String(q.note || ''),
              lastAnswer: q.last_answer ? String(q.last_answer) : null,
              lastIsCorrect: q.last_is_correct === null ? null : Boolean(q.last_is_correct),
            }
          : undefined,
      }));

      const { rows: progRows } = await db.query<{ last_question_index: number }>(
        'SELECT last_question_index FROM user_bank_progress WHERE user_id = $1 AND bank_id = $2',
        [req.user!.userId, bankId]
      );

      res.json({
        bank: {
          id: access.bank.id,
          ownerId: access.bank.owner_id,
          ownerName: access.bank.owner_name,
          title: access.bank.title,
          description: access.bank.description,
          category: access.bank.category,
          visibility: access.bank.visibility,
          cloneCount: Number(access.bank.clone_count ?? 0),
          canEdit: access.canEdit,
          isSharedWithMe: access.isSharedWithMe,
          sharedUserCount: access.canEdit ? Number(access.bank.shared_user_count ?? 0) : 0,
          shareEnabled: access.canEdit ? Boolean(access.bank.share_enabled) : false,
          ...(access.canEdit || access.bank.visibility === 'public'
            ? {
                shareCode: access.bank.share_code || '',
                hasSharePassword: access.canEdit
                  ? Boolean(access.bank.share_password && access.bank.share_password.trim())
                  : false,
              }
            : {}),
          lastProgressIndex: Number(progRows[0]?.last_question_index ?? 0),
          createdAt: new Date(access.bank.created_at).toISOString(),
          updatedAt: new Date(access.bank.updated_at).toISOString(),
        },
        chapters,
        questions,
        stats: bankStats,
      });
    } catch (err) {
      console.error('[get bank detail]', err);
      res.status(500).json({ error: '获取题库详情失败' });
    }
  });

  router.put('/:id', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权修改该题库' });
        return;
      }

      const title = isPresent(req.body?.title) ? String(req.body.title).trim() : access.bank.title;
      const description = isPresent(req.body?.description)
        ? String(req.body.description).trim()
        : access.bank.description;
      const category = isPresent(req.body?.category)
        ? String(req.body.category).trim() || '默认分类'
        : access.bank.category;
      const visibility =
        req.body?.visibility === 'public' || req.body?.visibility === 'private'
          ? req.body.visibility
          : access.bank.visibility;

      if (!title) {
        res.status(400).json({ error: '题库名称不能为空' });
        return;
      }

      await db.query(
        `UPDATE question_banks
         SET title = $1, description = $2, category = $3, visibility = $4, updated_at = NOW()
         WHERE id = $5`,
        [title, description, category, visibility, access.bank.id]
      );

      res.json({ ok: true });
    } catch (err) {
      console.error('[update bank]', err);
      res.status(500).json({ error: '更新题库信息失败' });
    }
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权删除该题库' });
        return;
      }
      await db.query('DELETE FROM question_banks WHERE id = $1', [access.bank.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[delete bank]', err);
      res.status(500).json({ error: '删除题库失败' });
    }
  });

  router.post('/:id/clone', requireAuth, async (req, res) => {
    try {
      const bankId = String(req.params.id);
      const access = await findBankWithAccess(bankId, req.user!.userId, req.user!.role);
      if (!access || !access.canRead) {
        res.status(404).json({ error: '题库不存在或未公开' });
        return;
      }

      const newBankId = await db.withTransaction(async (tx) => {
        const customTitle = String(req.body?.title ?? '').trim() || `${access.bank.title}（我的副本）`;
        const { rows: newBankRows } = await tx.query<{ id: string }>(
          `INSERT INTO question_banks (owner_id, title, description, category, visibility)
           VALUES ($1, $2, $3, $4, 'private')
           RETURNING id`,
          [req.user!.userId, customTitle, access.bank.description, access.bank.category]
        );
        const targetId = newBankRows[0].id;

        const { rows: oldChapters } = await tx.query<{ id: string; title: string; sort_order: number }>(
          'SELECT id, title, sort_order FROM chapters WHERE bank_id = $1 ORDER BY sort_order ASC',
          [bankId]
        );
        const chapterIdMap = new Map<string, string>();
        for (const ch of oldChapters) {
          const { rows: chRows } = await tx.query<{ id: string }>(
            'INSERT INTO chapters (bank_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
            [targetId, ch.title, ch.sort_order]
          );
          chapterIdMap.set(ch.id, chRows[0].id);
        }

        const { rows: oldQuestions } = await tx.query<{
          chapter_id: string | null;
          type: QuestionType;
          stem: string;
          options: QuestionOption[];
          answer: string;
          explanation: string;
          difficulty: number;
          star_rating: number;
          rating_reason: string;
          rated_at: Date | string | null;
          tags: string[];
          sort_order: number;
        }>('SELECT * FROM questions WHERE bank_id = $1 ORDER BY sort_order ASC, created_at ASC', [bankId]);

        for (const q of oldQuestions) {
          const mappedCh = q.chapter_id ? chapterIdMap.get(q.chapter_id) ?? null : null;
          await tx.query(
            `INSERT INTO questions (bank_id, chapter_id, type, stem, options, answer, explanation, difficulty, star_rating, rating_reason, rated_at, tags, sort_order)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
            [
              targetId,
              mappedCh,
              q.type,
              q.stem,
              JSON.stringify(q.options || []),
              q.answer,
              q.explanation || '',
              q.difficulty || 2,
              Number(q.star_rating ?? 0),
              q.rating_reason || '',
              q.rated_at ? new Date(q.rated_at) : null,
              JSON.stringify(q.tags || []),
              q.sort_order || 0,
            ]
          );
        }

        await tx.query('UPDATE question_banks SET clone_count = clone_count + 1 WHERE id = $1', [bankId]);
        return targetId;
      });

      res.status(201).json({ id: newBankId });
    } catch (err) {
      console.error('[clone bank]', err);
      res.status(500).json({ error: '克隆题库失败' });
    }
  });

  // 题库二维码分享（公开题库所有有读权限成员可生成；私有题库作者可一键开启并生成）
  router.get('/:id/share-qrcode', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canRead) {
        res.status(404).json({ error: '题库不存在或无权访问' });
        return;
      }

      const isPublic = access.bank.visibility === 'public';
      if (!isPublic && !access.canEdit && !access.bank.share_enabled) {
        res.status(403).json({ error: '该私有题库暂未开启二维码分享，请联系作者开启' });
        return;
      }

      let shareCode = String(access.bank.share_code || '').trim();
      let shareEnabled = Boolean(access.bank.share_enabled);
      if (!shareCode || (!shareEnabled && (isPublic || access.canEdit))) {
        if (!shareCode) {
          shareCode = await generateUniqueBankShareCode(db);
        }
        shareEnabled = true;
        await db.query(
          `UPDATE question_banks
           SET share_code = $1, share_enabled = TRUE, updated_at = NOW()
           WHERE id = $2`,
          [shareCode, access.bank.id]
        );
      }

      const cfg = getAppConfig();
      const origin = resolveShareOrigin(req, cfg);
      const shareUrl = `${origin}/banks/share/${shareCode}`;
      const miniProgramPath = `/pages/bank-share/bank-share?code=${shareCode}`;
      const format = String(req.query.format || 'json').trim().toLowerCase();

      if (format === 'png') {
        const png = await generateQrPngBuffer(shareUrl, 440);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'no-store');
        res.send(png);
        return;
      }
      if (format === 'svg') {
        const svg = await generateQrSvg(shareUrl, 340);
        res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.send(svg);
        return;
      }

      const qrDataUrl = await generateQrDataUrl(shareUrl, 420);
      const { rows: cntRows } = await db.query<{ cnt: string | number }>(
        'SELECT COUNT(*) AS cnt FROM questions WHERE bank_id = $1',
        [access.bank.id]
      );

      res.json({
        bankId: access.bank.id,
        title: access.bank.title,
        visibility: access.bank.visibility,
        shareCode,
        shareEnabled,
        requiresPassword: !isPublic && Boolean(access.bank.share_password && access.bank.share_password.trim()),
        questionCount: Number(cntRows[0]?.cnt ?? 0),
        shareUrl,
        miniProgramPath,
        qrDataUrl,
      });
    } catch (err) {
      console.error('[bank share qrcode]', err);
      res.status(500).json({ error: '生成题库分享二维码失败' });
    }
  });

  // 一键规范化题库中的代码片段排版与围栏格式
  router.post('/:id/format-code', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '仅题库作者或管理员可批量规范代码格式' });
        return;
      }

      const { rows } = await db.query<{
        id: string;
        stem: string;
        options: QuestionOption[];
        explanation: string;
      }>('SELECT id, stem, options, explanation FROM questions WHERE bank_id = $1', [access.bank.id]);

      let formattedCount = 0;
      await db.withTransaction(async (tx) => {
        for (const q of rows) {
          const nextStem = normalizeCodeInText(String(q.stem || ''));
          const nextExplanation = q.explanation ? normalizeCodeInText(String(q.explanation)) : '';
          const origOpts = Array.isArray(q.options) ? q.options : [];
          const nextOpts = origOpts.map((o) => ({
            ...o,
            content:
              o.content && (o.content.includes('```') || o.content.includes('\n'))
                ? normalizeCodeInText(o.content)
                : o.content,
          }));
          const changed =
            nextStem !== String(q.stem || '') ||
            nextExplanation !== String(q.explanation || '') ||
            JSON.stringify(nextOpts) !== JSON.stringify(origOpts);
          if (changed) {
            formattedCount += 1;
            await tx.query(
              `UPDATE questions
               SET stem = $1, options = $2::jsonb, explanation = $3, updated_at = NOW()
               WHERE id = $4`,
              [nextStem, JSON.stringify(nextOpts), nextExplanation, q.id]
            );
          }
        }
        if (formattedCount > 0) {
          await tx.query('UPDATE question_banks SET updated_at = NOW() WHERE id = $1', [access.bank.id]);
        }
      });

      res.json({
        ok: true,
        scannedCount: rows.length,
        formattedCount,
      });
    } catch (err) {
      console.error('[format bank code]', err);
      res.status(500).json({ error: '规范化题库代码格式失败' });
    }
  });

  // 私有题库私密分享管理（仅作者或管理员可读写分享设置；被分享者仅允许移除自己）
  router.get('/:id/shares', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '仅题库创建者可管理私密分享设置' });
        return;
      }

      const members = await listBankShareMembers(access.bank.id);
      res.json({
        bankId: access.bank.id,
        shareEnabled: Boolean(access.bank.share_enabled),
        shareCode: access.bank.share_code || '',
        hasSharePassword: Boolean(access.bank.share_password && access.bank.share_password.trim()),
        members,
      });
    } catch (err) {
      console.error('[get bank shares]', err);
      res.status(500).json({ error: '获取私密分享设置失败' });
    }
  });

  router.put('/:id/share-settings', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '仅题库创建者可修改私密分享设置' });
        return;
      }

      const nextEnabled = isPresent(req.body?.shareEnabled)
        ? Boolean(req.body.shareEnabled)
        : Boolean(access.bank.share_enabled);
      const resetCode = Boolean(req.body?.resetCode);
      const clearPassword = Boolean(req.body?.clearPassword);

      let nextCode = access.bank.share_code || '';
      if (resetCode || (nextEnabled && !nextCode)) {
        nextCode = await generateUniqueBankShareCode(db);
      }

      let nextPassword = access.bank.share_password || '';
      if (clearPassword) {
        nextPassword = '';
      } else if (isPresent(req.body?.sharePassword)) {
        nextPassword = String(req.body.sharePassword).trim();
      }

      // 严禁私密分享改变 visibility（保持原题库私有性质）
      await db.query(
        `UPDATE question_banks
         SET share_enabled = $1, share_code = NULLIF($2, ''), share_password = $3, updated_at = NOW()
         WHERE id = $4`,
        [nextEnabled, nextCode, nextPassword, access.bank.id]
      );

      const members = await listBankShareMembers(access.bank.id);
      res.json({
        bankId: access.bank.id,
        shareEnabled: nextEnabled,
        shareCode: nextCode,
        hasSharePassword: Boolean(nextPassword),
        members,
      });
    } catch (err) {
      console.error('[update bank share settings]', err);
      res.status(500).json({ error: '更新私密分享设置失败' });
    }
  });

  router.post('/:id/shares', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '仅题库创建者可添加定向分享对象' });
        return;
      }

      const account = String(req.body?.account ?? req.body?.username ?? req.body?.email ?? '').trim();
      if (!account) {
        res.status(400).json({ error: '请输入需要分享的对方用户名或邮箱' });
        return;
      }

      const { rows: targetRows } = await db.query<{ id: string }>(
        `SELECT id FROM users
         WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)
         LIMIT 1`,
        [account]
      );
      if (targetRows.length === 0) {
        res.status(404).json({ error: '未找到该用户名或邮箱对应的注册用户' });
        return;
      }

      const targetUserId = targetRows[0].id;
      if (targetUserId === access.bank.owner_id) {
        res.status(400).json({ error: '无需授权给题库创建者本人' });
        return;
      }

      await db.query(
        `INSERT INTO bank_shares (bank_id, user_id, granted_by, via)
         VALUES ($1, $2, $3, 'direct')
         ON CONFLICT (bank_id, user_id) DO NOTHING`,
        [access.bank.id, targetUserId, req.user!.userId]
      );

      const members = await listBankShareMembers(access.bank.id);
      res.status(201).json({ members });
    } catch (err) {
      console.error('[add bank share member]', err);
      res.status(500).json({ error: '添加定向分享成员失败' });
    }
  });

  router.delete('/:id/shares/:targetUserId', requireAuth, async (req, res) => {
    try {
      const bankId = String(req.params.id);
      const targetUserId = String(req.params.targetUserId);
      const access = await findBankWithAccess(bankId, req.user!.userId, req.user!.role);
      if (!access) {
        res.status(404).json({ error: '题库不存在' });
        return;
      }

      const isSelfExit = targetUserId === req.user!.userId;
      if (!access.canEdit && !isSelfExit) {
        res.status(403).json({ error: '无权撤销他人的分享访问权限' });
        return;
      }

      await db.query('DELETE FROM bank_shares WHERE bank_id = $1 AND user_id = $2', [
        access.bank.id,
        targetUserId,
      ]);

      const members = access.canEdit ? await listBankShareMembers(access.bank.id) : [];
      res.json({ ok: true, members });
    } catch (err) {
      console.error('[remove bank share member]', err);
      res.status(500).json({ error: '移除分享成员失败' });
    }
  });

  // 章节管理
  router.post('/:id/chapters', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权管理此题库章节' });
        return;
      }
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        res.status(400).json({ error: '章节名称不能为空' });
        return;
      }
      const { rows: maxRows } = await db.query<{ max_order: number | null }>(
        'SELECT MAX(sort_order) AS max_order FROM chapters WHERE bank_id = $1',
        [access.bank.id]
      );
      const nextOrder = Number(maxRows[0]?.max_order ?? 0) + 1;
      const { rows } = await db.query<{ id: string }>(
        'INSERT INTO chapters (bank_id, title, sort_order) VALUES ($1, $2, $3) RETURNING id',
        [access.bank.id, title, nextOrder]
      );
      res.status(201).json({ id: rows[0].id, bankId: access.bank.id, title, sortOrder: nextOrder, questionCount: 0 });
    } catch (err) {
      console.error('[create chapter]', err);
      res.status(500).json({ error: '创建章节失败' });
    }
  });

  router.put('/:id/chapters/:chapterId', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权修改此章节' });
        return;
      }
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        res.status(400).json({ error: '章节名称不能为空' });
        return;
      }
      await db.query('UPDATE chapters SET title = $1 WHERE id = $2 AND bank_id = $3', [
        title,
        req.params.chapterId,
        access.bank.id,
      ]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[update chapter]', err);
      res.status(500).json({ error: '更新章节失败' });
    }
  });

  router.delete('/:id/chapters/:chapterId', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权删除此章节' });
        return;
      }
      await db.query('DELETE FROM chapters WHERE id = $1 AND bank_id = $2', [
        req.params.chapterId,
        access.bank.id,
      ]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[delete chapter]', err);
      res.status(500).json({ error: '删除章节失败' });
    }
  });

  // 单题 CRUD
  router.post('/:id/questions', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权向该题库添加题目' });
        return;
      }

      const type = String(req.body?.type ?? 'single') as QuestionType;
      const rawStem = String(req.body?.stem ?? '').trim();
      if (!rawStem) {
        res.status(400).json({ error: '题干不能为空' });
        return;
      }
      const stem = normalizeCodeInText(rawStem);
      const options = sanitizeOptions(type, req.body?.options).map((opt) =>
        opt.content.includes('```') || opt.content.includes('\n')
          ? { ...opt, content: normalizeCodeInText(opt.content) }
          : opt
      );
      const answer = normalizeAnswer(type, String(req.body?.answer ?? ''));
      const rawExplanation = String(req.body?.explanation ?? '').trim();
      const explanation = rawExplanation ? normalizeCodeInText(rawExplanation) : '';
      const difficulty = Math.min(5, Math.max(1, Number(req.body?.difficulty ?? 2) || 2));
      const starRating = Math.min(5, Math.max(0, Math.round(Number(req.body?.starRating ?? 0) || 0)));
      const ratingReason = String(req.body?.ratingReason ?? '').trim().slice(0, 80);
      const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [];
      const chapterId = req.body?.chapterId ? String(req.body.chapterId) : null;

      const { rows: maxRows } = await db.query<{ max_order: number | null }>(
        'SELECT MAX(sort_order) AS max_order FROM questions WHERE bank_id = $1',
        [access.bank.id]
      );
      const sortOrder = Number(maxRows[0]?.max_order ?? 0) + 1;

      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO questions (bank_id, chapter_id, type, stem, options, answer, explanation, difficulty, star_rating, rating_reason, rated_at, tags, sort_order)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
         RETURNING id`,
        [
          access.bank.id,
          chapterId,
          type,
          stem,
          JSON.stringify(options),
          answer,
          explanation,
          difficulty,
          starRating,
          ratingReason,
          starRating > 0 ? new Date() : null,
          JSON.stringify(tags),
          sortOrder,
        ]
      );
      await db.query('UPDATE question_banks SET updated_at = NOW() WHERE id = $1', [access.bank.id]);

      res.status(201).json({ id: rows[0].id });
    } catch (err) {
      console.error('[create question]', err);
      res.status(500).json({ error: '添加题目失败' });
    }
  });

  router.post('/:id/questions/batch', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权批量导入题目到该题库' });
        return;
      }

      const items = Array.isArray(req.body?.questions) ? req.body.questions : [];
      const skipInvalid = Boolean(req.body?.skipInvalid);
      const result = await batchInsertQuestionsToBank(db, {
        bankId: access.bank.id,
        items,
        skipInvalid,
      });

      if (!result.ok) {
        res.status(400).json({
          error: result.error,
          ...(result.invalidItems ? { invalidItems: result.invalidItems } : {}),
        });
        return;
      }

      res.status(201).json({
        insertedCount: result.insertedCount,
        skippedCount: result.skippedCount,
      });
    } catch (err) {
      console.error('[batch insert questions]', err);
      res.status(500).json({ error: '批量导入题目失败' });
    }
  });

  router.put('/:id/questions/:qid', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权编辑此题目' });
        return;
      }

      const type = String(req.body?.type ?? 'single') as QuestionType;
      const rawStem = String(req.body?.stem ?? '').trim();
      if (!rawStem) {
        res.status(400).json({ error: '题干不能为空' });
        return;
      }
      const stem = normalizeCodeInText(rawStem);
      const options = sanitizeOptions(type, req.body?.options).map((opt) =>
        opt.content.includes('```') || opt.content.includes('\n')
          ? { ...opt, content: normalizeCodeInText(opt.content) }
          : opt
      );
      const answer = normalizeAnswer(type, String(req.body?.answer ?? ''));
      const rawExplanation = String(req.body?.explanation ?? '').trim();
      const explanation = rawExplanation ? normalizeCodeInText(rawExplanation) : '';
      const difficulty = Math.min(5, Math.max(1, Number(req.body?.difficulty ?? 2) || 2));
      const tags = Array.isArray(req.body?.tags) ? req.body.tags.map(String) : [];
      const chapterId = req.body?.chapterId ? String(req.body.chapterId) : null;

      const { rows: prevRows } = await db.query<{
        star_rating: number;
        rating_reason: string;
        rated_at: Date | string | null;
      }>('SELECT star_rating, rating_reason, rated_at FROM questions WHERE id = $1 AND bank_id = $2', [
        req.params.qid,
        access.bank.id,
      ]);
      const prevRating = prevRows[0];
      const starRating = isPresent(req.body?.starRating)
        ? Math.min(5, Math.max(0, Math.round(Number(req.body.starRating) || 0)))
        : Number(prevRating?.star_rating ?? 0);
      const ratingReason = isPresent(req.body?.ratingReason)
        ? String(req.body.ratingReason).trim().slice(0, 80)
        : String(prevRating?.rating_reason ?? '');
      const ratedAt =
        starRating > 0
          ? prevRating?.rated_at
            ? new Date(prevRating.rated_at)
            : new Date()
          : null;

      await db.query(
        `UPDATE questions
         SET chapter_id = $1, type = $2, stem = $3, options = $4::jsonb, answer = $5,
             explanation = $6, difficulty = $7, star_rating = $8, rating_reason = $9, rated_at = $10,
             tags = $11::jsonb, updated_at = NOW()
         WHERE id = $12 AND bank_id = $13`,
        [
          chapterId,
          type,
          stem,
          JSON.stringify(options),
          answer,
          explanation,
          difficulty,
          starRating,
          ratingReason,
          ratedAt,
          JSON.stringify(tags),
          req.params.qid,
          access.bank.id,
        ]
      );
      await db.query('UPDATE question_banks SET updated_at = NOW() WHERE id = $1', [access.bank.id]);

      res.json({ ok: true });
    } catch (err) {
      console.error('[update question]', err);
      res.status(500).json({ error: '更新题目失败' });
    }
  });

  router.delete('/:id/questions/:qid', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canEdit) {
        res.status(403).json({ error: '无权删除此题目' });
        return;
      }
      await db.query('DELETE FROM questions WHERE id = $1 AND bank_id = $2', [
        req.params.qid,
        access.bank.id,
      ]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[delete question]', err);
      res.status(500).json({ error: '删除题目失败' });
    }
  });

  router.get('/:id/export', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canRead) {
        res.status(404).json({ error: '题库不存在或无权导出' });
        return;
      }
      const onlyMistakes = req.query.onlyMistakes === 'true';

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT q.*, c.title AS chapter_title
         FROM questions q
         LEFT JOIN chapters c ON c.id = q.chapter_id
         LEFT JOIN user_question_records r ON r.question_id = q.id AND r.user_id = $2
         WHERE q.bank_id = $1 ${onlyMistakes ? 'AND r.in_mistake_book = TRUE' : ''}
         ORDER BY q.sort_order ASC, q.created_at ASC`,
        [access.bank.id, req.user!.userId]
      );

      const items = rows.map((q) => ({
        chapterTitle: q.chapter_title ? String(q.chapter_title) : '',
        type: q.type as QuestionType,
        stem: String(q.stem),
        options: Array.isArray(q.options) ? (q.options as QuestionOption[]) : [],
        answer: String(q.answer),
        explanation: String(q.explanation || ''),
        difficulty: Number(q.difficulty ?? 2),
        tags: Array.isArray(q.tags) ? (q.tags as string[]) : [],
      }));

      const buffer = exportQuestionsToWorkbook(items, access.bank.title);
      const suffix = onlyMistakes ? '_错题本' : '';
      const filename = encodeURIComponent(`${access.bank.title}${suffix}.xlsx`);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.send(buffer);
    } catch (err) {
      console.error('[export bank]', err);
      res.status(500).json({ error: '导出题库失败' });
    }
  });

  router.get('/:id/export-word', requireAuth, async (req, res) => {
    try {
      const access = await findBankWithAccess(String(req.params.id), req.user!.userId, req.user!.role);
      if (!access || !access.canRead) {
        res.status(404).json({ error: '题库不存在或无权导出' });
        return;
      }
      const onlyMistakes = req.query.onlyMistakes === 'true';

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT q.*, c.title AS chapter_title
         FROM questions q
         LEFT JOIN chapters c ON c.id = q.chapter_id
         LEFT JOIN user_question_records r ON r.question_id = q.id AND r.user_id = $2
         WHERE q.bank_id = $1 ${onlyMistakes ? 'AND r.in_mistake_book = TRUE' : ''}
         ORDER BY q.sort_order ASC, q.created_at ASC`,
        [access.bank.id, req.user!.userId]
      );

      const items = rows.map((q) => ({
        chapterTitle: q.chapter_title ? String(q.chapter_title) : '',
        type: q.type as QuestionType,
        stem: String(q.stem),
        options: Array.isArray(q.options) ? (q.options as QuestionOption[]) : [],
        answer: String(q.answer),
        explanation: String(q.explanation || ''),
        difficulty: Number(q.difficulty ?? 2),
        tags: Array.isArray(q.tags) ? (q.tags as string[]) : [],
      }));

      const buffer = exportQuestionsToDocx(items);
      const suffix = onlyMistakes ? '_错题本' : '';
      const filename = encodeURIComponent(`${access.bank.title}${suffix}.docx`);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      );
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.send(buffer);
    } catch (err) {
      console.error('[export bank word]', err);
      res.status(500).json({ error: '导出 Word 题库失败' });
    }
  });

  return router;
}
