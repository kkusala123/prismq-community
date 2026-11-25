import { Router } from 'express';
import crypto from 'node:crypto';
import type { DbClient } from '../db/client.js';
import { createAuthMiddlewares } from '../middleware/auth.js';
import { gradeQuestionAnswer } from '../services/grader.js';
import { assembleExamQuestions, getDifficultyTier, shuffleArray } from '../services/examAssembler.js';
import type {
  ExamAssemblyMeta,
  ExamAssemblyStrategy,
  ExamQuestionSnapshot,
  ExamSubmissionItem,
  ExamSummary,
  GradingDetailItem,
  QuestionOption,
  QuestionType,
} from '../../shared/types.js';

const VALID_STRATEGIES = new Set<ExamAssemblyStrategy>([
  'balanced',
  'easy_first',
  'hard_focus',
  'high_star',
  'custom_ratio',
  'random',
]);

function normalizeStrategy(raw: unknown): ExamAssemblyStrategy {
  const s = String(raw || 'balanced').trim() as ExamAssemblyStrategy;
  return VALID_STRATEGIES.has(s) ? s : 'balanced';
}

interface PoolQuestionRow {
  id: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation: string;
  difficulty: number;
  star_rating: number;
  chapter_title: string | null;
  tags: string[];
}

async function loadAccessibleExamPool(
  db: DbClient,
  bankId: string,
  userId: string,
  role: string,
  chapterIds: string[]
): Promise<{ status: number; error?: string; pool?: PoolQuestionRow[] }> {
  const { rows: bankRows } = await db.query<{
    owner_id: string;
    visibility: string;
    is_shared: boolean;
  }>(
    `SELECT b.owner_id, b.visibility,
            EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2) AS is_shared
     FROM question_banks b
     WHERE b.id = $1`,
    [bankId, userId]
  );
  if (bankRows.length === 0) {
    return { status: 404, error: '来源题库不存在' };
  }
  const bank = bankRows[0];
  if (
    bank.visibility !== 'public' &&
    bank.owner_id !== userId &&
    !bank.is_shared &&
    role !== 'admin'
  ) {
    return { status: 403, error: '无权使用该私有题库组卷' };
  }

  const qParams: unknown[] = [bankId];
  const qClauses: string[] = ['q.bank_id = $1'];
  if (chapterIds.length > 0) {
    qParams.push(chapterIds);
    qClauses.push(`q.chapter_id = ANY($${qParams.length}::uuid[])`);
  }

  const { rows: poolRows } = await db.query<PoolQuestionRow>(
    `SELECT q.id, q.type, q.stem, q.options, q.answer, q.explanation,
            q.difficulty, q.star_rating, c.title AS chapter_title, q.tags
     FROM questions q
     LEFT JOIN chapters c ON c.id = q.chapter_id
     WHERE ${qClauses.join(' AND ')}
     ORDER BY q.sort_order ASC, q.created_at ASC`,
    qParams
  );

  if (poolRows.length === 0) {
    return { status: 400, error: '所选范围下没有任何题目，请先导题或更换章节' };
  }
  return { status: 200, pool: poolRows };
}

function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function parseAssemblyMeta(raw: unknown): ExamAssemblyMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.strategy !== 'string') return undefined;
  return obj as unknown as ExamAssemblyMeta;
}

