import { Router } from 'express';
import type { DbClient } from '../db/client.js';
import { createAuthMiddlewares } from '../middleware/auth.js';
import { gradeQuestionAnswer } from '../services/grader.js';
import {
  isPresent,
  sanitizeDisplayName,
  type PracticeMode,
  type QuestionItem,
  type QuestionOption,
  type QuestionType,
  type UserSettings,
} from '../../shared/types.js';

function mapQuestionRow(q: Record<string, unknown>): QuestionItem & { bankTitle?: string } {
  return {
    id: String(q.id),
    bankId: String(q.bank_id),
    bankTitle: q.bank_title ? String(q.bank_title) : undefined,
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
    record:
      q.answered_count !== null && q.answered_count !== undefined
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
  };
}

export function createPracticeRouter(db: DbClient): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddlewares(db);

  router.get('/dashboard', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.userId;

      const { rows: statsRows } = await db.query<Record<string, unknown>>(
        `SELECT
           (SELECT COUNT(*) FROM question_banks WHERE owner_id = $1) AS my_banks_count,
           (SELECT COALESCE(SUM(answered_count), 0) FROM user_question_records WHERE user_id = $1) AS total_answered,
           (SELECT COALESCE(SUM(correct_count), 0) FROM user_question_records WHERE user_id = $1) AS total_correct,
           (SELECT COUNT(*) FROM user_question_records WHERE user_id = $1 AND in_mistake_book = TRUE) AS mistake_count,
           (SELECT COUNT(*) FROM user_question_records WHERE user_id = $1 AND is_mastered = TRUE) AS mastered_count,
           (SELECT COUNT(*) FROM user_question_records WHERE user_id = $1 AND is_favorited = TRUE) AS favorite_count`,
        [userId]
      );

      const s = statsRows[0] || {};
      const totalAnswered = Number(s.total_answered ?? 0);
      const totalCorrect = Number(s.total_correct ?? 0);

      const { rows: recentBanks } = await db.query<Record<string, unknown>>(
        `SELECT
           b.id, b.title, b.category, b.visibility,
           p.last_question_index, p.last_mode, p.updated_at AS last_practiced_at,
           (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count,
           (SELECT COUNT(*) FROM user_question_records r WHERE r.bank_id = b.id AND r.user_id = $1 AND r.answered_count > 0) AS practiced_count
         FROM user_bank_progress p
         JOIN question_banks b ON b.id = p.bank_id
         WHERE p.user_id = $1 AND (
           b.owner_id = $1
           OR b.visibility = 'public'
           OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $1)
         )
         ORDER BY p.updated_at DESC
         LIMIT 4`,
        [userId]
      );

      const { rows: publicBanks } = await db.query<Record<string, unknown>>(
        `SELECT b.id, b.title, b.description, b.category, b.clone_count,
                CASE
                  WHEN BTRIM(COALESCE(u.nickname, '')) = '' OR LOWER(BTRIM(u.nickname)) IN ('null', 'undefined')
                  THEN u.username
                  ELSE BTRIM(u.nickname)
                END AS owner_name,
                u.username AS owner_username,
                (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id) AS question_count
         FROM question_banks b
         JOIN users u ON u.id = b.owner_id
         WHERE b.visibility = 'public'
         ORDER BY b.clone_count DESC, b.updated_at DESC
         LIMIT 4`
      );

      const { rows: activeExams } = await db.query<Record<string, unknown>>(
        `SELECT e.id, e.title, e.share_code, e.duration_minutes, e.exam_type, e.status, e.created_at
         FROM exams e
         WHERE (e.creator_id = $1 OR e.exam_type = 'published') AND e.status = 'active'
         ORDER BY e.created_at DESC
         LIMIT 4`,
        [userId]
      );

      res.json({
        stats: {
          myBanksCount: Number(s.my_banks_count ?? 0),
          totalAnswered,
          totalCorrect,
          accuracy: totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
          mistakeCount: Number(s.mistake_count ?? 0),
          masteredCount: Number(s.mastered_count ?? 0),
          favoriteCount: Number(s.favorite_count ?? 0),
        },
        recentBanks: recentBanks.map((r) => ({
          id: String(r.id),
          title: String(r.title),
          category: String(r.category),
          visibility: String(r.visibility),
          lastQuestionIndex: Number(r.last_question_index ?? 0),
          lastMode: String(r.last_mode || 'sequential'),
          questionCount: Number(r.question_count ?? 0),
          practicedCount: Number(r.practiced_count ?? 0),
        })),
        publicBanks: publicBanks.map((r) => ({
          id: String(r.id),
          title: String(r.title),
          description: String(r.description || ''),
          category: String(r.category),
          cloneCount: Number(r.clone_count ?? 0),
          ownerName: sanitizeDisplayName(r.owner_name, sanitizeDisplayName(r.owner_username, '匿名')),
          questionCount: Number(r.question_count ?? 0),
        })),
        activeExams: activeExams.map((e) => ({
          id: String(e.id),
          title: String(e.title),
          shareCode: String(e.share_code),
          durationMinutes: Number(e.duration_minutes ?? 60),
          examType: String(e.exam_type),
        })),
      });
    } catch (err) {
      console.error('[dashboard]', err);
      res.status(500).json({ error: '获取学习统计失败' });
    }
  });

  router.get('/session', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const bankId = String(req.query.bankId || '').trim();
      const mode = String(req.query.mode || 'sequential') as PracticeMode;
      const chapterId = String(req.query.chapterId || '').trim();
      const type = String(req.query.type || '').trim();
      const difficultyTier = String(req.query.difficultyTier || '').trim();
      const minStar = Math.min(5, Math.max(0, Number(req.query.minStar || 0) || 0));
      const excludeMastered = req.query.excludeMastered === 'true';
      const onlyUnanswered = req.query.onlyUnanswered === 'true' || mode === 'unanswered';

      const params: unknown[] = [userId];
      const clauses: string[] = [
        `(b.owner_id = $1 OR b.visibility = 'public' OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $1) OR $2 = 'admin')`,
      ];
      params.push(req.user!.role);

      if (bankId && bankId !== 'all') {
        params.push(bankId);
        clauses.push(`q.bank_id = $${params.length}`);
      }
      if (chapterId) {
        params.push(chapterId);
        clauses.push(`q.chapter_id = $${params.length}`);
      }
      if (type && ['single', 'multiple', 'boolean', 'fill', 'short'].includes(type)) {
        params.push(type);
        clauses.push(`q.type = $${params.length}`);
      }
      if (difficultyTier === 'easy') {
        clauses.push(`q.difficulty <= 2`);
      } else if (difficultyTier === 'medium') {
        clauses.push(`q.difficulty = 3`);
      } else if (difficultyTier === 'hard') {
        clauses.push(`q.difficulty >= 4`);
      }
      if (minStar > 0) {
        params.push(minStar);
        clauses.push(`q.star_rating >= $${params.length}`);
      }
      if (mode === 'mistakes') {
        clauses.push(`r.in_mistake_book = TRUE`);
      } else if (mode === 'favorites') {
        clauses.push(`r.is_favorited = TRUE`);
      } else if (mode === 'unmastered' || excludeMastered) {
        clauses.push(`COALESCE(r.is_mastered, FALSE) = FALSE`);
      }
      if (onlyUnanswered) {
        clauses.push(`COALESCE(r.answered_count, 0) = 0`);
      }

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT
           q.*,
           b.title AS bank_title,
           c.title AS chapter_title,
           r.answered_count, r.correct_count, r.wrong_count, r.consecutive_correct,
           r.in_mistake_book, r.is_mastered, r.is_favorited, r.note, r.last_answer, r.last_is_correct
         FROM questions q
         JOIN question_banks b ON b.id = q.bank_id
         LEFT JOIN chapters c ON c.id = q.chapter_id
         LEFT JOIN user_question_records r ON r.question_id = q.id AND r.user_id = $1
         WHERE ${clauses.join(' AND ')}
         ORDER BY q.sort_order ASC, q.created_at ASC`,
        params
      );

      const questions = rows.map(mapQuestionRow);
      if (mode === 'random') {
        for (let i = questions.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [questions[i], questions[j]] = [questions[j], questions[i]];
        }
      }

      const firstUnansweredIdx = questions.findIndex((q) => !q.record || q.record.answeredCount === 0);
      const nextUnansweredIndex = firstUnansweredIdx >= 0 ? firstUnansweredIdx : 0;

      let lastProgressIndex = 0;
      if (bankId && bankId !== 'all' && mode === 'sequential' && questions.length > 0) {
        const { rows: progRows } = await db.query<{ last_question_index: number }>(
          'SELECT last_question_index FROM user_bank_progress WHERE user_id = $1 AND bank_id = $2',
          [userId, bankId]
        );
        if (progRows.length > 0) {
          const saved = Number(progRows[0].last_question_index ?? 0);
          lastProgressIndex = saved >= 0 && saved < questions.length ? saved : 0;
        } else {
          lastProgressIndex = nextUnansweredIndex;
        }
      }

      res.json({
        questions,
        lastProgressIndex,
        nextUnansweredIndex,
        total: questions.length,
      });
    } catch (err) {
      console.error('[practice session]', err);
      res.status(500).json({ error: '加载刷题会话失败' });
    }
  });

  router.put('/progress', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const bankId = String(req.body?.bankId ?? '').trim();
      const rawIdx = req.body?.currentIndex;
      const mode = String(req.body?.mode ?? 'sequential').trim() || 'sequential';

      if (!bankId || bankId === 'all' || !isPresent(rawIdx)) {
        res.status(400).json({ error: '无效的刷题进度参数' });
        return;
      }

      const numIdx = Number(rawIdx);
      if (!Number.isFinite(numIdx) || numIdx < 0) {
        res.status(400).json({ error: '题号索引无效' });
        return;
      }

      const { rows: bankRows } = await db.query<{ id: string }>(
        `SELECT b.id
         FROM question_banks b
         WHERE b.id = $1 AND (
           b.owner_id = $2
           OR b.visibility = 'public'
           OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2)
           OR $3 = 'admin'
         )`,
        [bankId, userId, req.user!.role]
      );
      if (bankRows.length === 0) {
        res.status(404).json({ error: '题库不存在或无权保存进度' });
        return;
      }

      const clampedIndex = Math.max(0, Math.floor(numIdx));
      await db.query(
        `INSERT INTO user_bank_progress (user_id, bank_id, last_question_index, last_mode, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, bank_id) DO UPDATE SET
           last_question_index = EXCLUDED.last_question_index,
           last_mode = EXCLUDED.last_mode,
           updated_at = NOW()`,
        [userId, bankId, clampedIndex, mode]
      );

      res.json({ ok: true, lastQuestionIndex: clampedIndex });
    } catch (err) {
      console.error('[save practice progress]', err);
      res.status(500).json({ error: '保存刷题进度失败' });
    }
  });

  router.post('/answer', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const questionId = String(req.body?.questionId ?? '');
      const userAnswer = String(req.body?.answer ?? '');
      const currentIndex = isPresent(req.body?.currentIndex) ? Number(req.body.currentIndex) : undefined;
      const mode = String(req.body?.mode ?? 'sequential');

      const { rows: qRows } = await db.query<{
        id: string;
        bank_id: string;
        type: QuestionType;
        answer: string;
        explanation: string;
      }>(
        `SELECT q.id, q.bank_id, q.type, q.answer, q.explanation
         FROM questions q
         JOIN question_banks b ON b.id = q.bank_id
         WHERE q.id = $1 AND (
           b.owner_id = $2
           OR b.visibility = 'public'
           OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2)
           OR $3 = 'admin'
         )`,
        [questionId, userId, req.user!.role]
      );
      if (qRows.length === 0) {
        res.status(404).json({ error: '题目不存在或无权作答' });
        return;
      }
      const q = qRows[0];

      const { rows: userRows } = await db.query<{ settings: UserSettings }>(
        'SELECT settings FROM users WHERE id = $1',
        [userId]
      );
      const threshold = Math.max(1, Number(userRows[0]?.settings?.removeAfterCorrectCount ?? 3) || 3);

      const graded = gradeQuestionAnswer(q.type, q.answer, userAnswer);

      const { rows: existingRows } = await db.query<{
        answered_count: number;
        correct_count: number;
        wrong_count: number;
        consecutive_correct: number;
        in_mistake_book: boolean;
        is_mastered: boolean;
        is_favorited: boolean;
        note: string;
      }>('SELECT * FROM user_question_records WHERE user_id = $1 AND question_id = $2', [
        userId,
        questionId,
      ]);
      const prev = existingRows[0];

      const answeredCount = Number(prev?.answered_count ?? 0) + 1;
      const correctCount = Number(prev?.correct_count ?? 0) + (graded.isCorrect ? 1 : 0);
      const wrongCount = Number(prev?.wrong_count ?? 0) + (graded.isCorrect ? 0 : 1);
      const consecutiveCorrect = graded.isCorrect ? Number(prev?.consecutive_correct ?? 0) + 1 : 0;

      let inMistakeBook = prev ? Boolean(prev.in_mistake_book) : false;
      let removedFromMistakeBook = false;
      if (!graded.isCorrect) {
        inMistakeBook = true;
      } else if (inMistakeBook && consecutiveCorrect >= threshold) {
        inMistakeBook = false;
        removedFromMistakeBook = true;
      }

      const { rows: upserted } = await db.query<Record<string, unknown>>(
        `INSERT INTO user_question_records (
           user_id, question_id, bank_id, answered_count, correct_count, wrong_count,
           consecutive_correct, in_mistake_book, is_mastered, is_favorited, note,
           last_answer, last_is_correct, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         ON CONFLICT (user_id, question_id) DO UPDATE SET
           answered_count = EXCLUDED.answered_count,
           correct_count = EXCLUDED.correct_count,
           wrong_count = EXCLUDED.wrong_count,
           consecutive_correct = EXCLUDED.consecutive_correct,
           in_mistake_book = EXCLUDED.in_mistake_book,
           last_answer = EXCLUDED.last_answer,
           last_is_correct = EXCLUDED.last_is_correct,
           updated_at = NOW()
         RETURNING *`,
        [
          userId,
          questionId,
          q.bank_id,
          answeredCount,
          correctCount,
          wrongCount,
          consecutiveCorrect,
          inMistakeBook,
          prev ? Boolean(prev.is_mastered) : false,
          prev ? Boolean(prev.is_favorited) : false,
          prev ? String(prev.note || '') : '',
          graded.normalizedUser,
          graded.isCorrect,
        ]
      );

      if (currentIndex !== undefined && Number.isFinite(currentIndex)) {
        await db.query(
          `INSERT INTO user_bank_progress (user_id, bank_id, last_question_index, last_mode, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (user_id, bank_id) DO UPDATE SET
             last_question_index = EXCLUDED.last_question_index,
             last_mode = EXCLUDED.last_mode,
             updated_at = NOW()`,
          [userId, q.bank_id, Math.max(0, Math.floor(currentIndex)), mode]
        );
      }

      const rec = upserted[0];
      res.json({
        isCorrect: graded.isCorrect,
        standardAnswer: q.answer,
        explanation: q.explanation,
        removedFromMistakeBook,
        threshold,
        record: {
          answeredCount: Number(rec.answered_count),
          correctCount: Number(rec.correct_count),
          wrongCount: Number(rec.wrong_count),
          consecutiveCorrect: Number(rec.consecutive_correct),
          inMistakeBook: Boolean(rec.in_mistake_book),
          isMastered: Boolean(rec.is_mastered),
          isFavorited: Boolean(rec.is_favorited),
          note: String(rec.note || ''),
          lastAnswer: rec.last_answer ? String(rec.last_answer) : null,
          lastIsCorrect: Boolean(rec.last_is_correct),
        },
      });
    } catch (err) {
      console.error('[submit practice answer]', err);
      res.status(500).json({ error: '提交作答失败' });
    }
  });

  router.post('/toggle', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const questionId = String(req.body?.questionId ?? '');
      const action = String(req.body?.action ?? '');
      if (!['master', 'favorite'].includes(action)) {
        res.status(400).json({ error: '不支持的操作类型' });
        return;
      }

      const { rows: qRows } = await db.query<{ bank_id: string }>(
        `SELECT q.bank_id
         FROM questions q
         JOIN question_banks b ON b.id = q.bank_id
         WHERE q.id = $1 AND (
           b.owner_id = $2
           OR b.visibility = 'public'
           OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2)
           OR $3 = 'admin'
         )`,
        [questionId, userId, req.user!.role]
      );
      if (qRows.length === 0) {
        res.status(404).json({ error: '题目不存在或无权操作' });
        return;
      }

      const { rows: prevRows } = await db.query<{ is_mastered: boolean; is_favorited: boolean }>(
        'SELECT is_mastered, is_favorited FROM user_question_records WHERE user_id = $1 AND question_id = $2',
        [userId, questionId]
      );
      const prev = prevRows[0];
      const nextMastered =
        action === 'master'
          ? isPresent(req.body?.value)
            ? Boolean(req.body.value)
            : !Boolean(prev?.is_mastered)
          : Boolean(prev?.is_mastered);
      const nextFavorited =
        action === 'favorite'
          ? isPresent(req.body?.value)
            ? Boolean(req.body.value)
            : !Boolean(prev?.is_favorited)
          : Boolean(prev?.is_favorited);

      await db.query(
        `INSERT INTO user_question_records (user_id, question_id, bank_id, is_mastered, is_favorited, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, question_id) DO UPDATE SET
           is_mastered = EXCLUDED.is_mastered,
           is_favorited = EXCLUDED.is_favorited,
           updated_at = NOW()`,
        [userId, questionId, qRows[0].bank_id, nextMastered, nextFavorited]
      );

      res.json({ isMastered: nextMastered, isFavorited: nextFavorited });
    } catch (err) {
      console.error('[toggle question state]', err);
      res.status(500).json({ error: '更新题目状态失败' });
    }
  });

  router.put('/note', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const questionId = String(req.body?.questionId ?? '');
      const note = String(req.body?.note ?? '').trim();

      const { rows: qRows } = await db.query<{ bank_id: string }>(
        `SELECT q.bank_id
         FROM questions q
         JOIN question_banks b ON b.id = q.bank_id
         WHERE q.id = $1 AND (
           b.owner_id = $2
           OR b.visibility = 'public'
           OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2)
           OR $3 = 'admin'
         )`,
        [questionId, userId, req.user!.role]
      );
      if (qRows.length === 0) {
        res.status(404).json({ error: '题目不存在或无权操作' });
        return;
      }

      await db.query(
        `INSERT INTO user_question_records (user_id, question_id, bank_id, note, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, question_id) DO UPDATE SET
           note = EXCLUDED.note,
           updated_at = NOW()`,
        [userId, questionId, qRows[0].bank_id, note]
      );

      res.json({ ok: true, note });
    } catch (err) {
      console.error('[save note]', err);
      res.status(500).json({ error: '保存个人笔记失败' });
    }
  });

  router.delete('/mistakes/:questionId', requireAuth, async (req, res) => {
    try {
      await db.query(
        `UPDATE user_question_records
         SET in_mistake_book = FALSE, updated_at = NOW()
         WHERE user_id = $1 AND question_id = $2`,
        [req.user!.userId, req.params.questionId]
      );
      res.json({ ok: true });
    } catch (err) {
      console.error('[remove mistake]', err);
      res.status(500).json({ error: '移出错题本失败' });
    }
  });

  router.get('/mistakes', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const tab = String(req.query.tab || 'mistakes');
      const bankId = String(req.query.bankId || '').trim();
      const type = String(req.query.type || '').trim();
      const keyword = String(req.query.q || '').trim();

      const params: unknown[] = [userId, req.user!.role];
      const clauses: string[] = [
        'r.user_id = $1',
        `(b.owner_id = $1 OR b.visibility = 'public' OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $1) OR $2 = 'admin')`,
      ];

      if (tab === 'favorites') {
        clauses.push('r.is_favorited = TRUE');
      } else if (tab === 'notes') {
        clauses.push(`COALESCE(r.note, '') <> ''`);
      } else {
        clauses.push('r.in_mistake_book = TRUE');
      }

      if (bankId) {
        params.push(bankId);
        clauses.push(`q.bank_id = $${params.length}`);
      }
      if (type && ['single', 'multiple', 'boolean', 'fill', 'short'].includes(type)) {
        params.push(type);
        clauses.push(`q.type = $${params.length}`);
      }
      if (keyword) {
        params.push(`%${keyword}%`);
        clauses.push(`(q.stem ILIKE $${params.length} OR q.explanation ILIKE $${params.length} OR r.note ILIKE $${params.length})`);
      }

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT
           q.*, b.title AS bank_title, c.title AS chapter_title,
           r.answered_count, r.correct_count, r.wrong_count, r.consecutive_correct,
           r.in_mistake_book, r.is_mastered, r.is_favorited, r.note, r.last_answer, r.last_is_correct
         FROM user_question_records r
         JOIN questions q ON q.id = r.question_id
         JOIN question_banks b ON b.id = q.bank_id
         LEFT JOIN chapters c ON c.id = q.chapter_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY r.wrong_count DESC, r.updated_at DESC
         LIMIT 200`,
        params
      );

      const { rows: userRows } = await db.query<{ settings: UserSettings }>(
        'SELECT settings FROM users WHERE id = $1',
        [userId]
      );
      const threshold = Number(userRows[0]?.settings?.removeAfterCorrectCount ?? 3) || 3;

      res.json({
        items: rows.map(mapQuestionRow),
        removeThreshold: threshold,
      });
    } catch (err) {
      console.error('[list mistakes]', err);
      res.status(500).json({ error: '获取错题本失败' });
    }
  });

  router.get('/search', requireAuth, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const bankId = String(req.query.bankId || '').trim();
      if (!q) {
        res.json({ items: [] });
        return;
      }

      const params: unknown[] = [req.user!.userId, req.user!.role, `%${q}%`];
      const clauses: string[] = [
        `(b.owner_id = $1 OR b.visibility = 'public' OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $1) OR $2 = 'admin')`,
        `(q.stem ILIKE $3 OR q.explanation ILIKE $3 OR q.options::text ILIKE $3 OR q.answer ILIKE $3)`,
      ];
      if (bankId) {
        params.push(bankId);
        clauses.push(`q.bank_id = $${params.length}`);
      }

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT
           q.*, b.title AS bank_title, c.title AS chapter_title,
           r.answered_count, r.correct_count, r.wrong_count, r.consecutive_correct,
           r.in_mistake_book, r.is_mastered, r.is_favorited, r.note, r.last_answer, r.last_is_correct
         FROM questions q
         JOIN question_banks b ON b.id = q.bank_id
         LEFT JOIN chapters c ON c.id = q.chapter_id
         LEFT JOIN user_question_records r ON r.question_id = q.id AND r.user_id = $1
         WHERE ${clauses.join(' AND ')}
         ORDER BY CASE WHEN q.stem ILIKE $3 THEN 0 ELSE 1 END, q.created_at DESC
         LIMIT 60`,
        params
      );

      res.json({ items: rows.map(mapQuestionRow) });
    } catch (err) {
      console.error('[search questions]', err);
      res.status(500).json({ error: '搜题失败' });
    }
  });

  return router;
}