export function createExamsRouter(db: DbClient): Router {
  const router = Router();
  const { requireAuth, optionalAuth } = createAuthMiddlewares(db);

  router.get('/', requireAuth, async (req, res) => {
    try {
      const userId = req.user!.userId;
      const { rows: examRows } = await db.query<Record<string, unknown>>(
        `SELECT
           e.*, b.title AS bank_title, u.nickname AS creator_name,
           (SELECT COUNT(*) FROM exam_submissions s WHERE s.exam_id = e.id) AS submission_count,
           (SELECT ROUND(AVG(s.score)::numeric, 1) FROM exam_submissions s WHERE s.exam_id = e.id) AS avg_score,
           (SELECT ROUND(AVG(CASE WHEN s.is_passed THEN 100.0 ELSE 0.0 END)::numeric, 1) FROM exam_submissions s WHERE s.exam_id = e.id) AS pass_rate
         FROM exams e
         LEFT JOIN question_banks b ON b.id = e.bank_id
         JOIN users u ON u.id = e.creator_id
         WHERE e.creator_id = $1 OR (e.exam_type = 'published' AND e.status = 'active')
         ORDER BY e.created_at DESC`,
        [userId]
      );

      const exams: ExamSummary[] = examRows.map((e) => {
        const snapshot = Array.isArray(e.questions_snapshot) ? e.questions_snapshot : [];
        return {
          id: String(e.id),
          creatorId: String(e.creator_id),
          creatorName: String(e.creator_name || ''),
          bankId: e.bank_id ? String(e.bank_id) : null,
          bankTitle: e.bank_title ? String(e.bank_title) : '',
          title: String(e.title),
          description: String(e.description || ''),
          examType: e.exam_type as 'mock' | 'published',
          shareCode: String(e.share_code),
          hasPassword: Boolean(String(e.access_password || '').trim()),
          allowGuest: Boolean(e.allow_guest),
          durationMinutes: Number(e.duration_minutes ?? 60),
          totalScore: Number(e.total_score ?? 100),
          passScore: Number(e.pass_score ?? 60),
          shuffleQuestions: Boolean(e.shuffle_questions),
          shuffleOptions: Boolean(e.shuffle_options),
          maxTabSwitches: Number(e.max_tab_switches ?? 5),
          maxAttempts: Number(e.max_attempts ?? 3),
          status: e.status as 'active' | 'closed',
          questionCount: snapshot.length,
          assemblyMeta: parseAssemblyMeta(e.assembly_meta),
          submissionCount: Number(e.submission_count ?? 0),
          avgScore: e.avg_score !== null && e.avg_score !== undefined ? Number(e.avg_score) : undefined,
          passRate: e.pass_rate !== null && e.pass_rate !== undefined ? Number(e.pass_rate) : undefined,
          createdAt: new Date(String(e.created_at)).toISOString(),
        };
      });

      const { rows: mySubs } = await db.query<Record<string, unknown>>(
        `SELECT s.*, e.title AS exam_title, e.share_code, e.total_score, e.pass_score
         FROM exam_submissions s
         JOIN exams e ON e.id = s.exam_id
         WHERE s.user_id = $1
         ORDER BY s.submitted_at DESC
         LIMIT 50`,
        [userId]
      );

      const submissions: ExamSubmissionItem[] = mySubs.map((s) => ({
        id: String(s.id),
        examId: String(s.exam_id),
        examTitle: String(s.exam_title || ''),
        shareCode: String(s.share_code || ''),
        userId: s.user_id ? String(s.user_id) : null,
        participantName: String(s.participant_name),
        participantIdentifier: String(s.participant_identifier || ''),
        answers: (s.answers as Record<string, string>) || {},
        gradingDetail: (s.grading_detail as Record<string, GradingDetailItem>) || {},
        score: Number(s.score ?? 0),
        totalScore: Number(s.total_score ?? 100),
        passScore: Number(s.pass_score ?? 60),
        isPassed: Boolean(s.is_passed),
        correctCount: Number(s.correct_count ?? 0),
        totalQuestions: Number(s.total_questions ?? 0),
        durationSeconds: Number(s.duration_seconds ?? 0),
        tabSwitchCount: Number(s.tab_switch_count ?? 0),
        startedAt: new Date(String(s.started_at)).toISOString(),
        submittedAt: new Date(String(s.submitted_at)).toISOString(),
      }));

      res.json({ exams, submissions });
    } catch (err) {
      console.error('[list exams]', err);
      res.status(500).json({ error: '获取考试列表失败' });
    }
  });

  // 无副作用动态组卷预演（返回题池统计与预计难度分布）
  router.post('/preview-assembly', requireAuth, async (req, res) => {
    try {
      const bankId = String(req.body?.bankId ?? '').trim();
      const chapterIds = Array.isArray(req.body?.chapterIds) ? req.body.chapterIds.map(String) : [];
      if (!bankId) {
        res.status(400).json({ error: '请先选择来源题库' });
        return;
      }

      const poolRes = await loadAccessibleExamPool(
        db,
        bankId,
        req.user!.userId,
        req.user!.role,
        chapterIds
      );
      if (!poolRes.pool) {
        res.status(poolRes.status).json({ error: poolRes.error || '加载题库失败' });
        return;
      }

      const pool = poolRes.pool;
      const typeCounts: Record<QuestionType, number> = {
        single: 0,
        multiple: 0,
        boolean: 0,
        fill: 0,
        short: 0,
      };
      const difficultyCounts = { easy: 0, medium: 0, hard: 0 };
      let ratedCount = 0;

      for (const q of pool) {
        typeCounts[q.type] = (typeCounts[q.type] || 0) + 1;
        difficultyCounts[getDifficultyTier(Number(q.difficulty ?? 2))] += 1;
        if (Number(q.star_rating ?? 0) > 0) ratedCount += 1;
      }

      const strategy = normalizeStrategy(req.body?.strategy);
      const minStarRating = Math.min(5, Math.max(0, Number(req.body?.minStarRating ?? 0) || 0));
      const difficultyRatio = req.body?.difficultyRatio as
        | { easy?: number; medium?: number; hard?: number }
        | undefined;
      const counts = req.body?.counts as Partial<Record<QuestionType, number>> | undefined;
      const totalQuestions = Number(req.body?.totalQuestions ?? 20) || 20;

      const { picked, meta, warnings } = assembleExamQuestions(pool, {
        strategy,
        difficultyRatio,
        minStarRating,
        counts,
        totalQuestions,
      });

      const typeBreakdown: Record<QuestionType, number> = {
        single: 0,
        multiple: 0,
        boolean: 0,
        fill: 0,
        short: 0,
      };
      for (const q of picked) {
        typeBreakdown[q.type] = (typeBreakdown[q.type] || 0) + 1;
      }

      res.json({
        poolStats: {
          total: pool.length,
          typeCounts,
          difficultyCounts,
          ratedCount,
        },
        projected: {
          totalPicked: picked.length,
          typeBreakdown,
          meta,
        },
        warnings,
      });
    } catch (err) {
      console.error('[preview exam assembly]', err);
      res.status(500).json({ error: '预演动态组卷失败' });
    }
  });

  router.post('/', requireAuth, async (req, res) => {
    try {
      const bankId = String(req.body?.bankId ?? '').trim();
      const title = String(req.body?.title ?? '').trim();
      const description = String(req.body?.description ?? '').trim();
      const examType = req.body?.examType === 'published' ? 'published' : 'mock';
      const durationMinutes = Math.min(300, Math.max(5, Number(req.body?.durationMinutes ?? 60) || 60));
      const passPercent = Math.min(100, Math.max(1, Number(req.body?.passScorePercent ?? 60) || 60));
      const shuffleQuestions = Boolean(req.body?.shuffleQuestions);
      const shuffleOptions = Boolean(req.body?.shuffleOptions);
      const maxTabSwitches = Math.max(0, Number(req.body?.maxTabSwitches ?? 5) || 0);
      const maxAttempts = Math.max(1, Number(req.body?.maxAttempts ?? 3) || 3);
      const accessPassword = String(req.body?.accessPassword ?? '').trim();
      const allowGuest = req.body?.allowGuest !== false;
      const chapterIds = Array.isArray(req.body?.chapterIds) ? req.body.chapterIds.map(String) : [];

      if (!bankId || !title) {
        res.status(400).json({ error: '请选择来源题库并填写考试标题' });
        return;
      }

      const poolRes = await loadAccessibleExamPool(
        db,
        bankId,
        req.user!.userId,
        req.user!.role,
        chapterIds
      );
      if (!poolRes.pool) {
        res.status(poolRes.status).json({ error: poolRes.error || '加载来源题库失败' });
        return;
      }

      const counts = req.body?.counts as Partial<Record<QuestionType, number>> | undefined;
      const strategy = normalizeStrategy(req.body?.strategy);
      const minStarRating = Math.min(5, Math.max(0, Number(req.body?.minStarRating ?? 0) || 0));
      const difficultyRatio = req.body?.difficultyRatio as
        | { easy?: number; medium?: number; hard?: number }
        | undefined;
      const totalQuestions = Number(req.body?.totalQuestions ?? 20) || 20;

      const { picked, meta, warnings } = assembleExamQuestions(poolRes.pool, {
        strategy,
        difficultyRatio,
        minStarRating,
        counts,
        totalQuestions,
      });

      if (picked.length === 0) {
        res.status(400).json({
          error: warnings[0] || '按当前题型配比或星级门槛未能抽取到题目，请调整条件后重试',
        });
        return;
      }

      const targetTotal = Math.max(10, Number(req.body?.totalScore ?? 100) || 100);
      const basePerQ = Math.floor((targetTotal / picked.length) * 10) / 10;
      const remainder = Number((targetTotal - basePerQ * picked.length).toFixed(1));

      const snapshot: ExamQuestionSnapshot[] = picked.map((q, idx) => {
        const bonus = idx === picked.length - 1 ? remainder : 0;
        const score = Number((basePerQ + bonus).toFixed(1));
        return {
          questionId: q.id,
          type: q.type,
          stem: q.stem,
          options: q.options || [],
          answer: q.answer,
          explanation: q.explanation || '',
          difficulty: Number(q.difficulty ?? 2),
          starRating: Number(q.star_rating ?? 0),
          score,
          chapterTitle: q.chapter_title || '',
          tags: Array.isArray(q.tags) ? q.tags : [],
        };
      });

      const actualTotal = Number(snapshot.reduce((acc, q) => acc + q.score, 0).toFixed(1));
      const passScore = Number(((actualTotal * passPercent) / 100).toFixed(1));

      let shareCode = generateShareCode();
      for (let tries = 0; tries < 5; tries += 1) {
        const { rows: dup } = await db.query('SELECT id FROM exams WHERE share_code = $1', [shareCode]);
        if (dup.length === 0) break;
        shareCode = generateShareCode();
      }

      const { rows: inserted } = await db.query<{ id: string }>(
        `INSERT INTO exams (
           creator_id, bank_id, title, description, exam_type, share_code, access_password,
           allow_guest, duration_minutes, total_score, pass_score, shuffle_questions,
           shuffle_options, max_tab_switches, max_attempts, status, questions_snapshot, assembly_meta
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'active', $16::jsonb, $17::jsonb)
         RETURNING id`,
        [
          req.user!.userId,
          bankId,
          title,
          description,
          examType,
          shareCode,
          accessPassword,
          allowGuest,
          durationMinutes,
          actualTotal,
          passScore,
          shuffleQuestions,
          shuffleOptions,
          maxTabSwitches,
          maxAttempts,
          JSON.stringify(snapshot),
          JSON.stringify(meta),
        ]
      );

      res.status(201).json({
        id: inserted[0].id,
        shareCode,
        totalScore: actualTotal,
        passScore,
        questionCount: snapshot.length,
        assemblyMeta: meta,
        warnings,
      });
    } catch (err) {
      console.error('[create exam]', err);
      res.status(500).json({ error: '创建考试失败' });
    }
  });

  router.put('/:id/status', requireAuth, async (req, res) => {
    try {
      const status = req.body?.status === 'closed' ? 'closed' : 'active';
      const { rows } = await db.query<{ creator_id: string }>('SELECT creator_id FROM exams WHERE id = $1', [
        req.params.id,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      if (rows[0].creator_id !== req.user!.userId && req.user!.role !== 'admin') {
        res.status(403).json({ error: '无权修改该考试状态' });
        return;
      }
      await db.query('UPDATE exams SET status = $1 WHERE id = $2', [status, req.params.id]);
      res.json({ ok: true, status });
    } catch (err) {
      console.error('[update exam status]', err);
      res.status(500).json({ error: '更新考试状态失败' });
    }
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query<{ creator_id: string }>('SELECT creator_id FROM exams WHERE id = $1', [
        req.params.id,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      if (rows[0].creator_id !== req.user!.userId && req.user!.role !== 'admin') {
        res.status(403).json({ error: '无权删除该考试' });
        return;
      }
      await db.query('DELETE FROM exams WHERE id = $1', [req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      console.error('[delete exam]', err);
      res.status(500).json({ error: '删除考试失败' });
    }
  });

  // 考生端拉取脱敏试卷（严禁返回 answer 与 explanation）
  router.get('/join/:shareCode', optionalAuth, async (req, res) => {
    try {
      const shareCode = String(req.params.shareCode || '').trim().toUpperCase();
      const providedPwd = String(req.query.password || '').trim();

      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT e.*, u.nickname AS creator_name
         FROM exams e
         JOIN users u ON u.id = e.creator_id
         WHERE e.share_code = $1`,
        [shareCode]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: '未找到该分享码对应的考试' });
        return;
      }
      const exam = rows[0];
      const hasPassword = Boolean(String(exam.access_password || '').trim());
      const passwordMatched = !hasPassword || providedPwd === String(exam.access_password || '').trim();
      const snapshot = (Array.isArray(exam.questions_snapshot) ? exam.questions_snapshot : []) as ExamQuestionSnapshot[];

      const meta = {
        id: String(exam.id),
        title: String(exam.title),
        description: String(exam.description || ''),
        creatorName: String(exam.creator_name || ''),
        examType: String(exam.exam_type),
        shareCode: String(exam.share_code),
        hasPassword,
        allowGuest: Boolean(exam.allow_guest),
        durationMinutes: Number(exam.duration_minutes ?? 60),
        totalScore: Number(exam.total_score ?? 100),
        passScore: Number(exam.pass_score ?? 60),
        maxTabSwitches: Number(exam.max_tab_switches ?? 5),
        maxAttempts: Number(exam.max_attempts ?? 3),
        status: String(exam.status),
        questionCount: snapshot.length,
      };

      if (!passwordMatched) {
        res.json({
          requiresPassword: true,
          exam: meta,
          questions: [],
        });
        return;
      }

      if (!exam.allow_guest && !req.user) {
        res.json({
          requiresLogin: true,
          requiresPassword: false,
          exam: meta,
          questions: [],
        });
        return;
      }

      let prepared = snapshot.map((q) => ({
        questionId: q.questionId,
        type: q.type,
        stem: q.stem,
        options:
          exam.shuffle_options && q.type !== 'boolean' && Array.isArray(q.options)
            ? shuffleArray(q.options)
            : q.options || [],
        score: q.score,
        chapterTitle: q.chapterTitle || '',
        tags: q.tags || [],
      }));

      if (exam.shuffle_questions) {
        prepared = shuffleArray(prepared);
      }

      res.json({
        requiresPassword: false,
        requiresLogin: false,
        exam: meta,
        questions: prepared,
      });
    } catch (err) {
      console.error('[join exam]', err);
      res.status(500).json({ error: '加载试卷失败' });
    }
  });

  router.post('/join/:shareCode/submit', optionalAuth, async (req, res) => {
    try {
      const shareCode = String(req.params.shareCode || '').trim().toUpperCase();
      const { rows } = await db.query<Record<string, unknown>>(
        'SELECT * FROM exams WHERE share_code = $1',
        [shareCode]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const exam = rows[0];
      if (exam.status !== 'active') {
        res.status(400).json({ error: '该场考试已被组织者关闭，无法提交' });
        return;
      }

      const expectedPwd = String(exam.access_password || '').trim();
      const providedPwd = String(req.body?.accessPassword ?? '').trim();
      if (expectedPwd && providedPwd !== expectedPwd) {
        res.status(403).json({ error: '考试口令错误，无法交卷' });
        return;
      }

      if (!exam.allow_guest && !req.user) {
        res.status(401).json({ error: '本场考试要求登录账号后才可参试' });
        return;
      }

      let participantName = String(req.body?.participantName ?? '').trim();
      const participantIdentifier = String(req.body?.participantIdentifier ?? '').trim();
      if (req.user && !participantName) {
        const { rows: uRows } = await db.query<{ nickname: string; username: string }>(
          'SELECT nickname, username FROM users WHERE id = $1',
          [req.user.userId]
        );
        participantName = uRows[0]?.nickname || uRows[0]?.username || '学员';
      }
      if (!participantName) {
        res.status(400).json({ error: '请填写考生姓名后再提交试卷' });
        return;
      }

      const maxAttempts = Number(exam.max_attempts ?? 3);
      if (maxAttempts > 0) {
        const countRes = req.user
          ? await db.query<{ cnt: string | number }>(
              'SELECT COUNT(*) AS cnt FROM exam_submissions WHERE exam_id = $1 AND user_id = $2',
              [exam.id, req.user.userId]
            )
          : await db.query<{ cnt: string | number }>(
              'SELECT COUNT(*) AS cnt FROM exam_submissions WHERE exam_id = $1 AND participant_name = $2 AND participant_identifier = $3',
              [exam.id, participantName, participantIdentifier]
            );
        if (Number(countRes.rows[0]?.cnt ?? 0) >= maxAttempts) {
          res.status(400).json({ error: `已达到本场考试最大作答次数限制（${maxAttempts} 次）` });
          return;
        }
      }

      const snapshot = (Array.isArray(exam.questions_snapshot) ? exam.questions_snapshot : []) as ExamQuestionSnapshot[];
      const answers = (req.body?.answers && typeof req.body.answers === 'object'
        ? req.body.answers
        : {}) as Record<string, string>;
      const durationSeconds = Math.max(0, Number(req.body?.durationSeconds ?? 0) || 0);
      const tabSwitchCount = Math.max(0, Number(req.body?.tabSwitchCount ?? 0) || 0);
      const startedAt = req.body?.startedAt ? new Date(String(req.body.startedAt)) : new Date();

      const gradingDetail: Record<string, GradingDetailItem> = {};
      let totalEarned = 0;
      let correctCount = 0;
      const wrongQuestionIds: string[] = [];

      for (const q of snapshot) {
        const userAns = String(answers[q.questionId] ?? '');
        const graded = gradeQuestionAnswer(q.type, q.answer || '', userAns);
        const earned = graded.isCorrect ? q.score : 0;
        totalEarned += earned;
        if (graded.isCorrect) {
          correctCount += 1;
        } else {
          wrongQuestionIds.push(q.questionId);
        }
        gradingDetail[q.questionId] = {
          isCorrect: graded.isCorrect,
          earnedScore: earned,
          maxScore: q.score,
          userAnswer: userAns,
          correctAnswer: q.answer || '',
          explanation: q.explanation || '',
        };
      }

      totalEarned = Number(totalEarned.toFixed(1));
      const isPassed = totalEarned >= Number(exam.pass_score ?? 60);

      const submissionId = await db.withTransaction(async (tx) => {
        const { rows: subRows } = await tx.query<{ id: string }>(
          `INSERT INTO exam_submissions (
             exam_id, user_id, participant_name, participant_identifier,
             answers, grading_detail, score, is_passed, correct_count,
             total_questions, duration_seconds, tab_switch_count, started_at, submitted_at
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, NOW())
           RETURNING id`,
          [
            exam.id,
            req.user?.userId ?? null,
            participantName,
            participantIdentifier,
            JSON.stringify(answers),
            JSON.stringify(gradingDetail),
            totalEarned,
            isPassed,
            correctCount,
            snapshot.length,
            durationSeconds,
            tabSwitchCount,
            startedAt.toISOString(),
          ]
        );

        // 登录用户的错题自动同步写入个人错题本
        if (req.user && exam.bank_id && wrongQuestionIds.length > 0) {
          const { rows: validQs } = await tx.query<{ id: string; bank_id: string }>(
            'SELECT id, bank_id FROM questions WHERE id = ANY($1::uuid[])',
            [wrongQuestionIds]
          );
          for (const vq of validQs) {
            await tx.query(
              `INSERT INTO user_question_records (
                 user_id, question_id, bank_id, answered_count, wrong_count,
                 consecutive_correct, in_mistake_book, last_answer, last_is_correct, updated_at
               ) VALUES ($1, $2, $3, 1, 1, 0, TRUE, $4, FALSE, NOW())
               ON CONFLICT (user_id, question_id) DO UPDATE SET
                 answered_count = user_question_records.answered_count + 1,
                 wrong_count = user_question_records.wrong_count + 1,
                 consecutive_correct = 0,
                 in_mistake_book = TRUE,
                 last_answer = EXCLUDED.last_answer,
                 last_is_correct = FALSE,
                 updated_at = NOW()`,
              [req.user.userId, vq.id, vq.bank_id, String(answers[vq.id] ?? '')]
            );
          }
        }

        return subRows[0].id;
      });

      res.status(201).json({
        submission: {
          id: submissionId,
          examId: String(exam.id),
          examTitle: String(exam.title),
          shareCode: String(exam.share_code),
          userId: req.user?.userId ?? null,
          participantName,
          participantIdentifier,
          answers,
          gradingDetail,
          score: totalEarned,
          totalScore: Number(exam.total_score),
          passScore: Number(exam.pass_score),
          isPassed,
          correctCount,
          totalQuestions: snapshot.length,
          durationSeconds,
          tabSwitchCount,
          submittedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      console.error('[submit exam]', err);
      res.status(500).json({ error: '交卷评分失败，请稍后重试' });
    }
  });

  router.get('/submissions/:submissionId', optionalAuth, async (req, res) => {
    try {
      const { rows } = await db.query<Record<string, unknown>>(
        `SELECT s.*, e.title AS exam_title, e.share_code, e.total_score, e.pass_score, e.creator_id, e.questions_snapshot
         FROM exam_submissions s
         JOIN exams e ON e.id = s.exam_id
         WHERE s.id = $1`,
        [req.params.submissionId]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: '未找到成绩单记录' });
        return;
      }
      const s = rows[0];
      const snapshot = (Array.isArray(s.questions_snapshot) ? s.questions_snapshot : []) as ExamQuestionSnapshot[];

      res.json({
        submission: {
          id: String(s.id),
          examId: String(s.exam_id),
          examTitle: String(s.exam_title),
          shareCode: String(s.share_code),
          creatorId: String(s.creator_id),
          userId: s.user_id ? String(s.user_id) : null,
          participantName: String(s.participant_name),
          participantIdentifier: String(s.participant_identifier || ''),
          answers: (s.answers as Record<string, string>) || {},
          gradingDetail: (s.grading_detail as Record<string, GradingDetailItem>) || {},
          score: Number(s.score ?? 0),
          totalScore: Number(s.total_score ?? 100),
          passScore: Number(s.pass_score ?? 60),
          isPassed: Boolean(s.is_passed),
          correctCount: Number(s.correct_count ?? 0),
          totalQuestions: Number(s.total_questions ?? 0),
          durationSeconds: Number(s.duration_seconds ?? 0),
          tabSwitchCount: Number(s.tab_switch_count ?? 0),
          startedAt: new Date(String(s.started_at)).toISOString(),
          submittedAt: new Date(String(s.submitted_at)).toISOString(),
        },
        questions: snapshot,
      });
    } catch (err) {
      console.error('[get submission]', err);
      res.status(500).json({ error: '获取成绩报告失败' });
    }
  });

  router.get('/:id/analytics', requireAuth, async (req, res) => {
    try {
      const { rows: examRows } = await db.query<Record<string, unknown>>('SELECT * FROM exams WHERE id = $1', [
        req.params.id,
      ]);
      if (examRows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const exam = examRows[0];
      if (exam.creator_id !== req.user!.userId && req.user!.role !== 'admin') {
        res.status(403).json({ error: '仅考试创建者或管理员可查看考情统计看板' });
        return;
      }

      const { rows: subs } = await db.query<Record<string, unknown>>(
        `SELECT * FROM exam_submissions
         WHERE exam_id = $1
         ORDER BY score DESC, duration_seconds ASC, submitted_at ASC`,
        [exam.id]
      );

      const snapshot = (Array.isArray(exam.questions_snapshot) ? exam.questions_snapshot : []) as ExamQuestionSnapshot[];

      const submissions: ExamSubmissionItem[] = subs.map((s) => ({
        id: String(s.id),
        examId: String(s.exam_id),
        userId: s.user_id ? String(s.user_id) : null,
        participantName: String(s.participant_name),
        participantIdentifier: String(s.participant_identifier || ''),
        answers: (s.answers as Record<string, string>) || {},
        gradingDetail: (s.grading_detail as Record<string, GradingDetailItem>) || {},
        score: Number(s.score ?? 0),
        totalScore: Number(exam.total_score),
        passScore: Number(exam.pass_score),
        isPassed: Boolean(s.is_passed),
        correctCount: Number(s.correct_count ?? 0),
        totalQuestions: Number(s.total_questions ?? 0),
        durationSeconds: Number(s.duration_seconds ?? 0),
        tabSwitchCount: Number(s.tab_switch_count ?? 0),
        startedAt: new Date(String(s.started_at)).toISOString(),
        submittedAt: new Date(String(s.submitted_at)).toISOString(),
      }));

      const totalSubs = submissions.length;
      const avgScore =
        totalSubs > 0
          ? Number((submissions.reduce((sum, s) => sum + s.score, 0) / totalSubs).toFixed(1))
          : 0;
      const maxScore = totalSubs > 0 ? Math.max(...submissions.map((s) => s.score)) : 0;
      const passCount = submissions.filter((s) => s.isPassed).length;
      const passRate = totalSubs > 0 ? Math.round((passCount / totalSubs) * 100) : 0;

      // 单题正确率与错误率统计
      const questionStats = snapshot.map((q, idx) => {
        let correctTimes = 0;
        for (const s of submissions) {
          if (s.gradingDetail[q.questionId]?.isCorrect) {
            correctTimes += 1;
          }
        }
        const wrongTimes = totalSubs - correctTimes;
        return {
          index: idx + 1,
          questionId: q.questionId,
          type: q.type,
          stem: q.stem,
          chapterTitle: q.chapterTitle || '未分类',
          score: q.score,
          correctTimes,
          wrongTimes,
          errorRate: totalSubs > 0 ? Math.round((wrongTimes / totalSubs) * 100) : 0,
        };
      });

      // 按章节聚合知识点掌握度
      const chapterMap = new Map<string, { totalChecks: number; correctChecks: number }>();
      for (const qs of questionStats) {
        const key = qs.chapterTitle || '未分类';
        const prev = chapterMap.get(key) || { totalChecks: 0, correctChecks: 0 };
        prev.totalChecks += totalSubs;
        prev.correctChecks += qs.correctTimes;
        chapterMap.set(key, prev);
      }
      const chapterMastery = Array.from(chapterMap.entries()).map(([chapter, val]) => ({
        chapter,
        masteryRate: val.totalChecks > 0 ? Math.round((val.correctChecks / val.totalChecks) * 100) : 0,
      }));

      res.json({
        exam: {
          id: String(exam.id),
          title: String(exam.title),
          shareCode: String(exam.share_code),
          totalScore: Number(exam.total_score),
          passScore: Number(exam.pass_score),
          durationMinutes: Number(exam.duration_minutes),
          status: String(exam.status),
        },
        summary: {
          submissionCount: totalSubs,
          avgScore,
          maxScore,
          passCount,
          passRate,
        },
        submissions,
        questionStats: [...questionStats].sort((a, b) => b.errorRate - a.errorRate),
        chapterMastery,
      });
    } catch (err) {
      console.error('[exam analytics]', err);
      res.status(500).json({ error: '获取考试统计看板失败' });
    }
  });

  // 组织者人工复核改分（如简答题调分）
  router.put('/:id/submissions/:submissionId/grade', requireAuth, async (req, res) => {
    try {
      const { rows: examRows } = await db.query<{ creator_id: string; pass_score: number }>(
        'SELECT creator_id, pass_score FROM exams WHERE id = $1',
        [req.params.id]
      );
      if (examRows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      if (examRows[0].creator_id !== req.user!.userId && req.user!.role !== 'admin') {
        res.status(403).json({ error: '无权调分' });
        return;
      }

      const { rows: subRows } = await db.query<{
        grading_detail: Record<string, GradingDetailItem>;
      }>('SELECT grading_detail FROM exam_submissions WHERE id = $1 AND exam_id = $2', [
        req.params.submissionId,
        req.params.id,
      ]);
      if (subRows.length === 0) {
        res.status(404).json({ error: '交卷记录不存在' });
        return;
      }

      const questionId = String(req.body?.questionId ?? '');
      const earnedScore = Math.max(0, Number(req.body?.earnedScore ?? 0) || 0);
      const comment = req.body?.comment !== undefined ? String(req.body.comment).trim() : undefined;

      const detail = { ...(subRows[0].grading_detail || {}) };
      if (!detail[questionId]) {
        res.status(400).json({ error: '未找到对应题目的评分记录' });
        return;
      }
      const maxScore = Number(detail[questionId].maxScore ?? 0);
      const clampedScore = Math.min(maxScore, Number(earnedScore.toFixed(1)));
      detail[questionId] = {
        ...detail[questionId],
        earnedScore: clampedScore,
        isCorrect: clampedScore >= maxScore * 0.6,
        ...(comment !== undefined ? { comment } : {}),
      };

      const values = Object.values(detail);
      const newTotalScore = Number(values.reduce((acc, v) => acc + Number(v.earnedScore ?? 0), 0).toFixed(1));
      const newCorrectCount = values.filter((v) => v.isCorrect).length;
      const newIsPassed = newTotalScore >= Number(examRows[0].pass_score ?? 60);

      await db.query(
        `UPDATE exam_submissions
         SET grading_detail = $1::jsonb, score = $2, correct_count = $3, is_passed = $4
         WHERE id = $5`,
        [JSON.stringify(detail), newTotalScore, newCorrectCount, newIsPassed, req.params.submissionId]
      );

      res.json({
        ok: true,
        score: newTotalScore,
        correctCount: newCorrectCount,
        isPassed: newIsPassed,
        gradingDetail: detail,
      });
    } catch (err) {
      console.error('[manual grade]', err);
      res.status(500).json({ error: '调分失败' });
    }
  });

  return router;
}
