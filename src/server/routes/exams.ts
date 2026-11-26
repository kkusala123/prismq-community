import { Router } from 'express';
import crypto from 'node:crypto';
import { getAppConfig } from '../config.js';
import type { DbClient, DbExecutor } from '../db/client.js';
import { createAuthMiddlewares } from '../middleware/auth.js';
import { gradeQuestionAnswer } from '../services/grader.js';
import { assembleExamQuestions, getDifficultyTier, shuffleArray } from '../services/examAssembler.js';
import {
  generateQrDataUrl,
  generateQrPngBuffer,
  generateQrSvg,
  resolveShareOrigin,
} from '../services/qrcode.js';
import type {
  ActiveExamSessionItem,
  CheatEventItem,
  ExamAssemblyMeta,
  ExamAssemblyStrategy,
  ExamDeviceInfo,
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

function parseIsoOrNull(raw: unknown): Date | null {
  if (raw === undefined || raw === null) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const dt = new Date(str);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function toIsoOrNull(raw: unknown): string | null {
  if (!raw) return null;
  const dt = new Date(String(raw));
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function sanitizeAnswersMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k && v !== undefined && v !== null) {
      out[String(k)] = String(v);
    }
  }
  return out;
}

function sanitizeDeviceInfo(raw: unknown): ExamDeviceInfo {
  if (!raw || typeof raw !== 'object') return {};
  const obj = raw as Record<string, unknown>;
  return {
    platform: obj.platform ? String(obj.platform).slice(0, 40) : undefined,
    deviceLabel: obj.deviceLabel ? String(obj.deviceLabel).slice(0, 120) : undefined,
    isEmulator: Boolean(obj.isEmulator),
    isDebugged: Boolean(obj.isDebugged),
    isVirtualSpace: Boolean(obj.isVirtualSpace),
    isMultiWindow: Boolean(obj.isMultiWindow),
    reasons: Array.isArray(obj.reasons)
      ? obj.reasons.slice(0, 20).map((r) => String(r).slice(0, 80))
      : undefined,
  };
}

function sanitizeCheatEvents(raw: unknown): CheatEventItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 200)
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const obj = item as Record<string, unknown>;
      return {
        type: String(obj.type || 'unknown').slice(0, 40),
        detail: String(obj.detail || '').slice(0, 200),
        timestamp: toIsoOrNull(obj.timestamp) || new Date().toISOString(),
      };
    })
    .filter((x): x is CheatEventItem => Boolean(x));
}

function deriveRiskFlags(
  deviceInfo: ExamDeviceInfo,
  cheatEvents: CheatEventItem[],
  tabSwitchCount: number,
  extraFlags?: unknown
): string[] {
  const flags = new Set<string>();
  if (Array.isArray(extraFlags)) {
    for (const f of extraFlags) {
      const s = String(f || '').trim();
      if (s) flags.add(s.slice(0, 40));
    }
  }
  if (deviceInfo.isEmulator) flags.add('emulator');
  if (deviceInfo.isDebugged) flags.add('debugger');
  if (deviceInfo.isVirtualSpace) flags.add('virtual_space');
  if (deviceInfo.isMultiWindow) flags.add('multi_window');
  if (tabSwitchCount > 0) flags.add('tab_switch');

  for (const ev of cheatEvents) {
    if (
      ev.type === 'small_window' ||
      ev.type === 'multi_window' ||
      ev.type === 'floating_window'
    ) {
      flags.add('small_window');
    } else if (ev.type === 'window_blur' || ev.type === 'focus_lost') {
      flags.add('focus_lost');
    } else if (ev.type === 'tab_switch') {
      flags.add('tab_switch');
    } else if (ev.type === 'devtools') {
      flags.add('devtools');
    } else if (ev.type === 'emulator') {
      flags.add('emulator');
    } else if (ev.type === 'screenshot') {
      flags.add('screenshot');
    }
  }

  return Array.from(flags);
}

function mapSubmissionRow(
  s: Record<string, unknown>,
  fallbackTotal?: number,
  fallbackPass?: number
): ExamSubmissionItem {
  const totalQuestions = Number(s.total_questions ?? 0);
  const correctCount = Number(s.correct_count ?? 0);
  const storedAccuracy =
    s.accuracy !== undefined && s.accuracy !== null ? Number(s.accuracy) : null;
  const accuracy =
    storedAccuracy !== null && storedAccuracy > 0
      ? storedAccuracy
      : totalQuestions > 0
        ? Number(((correctCount / totalQuestions) * 100).toFixed(1))
        : 0;

  return {
    id: String(s.id),
    examId: String(s.exam_id),
    examTitle: s.exam_title ? String(s.exam_title) : undefined,
    shareCode: s.share_code ? String(s.share_code) : undefined,
    userId: s.user_id ? String(s.user_id) : null,
    participantName: String(s.participant_name),
    participantIdentifier: String(s.participant_identifier || ''),
    answers: (s.answers as Record<string, string>) || {},
    gradingDetail: (s.grading_detail as Record<string, GradingDetailItem>) || {},
    score: Number(s.score ?? 0),
    totalScore:
      s.total_score !== undefined && s.total_score !== null
        ? Number(s.total_score)
        : fallbackTotal,
    passScore:
      s.pass_score !== undefined && s.pass_score !== null
        ? Number(s.pass_score)
        : fallbackPass,
    isPassed: Boolean(s.is_passed),
    correctCount,
    totalQuestions,
    accuracy,
    durationSeconds: Number(s.duration_seconds ?? 0),
    tabSwitchCount: Number(s.tab_switch_count ?? 0),
    cheatEvents: Array.isArray(s.cheat_events) ? (s.cheat_events as CheatEventItem[]) : [],
    deviceInfo:
      s.device_info && typeof s.device_info === 'object'
        ? (s.device_info as ExamDeviceInfo)
        : {},
    riskFlags: Array.isArray(s.risk_flags) ? (s.risk_flags as string[]) : [],
    terminatedByCreator: Boolean(s.terminated_by_creator),
    startedAt: new Date(String(s.started_at)).toISOString(),
    submittedAt: new Date(String(s.submitted_at)).toISOString(),
  };
}

async function gradeAndInsertSubmission(
  tx: DbExecutor,
  exam: Record<string, unknown>,
  opts: {
    userId: string | null;
    participantName: string;
    participantIdentifier: string;
    answers: Record<string, string>;
    durationSeconds: number;
    tabSwitchCount: number;
    cheatEvents: CheatEventItem[];
    deviceInfo: ExamDeviceInfo;
    riskFlags: string[];
    startedAt: Date;
    terminatedByCreator: boolean;
    sessionId?: string | null;
  }
): Promise<ExamSubmissionItem> {
  const snapshot = (
    Array.isArray(exam.questions_snapshot) ? exam.questions_snapshot : []
  ) as ExamQuestionSnapshot[];

  const gradingDetail: Record<string, GradingDetailItem> = {};
  let totalEarned = 0;
  let correctCount = 0;
  const wrongQuestionIds: string[] = [];

  for (const q of snapshot) {
    const userAns = String(opts.answers[q.questionId] ?? '');
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
  const accuracy =
    snapshot.length > 0 ? Number(((correctCount / snapshot.length) * 100).toFixed(1)) : 0;

  const { rows: subRows } = await tx.query<{ id: string; submitted_at: string }>(
    `INSERT INTO exam_submissions (
       exam_id, user_id, participant_name, participant_identifier,
       answers, grading_detail, score, is_passed, correct_count,
       total_questions, accuracy, duration_seconds, tab_switch_count,
       cheat_events, device_info, risk_flags, terminated_by_creator,
       started_at, submitted_at
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb, $17, $18, NOW())
     RETURNING id, submitted_at`,
    [
      exam.id,
      opts.userId,
      opts.participantName,
      opts.participantIdentifier,
      JSON.stringify(opts.answers),
      JSON.stringify(gradingDetail),
      totalEarned,
      isPassed,
      correctCount,
      snapshot.length,
      accuracy,
      opts.durationSeconds,
      opts.tabSwitchCount,
      JSON.stringify(opts.cheatEvents),
      JSON.stringify(opts.deviceInfo),
      JSON.stringify(opts.riskFlags),
      opts.terminatedByCreator,
      opts.startedAt.toISOString(),
    ]
  );

  const submissionId = subRows[0].id;
  const submittedAt = new Date(String(subRows[0].submitted_at)).toISOString();

  if (opts.sessionId) {
    await tx.query(
      `UPDATE exam_sessions
       SET status = $1,
           draft_answers = $2::jsonb,
           tab_switch_count = $3,
           cheat_events = $4::jsonb,
           device_info = $5::jsonb,
           risk_flags = $6::jsonb,
           submission_id = $7,
           last_heartbeat_at = NOW()
       WHERE id = $8 AND exam_id = $9`,
      [
        opts.terminatedByCreator ? 'terminated' : 'submitted',
        JSON.stringify(opts.answers),
        opts.tabSwitchCount,
        JSON.stringify(opts.cheatEvents),
        JSON.stringify(opts.deviceInfo),
        JSON.stringify(opts.riskFlags),
        submissionId,
        opts.sessionId,
        exam.id,
      ]
    );
  }

  // 登录用户的错题自动同步写入个人错题本
  if (opts.userId && exam.bank_id && wrongQuestionIds.length > 0) {
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
        [opts.userId, vq.id, vq.bank_id, String(opts.answers[vq.id] ?? '')]
      );
    }
  }

  return {
    id: submissionId,
    examId: String(exam.id),
    examTitle: String(exam.title),
    shareCode: String(exam.share_code),
    userId: opts.userId,
    participantName: opts.participantName,
    participantIdentifier: opts.participantIdentifier,
    answers: opts.answers,
    gradingDetail,
    score: totalEarned,
    totalScore: Number(exam.total_score),
    passScore: Number(exam.pass_score),
    isPassed,
    correctCount,
    totalQuestions: snapshot.length,
    accuracy,
    durationSeconds: opts.durationSeconds,
    tabSwitchCount: opts.tabSwitchCount,
    cheatEvents: opts.cheatEvents,
    deviceInfo: opts.deviceInfo,
    riskFlags: opts.riskFlags,
    terminatedByCreator: opts.terminatedByCreator,
    startedAt: opts.startedAt.toISOString(),
    submittedAt,
  };
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
           (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id AND es.status = 'in_progress') AS in_progress_count,
           (SELECT ROUND(AVG(s.score)::numeric, 1) FROM exam_submissions s WHERE s.exam_id = e.id) AS avg_score,
           (SELECT ROUND(AVG(CASE WHEN s.total_questions > 0 THEN (s.correct_count * 100.0 / s.total_questions) ELSE 0 END)::numeric, 1) FROM exam_submissions s WHERE s.exam_id = e.id) AS avg_accuracy,
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
          startsAt: toIsoOrNull(e.starts_at),
          endsAt: toIsoOrNull(e.ends_at),
          endedAt: toIsoOrNull(e.ended_at),
          totalScore: Number(e.total_score ?? 100),
          passScore: Number(e.pass_score ?? 60),
          shuffleQuestions: Boolean(e.shuffle_questions),
          shuffleOptions: Boolean(e.shuffle_options),
          maxTabSwitches: Number(e.max_tab_switches ?? 5),
          maxAttempts: Number(e.max_attempts ?? 3),
          blockEmulator: Boolean(e.block_emulator),
          strictAntiCheat: e.strict_anti_cheat === undefined ? true : Boolean(e.strict_anti_cheat),
          autoSubmitOnCheat: e.auto_submit_on_cheat === undefined ? true : Boolean(e.auto_submit_on_cheat),
          status: e.status as 'active' | 'closed',
          questionCount: snapshot.length,
          assemblyMeta: parseAssemblyMeta(e.assembly_meta),
          submissionCount: Number(e.submission_count ?? 0),
          inProgressCount: Number(e.in_progress_count ?? 0),
          avgScore: e.avg_score !== null && e.avg_score !== undefined ? Number(e.avg_score) : undefined,
          avgAccuracy:
            e.avg_accuracy !== null && e.avg_accuracy !== undefined
              ? Number(e.avg_accuracy)
              : undefined,
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

      const submissions: ExamSubmissionItem[] = mySubs.map((s) => mapSubmissionRow(s));

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
      const isMock = examType === 'mock';
      const durationMinutes = Math.min(600, Math.max(1, Number(req.body?.durationMinutes ?? 60) || 60));
      const passPercent = Math.min(100, Math.max(1, Number(req.body?.passScorePercent ?? 60) || 60));
      const shuffleQuestions = Boolean(req.body?.shuffleQuestions);
      const shuffleOptions = Boolean(req.body?.shuffleOptions);
      const maxTabSwitches =
        req.body?.maxTabSwitches !== undefined
          ? Math.max(0, Number(req.body.maxTabSwitches) || 0)
          : isMock
            ? 99
            : 5;
      const maxAttempts =
        req.body?.maxAttempts !== undefined
          ? Math.max(1, Number(req.body.maxAttempts) || 1)
          : isMock
            ? 99
            : 3;
      const accessPassword = String(req.body?.accessPassword ?? '').trim();
      const allowGuest = req.body?.allowGuest !== false;
      const blockEmulator = Boolean(req.body?.blockEmulator);
      const strictAntiCheat =
        req.body?.strictAntiCheat !== undefined ? Boolean(req.body.strictAntiCheat) : !isMock;
      const autoSubmitOnCheat =
        req.body?.autoSubmitOnCheat !== undefined ? Boolean(req.body.autoSubmitOnCheat) : !isMock;
      const startsAt = parseIsoOrNull(req.body?.startsAt);
      const endsAt = parseIsoOrNull(req.body?.endsAt);
      const chapterIds = Array.isArray(req.body?.chapterIds) ? req.body.chapterIds.map(String) : [];

      if (!bankId || !title) {
        res.status(400).json({ error: '请选择来源题库并填写考试标题' });
        return;
      }
      if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
        res.status(400).json({ error: '截止时间必须晚于开考时间' });
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

      const rawScores = req.body?.questionScores as Partial<Record<QuestionType, unknown>> | undefined;
      const customScoreMap: Partial<Record<QuestionType, number>> = {};
      if (rawScores && typeof rawScores === 'object') {
        for (const t of ['single', 'multiple', 'boolean', 'fill', 'short'] as const) {
          const val = Number(rawScores[t]);
          if (Number.isFinite(val) && val > 0) {
            customScoreMap[t] = Number(Math.min(100, val).toFixed(1));
          }
        }
      }
      const usePerTypeScores = Object.keys(customScoreMap).length > 0;

      const targetTotal = Math.max(10, Number(req.body?.totalScore ?? 100) || 100);
      const basePerQ = Math.floor((targetTotal / picked.length) * 10) / 10;
      const remainder = Number((targetTotal - basePerQ * picked.length).toFixed(1));

      const snapshot: ExamQuestionSnapshot[] = picked.map((q, idx) => {
        const bonus = idx === picked.length - 1 ? remainder : 0;
        const score = usePerTypeScores
          ? customScoreMap[q.type] ?? 1
          : Number((basePerQ + bonus).toFixed(1));
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

      const typeBreakdown: Record<QuestionType, number> = {
        single: 0,
        multiple: 0,
        boolean: 0,
        fill: 0,
        short: 0,
      };
      for (const item of snapshot) {
        typeBreakdown[item.type] = (typeBreakdown[item.type] || 0) + 1;
      }

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
           allow_guest, duration_minutes, starts_at, ends_at,
           total_score, pass_score, shuffle_questions, shuffle_options,
           max_tab_switches, max_attempts, block_emulator, strict_anti_cheat, auto_submit_on_cheat,
           status, questions_snapshot, assembly_meta
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7,
           $8, $9, $10, $11,
           $12, $13, $14, $15,
           $16, $17, $18, $19, $20,
           'active', $21::jsonb, $22::jsonb
         )
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
          startsAt ? startsAt.toISOString() : null,
          endsAt ? endsAt.toISOString() : null,
          actualTotal,
          passScore,
          shuffleQuestions,
          shuffleOptions,
          maxTabSwitches,
          maxAttempts,
          blockEmulator,
          strictAntiCheat,
          autoSubmitOnCheat,
          JSON.stringify(snapshot),
          JSON.stringify(meta),
        ]
      );

      res.status(201).json({
        id: inserted[0].id,
        examType,
        shareCode,
        totalScore: actualTotal,
        passScore,
        questionCount: snapshot.length,
        typeBreakdown,
        startsAt: startsAt ? startsAt.toISOString() : null,
        endsAt: endsAt ? endsAt.toISOString() : null,
        blockEmulator,
        strictAntiCheat,
        autoSubmitOnCheat,
        assemblyMeta: meta,
        warnings,
      });
    } catch (err) {
      console.error('[create exam]', err);
      res.status(500).json({ error: '创建考试失败' });
    }
  });

  // 发起者更新考试时间与防作弊设置
  router.put('/:id/settings', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM exams WHERE id = $1', [
        req.params.id,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const exam = rows[0];
      if (exam.creator_id !== req.user!.userId && req.user!.role !== 'admin') {
        res.status(403).json({ error: '仅考试发起者或管理员可调整考场设置' });
        return;
      }

      const durationMinutes =
        req.body?.durationMinutes !== undefined
          ? Math.min(600, Math.max(1, Number(req.body.durationMinutes) || 60))
          : Number(exam.duration_minutes ?? 60);
      const startsAt =
        req.body?.startsAt !== undefined ? parseIsoOrNull(req.body.startsAt) : toIsoOrNull(exam.starts_at) ? new Date(String(exam.starts_at)) : null;
      const endsAt =
        req.body?.endsAt !== undefined ? parseIsoOrNull(req.body.endsAt) : toIsoOrNull(exam.ends_at) ? new Date(String(exam.ends_at)) : null;

      if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
        res.status(400).json({ error: '截止时间必须晚于开考时间' });
        return;
      }

      const maxTabSwitches =
        req.body?.maxTabSwitches !== undefined
          ? Math.max(0, Number(req.body.maxTabSwitches) || 0)
          : Number(exam.max_tab_switches ?? 5);
      const blockEmulator =
        req.body?.blockEmulator !== undefined ? Boolean(req.body.blockEmulator) : Boolean(exam.block_emulator);
      const strictAntiCheat =
        req.body?.strictAntiCheat !== undefined
          ? Boolean(req.body.strictAntiCheat)
          : Boolean(exam.strict_anti_cheat);
      const autoSubmitOnCheat =
        req.body?.autoSubmitOnCheat !== undefined
          ? Boolean(req.body.autoSubmitOnCheat)
          : Boolean(exam.auto_submit_on_cheat);
      const status =
        req.body?.status === 'closed' || req.body?.status === 'active'
          ? String(req.body.status)
          : String(exam.status);

      await db.query(
        `UPDATE exams
         SET duration_minutes = $1,
             starts_at = $2,
             ends_at = $3,
             max_tab_switches = $4,
             block_emulator = $5,
             strict_anti_cheat = $6,
             auto_submit_on_cheat = $7,
             status = $8,
             ended_at = CASE WHEN $8 = 'active' THEN NULL ELSE COALESCE(ended_at, NOW()) END
         WHERE id = $9`,
        [
          durationMinutes,
          startsAt ? startsAt.toISOString() : null,
          endsAt ? endsAt.toISOString() : null,
          maxTabSwitches,
          blockEmulator,
          strictAntiCheat,
          autoSubmitOnCheat,
          status,
          exam.id,
        ]
      );

      res.json({ ok: true });
    } catch (err) {
      console.error('[update exam settings]', err);
      res.status(500).json({ error: '更新考场配置失败' });
    }
  });

  // 发起者主动终结考试：立即关闭考场并为所有在考人员按当前作答草稿结算成绩
  router.post('/:id/terminate', requireAuth, async (req, res) => {
    try {
      const { rows: examRows } = await db.query<Record<string, unknown>>(
        'SELECT * FROM exams WHERE id = $1',
        [req.params.id]
      );
      if (examRows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const exam = examRows[0];
      if (exam.creator_id !== req.user!.userId && req.user!.role !== 'admin') {
        res.status(403).json({ error: '仅考试发起者或管理员可主动终结考试' });
        return;
      }

      const result = await db.withTransaction(async (tx) => {
        const { rows: updatedExam } = await tx.query<{ ended_at: string }>(
          `UPDATE exams SET status = 'closed', ended_at = NOW() WHERE id = $1 RETURNING ended_at`,
          [exam.id]
        );

        const { rows: activeSessions } = await tx.query<Record<string, unknown>>(
          `SELECT * FROM exam_sessions WHERE exam_id = $1 AND status = 'in_progress'`,
          [exam.id]
        );

        let terminatedCount = 0;
        for (const sess of activeSessions) {
          const startedAt = parseIsoOrNull(sess.started_at) || new Date();
          const durationSeconds = Math.max(
            1,
            Math.floor((Date.now() - startedAt.getTime()) / 1000)
          );
          const draftAnswers = sanitizeAnswersMap(sess.draft_answers);
          const cheatEvents = sanitizeCheatEvents(sess.cheat_events);
          const deviceInfo = sanitizeDeviceInfo(sess.device_info);
          const tabSwitchCount = Number(sess.tab_switch_count ?? 0);
          const riskFlags = deriveRiskFlags(deviceInfo, cheatEvents, tabSwitchCount, sess.risk_flags);

          await gradeAndInsertSubmission(tx, exam, {
            userId: sess.user_id ? String(sess.user_id) : null,
            participantName: String(sess.participant_name || '考生'),
            participantIdentifier: String(sess.participant_identifier || ''),
            answers: draftAnswers,
            durationSeconds,
            tabSwitchCount,
            cheatEvents,
            deviceInfo,
            riskFlags,
            startedAt,
            terminatedByCreator: true,
            sessionId: String(sess.id),
          });
          terminatedCount += 1;
        }

        return {
          endedAt: new Date(String(updatedExam[0].ended_at)).toISOString(),
          terminatedCount,
        };
      });

      res.json({
        ok: true,
        status: 'closed',
        endedAt: result.endedAt,
        terminatedCount: result.terminatedCount,
      });
    } catch (err) {
      console.error('[terminate exam]', err);
      res.status(500).json({ error: '终结考试失败，请重试' });
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
      if (status === 'closed') {
        await db.query("UPDATE exams SET status = 'closed', ended_at = COALESCE(ended_at, NOW()) WHERE id = $1", [
          req.params.id,
        ]);
      } else {
        await db.query("UPDATE exams SET status = 'active', ended_at = NULL WHERE id = $1", [
          req.params.id,
        ]);
      }
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

  // 考场二维码分享
  router.get('/:id/qrcode', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query<{
        id: string;
        creator_id: string;
        title: string;
        share_code: string;
        exam_type: string;
        status: string;
        access_password: string;
        duration_minutes: number;
      }>('SELECT id, creator_id, title, share_code, exam_type, status, access_password, duration_minutes FROM exams WHERE id = $1', [
        req.params.id,
      ]);
      if (rows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const exam = rows[0];
      const canAccess =
        exam.creator_id === req.user!.userId ||
        req.user!.role === 'admin' ||
        (exam.exam_type === 'published' && exam.status === 'active');
      if (!canAccess) {
        res.status(403).json({ error: '无权获取该考试的分享二维码' });
        return;
      }

      const cfg = getAppConfig();
      const origin = resolveShareOrigin(req, cfg);
      const shareUrl = `${origin}/exam/join/${exam.share_code}`;
      const miniProgramPath = `/pages/exam-take/exam-take?shareCode=${exam.share_code}`;
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
      res.json({
        examId: exam.id,
        title: exam.title,
        shareCode: exam.share_code,
        requiresPassword: Boolean(String(exam.access_password || '').trim()),
        durationMinutes: Number(exam.duration_minutes ?? 60),
        shareUrl,
        miniProgramPath,
        qrDataUrl,
      });
    } catch (err) {
      console.error('[exam qrcode]', err);
      res.status(500).json({ error: '生成考场二维码失败' });
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

      const nowMs = Date.now();
      const startsAtIso = toIsoOrNull(exam.starts_at);
      const endsAtIso = toIsoOrNull(exam.ends_at);
      const notStarted = Boolean(startsAtIso && nowMs < new Date(startsAtIso).getTime());
      const expired = Boolean(endsAtIso && nowMs > new Date(endsAtIso).getTime());

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
        startsAt: startsAtIso,
        endsAt: endsAtIso,
        endedAt: toIsoOrNull(exam.ended_at),
        serverTime: new Date(nowMs).toISOString(),
        notStarted,
        expired,
        totalScore: Number(exam.total_score ?? 100),
        passScore: Number(exam.pass_score ?? 60),
        maxTabSwitches: Number(exam.max_tab_switches ?? 5),
        maxAttempts: Number(exam.max_attempts ?? 3),
        blockEmulator: Boolean(exam.block_emulator),
        strictAntiCheat: exam.strict_anti_cheat === undefined ? true : Boolean(exam.strict_anti_cheat),
        autoSubmitOnCheat: exam.auto_submit_on_cheat === undefined ? true : Boolean(exam.auto_submit_on_cheat),
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

  // 考生正式开考：校验时间窗口与虚拟机/模拟器风控，创建实时监考会话
  router.post('/join/:shareCode/start', optionalAuth, async (req, res) => {
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
        res.status(400).json({ error: '该场考试已被发起者终结或关闭，无法进入答题' });
        return;
      }

      const now = new Date();
      const startsAt = parseIsoOrNull(exam.starts_at);
      const endsAt = parseIsoOrNull(exam.ends_at);
      if (startsAt && now.getTime() < startsAt.getTime()) {
        res.status(400).json({
          error: `考试尚未开始，将于 ${startsAt.toLocaleString('zh-CN')} 准时开考`,
        });
        return;
      }
      if (endsAt && now.getTime() >= endsAt.getTime()) {
        res.status(400).json({ error: '已过本场考试截止时间，考场已自动结束' });
        return;
      }

      const expectedPwd = String(exam.access_password || '').trim();
      const providedPwd = String(req.body?.accessPassword ?? '').trim();
      if (expectedPwd && providedPwd !== expectedPwd) {
        res.status(403).json({ error: '考试口令错误' });
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
        res.status(400).json({ error: '请填写考生姓名后再开始作答' });
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

      const deviceInfo = sanitizeDeviceInfo(req.body?.deviceInfo);
      const cheatEvents = sanitizeCheatEvents(req.body?.cheatEvents);
      const riskFlags = deriveRiskFlags(deviceInfo, cheatEvents, 0, req.body?.riskFlags);

      if (Boolean(exam.block_emulator) && (deviceInfo.isEmulator || deviceInfo.isVirtualSpace)) {
        res.status(403).json({
          error: '本场考试已禁止虚拟机、模拟器或应用多开环境参考，请更换真实设备重新进入',
          code: 'EMULATOR_BLOCKED',
          reasons: deviceInfo.reasons || [],
        });
        return;
      }

      const { rows: sessionRows } = await db.query<{ id: string; started_at: string }>(
        `INSERT INTO exam_sessions (
           exam_id, user_id, participant_name, participant_identifier,
           status, device_info, cheat_events, risk_flags, started_at, last_heartbeat_at
         ) VALUES ($1, $2, $3, $4, 'in_progress', $5::jsonb, $6::jsonb, $7::jsonb, NOW(), NOW())
         RETURNING id, started_at`,
        [
          exam.id,
          req.user?.userId ?? null,
          participantName,
          participantIdentifier,
          JSON.stringify(deviceInfo),
          JSON.stringify(cheatEvents),
          JSON.stringify(riskFlags),
        ]
      );

      const durationSeconds = Math.max(60, Number(exam.duration_minutes ?? 60) * 60);
      const effectiveDurationSeconds = endsAt
        ? Math.max(10, Math.min(durationSeconds, Math.floor((endsAt.getTime() - now.getTime()) / 1000)))
        : durationSeconds;

      res.status(201).json({
        sessionId: sessionRows[0].id,
        startedAt: new Date(String(sessionRows[0].started_at)).toISOString(),
        serverTime: now.toISOString(),
        effectiveDurationSeconds,
      });
    } catch (err) {
      console.error('[start exam session]', err);
      res.status(500).json({ error: '开考初始化失败' });
    }
  });

  // 考生实时心跳：同步作答草稿与风控告警，同时检测发起者是否已主动终结考试
  router.post('/join/:shareCode/heartbeat', optionalAuth, async (req, res) => {
    try {
      const shareCode = String(req.params.shareCode || '').trim().toUpperCase();
      const sessionId = String(req.body?.sessionId ?? '').trim();
      if (!sessionId) {
        res.status(400).json({ error: '缺少监考会话 ID' });
        return;
      }

      const { rows: examRows } = await db.query<Record<string, unknown>>(
        'SELECT * FROM exams WHERE share_code = $1',
        [shareCode]
      );
      if (examRows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const exam = examRows[0];

      const { rows: sessRows } = await db.query<Record<string, unknown>>(
        'SELECT * FROM exam_sessions WHERE id = $1 AND exam_id = $2',
        [sessionId, exam.id]
      );
      if (sessRows.length === 0) {
        res.status(404).json({ error: '监考会话不存在' });
        return;
      }
      const sess = sessRows[0];

      if (sess.status !== 'in_progress' || exam.status !== 'active') {
        res.json({
          examStatus: String(exam.status),
          terminated: true,
          forceSubmitted: Boolean(sess.submission_id),
          submissionId: sess.submission_id ? String(sess.submission_id) : null,
        });
        return;
      }

      const answers = sanitizeAnswersMap(req.body?.answers);
      const tabSwitchCount = Math.max(
        Number(sess.tab_switch_count ?? 0),
        Number(req.body?.tabSwitchCount ?? 0) || 0
      );
      const incomingDevice = sanitizeDeviceInfo(req.body?.deviceInfo);
      const mergedDevice: ExamDeviceInfo = {
        ...((sess.device_info as ExamDeviceInfo) || {}),
        ...incomingDevice,
        isEmulator:
          Boolean((sess.device_info as ExamDeviceInfo)?.isEmulator) || Boolean(incomingDevice.isEmulator),
        isDebugged:
          Boolean((sess.device_info as ExamDeviceInfo)?.isDebugged) || Boolean(incomingDevice.isDebugged),
        isVirtualSpace:
          Boolean((sess.device_info as ExamDeviceInfo)?.isVirtualSpace) ||
          Boolean(incomingDevice.isVirtualSpace),
        isMultiWindow:
          Boolean((sess.device_info as ExamDeviceInfo)?.isMultiWindow) ||
          Boolean(incomingDevice.isMultiWindow),
      };
      const cheatEvents = sanitizeCheatEvents(
        req.body?.cheatEvents !== undefined ? req.body.cheatEvents : sess.cheat_events
      );
      const riskFlags = deriveRiskFlags(mergedDevice, cheatEvents, tabSwitchCount, req.body?.riskFlags);

      // 若已超过截止时间 ends_at，由服务端自动结算收卷
      const endsAt = parseIsoOrNull(exam.ends_at);
      if (endsAt && Date.now() >= endsAt.getTime()) {
        const sub = await db.withTransaction(async (tx) => {
          const startedAt = parseIsoOrNull(sess.started_at) || new Date();
          const durationSeconds = Math.max(
            1,
            Math.floor((Date.now() - startedAt.getTime()) / 1000)
          );
          return gradeAndInsertSubmission(tx, exam, {
            userId: sess.user_id ? String(sess.user_id) : null,
            participantName: String(sess.participant_name || '考生'),
            participantIdentifier: String(sess.participant_identifier || ''),
            answers,
            durationSeconds,
            tabSwitchCount,
            cheatEvents,
            deviceInfo: mergedDevice,
            riskFlags,
            startedAt,
            terminatedByCreator: false,
            sessionId: String(sess.id),
          });
        });

        res.json({
          examStatus: 'expired',
          terminated: true,
          forceSubmitted: true,
          submissionId: sub.id,
        });
        return;
      }

      await db.query(
        `UPDATE exam_sessions
         SET draft_answers = $1::jsonb,
             tab_switch_count = $2,
             cheat_events = $3::jsonb,
             device_info = $4::jsonb,
             risk_flags = $5::jsonb,
             last_heartbeat_at = NOW()
         WHERE id = $6`,
        [
          JSON.stringify(answers),
          tabSwitchCount,
          JSON.stringify(cheatEvents),
          JSON.stringify(mergedDevice),
          JSON.stringify(riskFlags),
          sess.id,
        ]
      );

      const startedAt = parseIsoOrNull(sess.started_at) || new Date();
      const durationSec = Math.max(60, Number(exam.duration_minutes ?? 60) * 60);
      const byDuration = Math.max(
        0,
        Math.floor((startedAt.getTime() + durationSec * 1000 - Date.now()) / 1000)
      );
      const remainingServerSeconds = endsAt
        ? Math.max(0, Math.min(byDuration, Math.floor((endsAt.getTime() - Date.now()) / 1000)))
        : byDuration;

      res.json({
        examStatus: 'active',
        terminated: false,
        forceSubmitted: false,
        remainingServerSeconds,
      });
    } catch (err) {
      console.error('[exam heartbeat]', err);
      res.status(500).json({ error: '考场状态同步失败' });
    }
  });

  router.post('/join/:shareCode/submit', optionalAuth, async (req, res) => {
    try {
      const shareCode = String(req.params.shareCode || '').trim().toUpperCase();
      const sessionId = req.body?.sessionId ? String(req.body.sessionId).trim() : null;

      const { rows } = await db.query<Record<string, unknown>>(
        'SELECT * FROM exams WHERE share_code = $1',
        [shareCode]
      );
      if (rows.length === 0) {
        res.status(404).json({ error: '考试不存在' });
        return;
      }
      const exam = rows[0];

      // 若该会话在提交瞬间已被组织者终结并自动结算，直接返回已生成的成绩单，保证幂等体验
      if (sessionId) {
        const { rows: sessRows } = await db.query<{
          status: string;
          submission_id: string | null;
        }>('SELECT status, submission_id FROM exam_sessions WHERE id = $1 AND exam_id = $2', [
          sessionId,
          exam.id,
        ]);
        if (sessRows[0]?.submission_id) {
          const { rows: existingSubs } = await db.query<Record<string, unknown>>(
            `SELECT s.*, e.title AS exam_title, e.share_code, e.total_score, e.pass_score
             FROM exam_submissions s
             JOIN exams e ON e.id = s.exam_id
             WHERE s.id = $1`,
            [sessRows[0].submission_id]
          );
          if (existingSubs.length > 0) {
            res.status(200).json({ submission: mapSubmissionRow(existingSubs[0]) });
            return;
          }
        }
      }

      if (exam.status !== 'active') {
        res.status(400).json({ error: '该场考试已被组织者终结或关闭，无法继续提交' });
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

      const answers = sanitizeAnswersMap(req.body?.answers);
      const durationSeconds = Math.max(0, Number(req.body?.durationSeconds ?? 0) || 0);
      const tabSwitchCount = Math.max(0, Number(req.body?.tabSwitchCount ?? 0) || 0);
      const startedAt = parseIsoOrNull(req.body?.startedAt) || new Date();
      const deviceInfo = sanitizeDeviceInfo(req.body?.deviceInfo);
      const cheatEvents = sanitizeCheatEvents(req.body?.cheatEvents);
      const riskFlags = deriveRiskFlags(deviceInfo, cheatEvents, tabSwitchCount, req.body?.riskFlags);

      if (Boolean(exam.block_emulator) && (deviceInfo.isEmulator || deviceInfo.isVirtualSpace)) {
        res.status(403).json({
          error: '检测到当前处于虚拟机、模拟器或多开分身环境，本场考试禁止交卷',
          code: 'EMULATOR_BLOCKED',
        });
        return;
      }

      const submission = await db.withTransaction((tx) =>
        gradeAndInsertSubmission(tx, exam, {
          userId: req.user?.userId ?? null,
          participantName,
          participantIdentifier,
          answers,
          durationSeconds,
          tabSwitchCount,
          cheatEvents,
          deviceInfo,
          riskFlags,
          startedAt,
          terminatedByCreator: false,
          sessionId,
        })
      );

      res.status(201).json({ submission });
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
          ...mapSubmissionRow(s),
          creatorId: String(s.creator_id),
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

      const { rows: activeSessionRows } = await db.query<Record<string, unknown>>(
        `SELECT * FROM exam_sessions
         WHERE exam_id = $1 AND status = 'in_progress'
         ORDER BY started_at DESC`,
        [exam.id]
      );

      const snapshot = (Array.isArray(exam.questions_snapshot) ? exam.questions_snapshot : []) as ExamQuestionSnapshot[];

      const submissions: ExamSubmissionItem[] = subs.map((s) =>
        mapSubmissionRow(s, Number(exam.total_score), Number(exam.pass_score))
      );

      const activeSessions: ActiveExamSessionItem[] = activeSessionRows.map((sess) => {
        const draft = sanitizeAnswersMap(sess.draft_answers);
        const answeredCount = Object.values(draft).filter((v) => String(v).trim().length > 0).length;
        return {
          id: String(sess.id),
          examId: String(sess.exam_id),
          userId: sess.user_id ? String(sess.user_id) : null,
          participantName: String(sess.participant_name),
          participantIdentifier: String(sess.participant_identifier || ''),
          status: 'in_progress',
          answeredCount,
          tabSwitchCount: Number(sess.tab_switch_count ?? 0),
          cheatEvents: Array.isArray(sess.cheat_events)
            ? (sess.cheat_events as CheatEventItem[])
            : [],
          deviceInfo:
            sess.device_info && typeof sess.device_info === 'object'
              ? (sess.device_info as ExamDeviceInfo)
              : {},
          riskFlags: Array.isArray(sess.risk_flags) ? (sess.risk_flags as string[]) : [],
          startedAt: new Date(String(sess.started_at)).toISOString(),
          lastHeartbeatAt: new Date(String(sess.last_heartbeat_at)).toISOString(),
        };
      });

      const totalSubs = submissions.length;
      const avgScore =
        totalSubs > 0
          ? Number((submissions.reduce((sum, s) => sum + s.score, 0) / totalSubs).toFixed(1))
          : 0;
      const avgAccuracy =
        totalSubs > 0
          ? Number(
              (
                submissions.reduce((sum, s) => sum + Number(s.accuracy ?? 0), 0) / totalSubs
              ).toFixed(1)
            )
          : 0;
      const maxScore = totalSubs > 0 ? Math.max(...submissions.map((s) => s.score)) : 0;
      const minScore = totalSubs > 0 ? Math.min(...submissions.map((s) => s.score)) : 0;
      const passCount = submissions.filter((s) => s.isPassed).length;
      const passRate = totalSubs > 0 ? Math.round((passCount / totalSubs) * 100) : 0;
      const riskSubmissionCount = submissions.filter(
        (s) => (s.riskFlags?.length ?? 0) > 0 || s.tabSwitchCount > 0
      ).length;

      // 单题正确率与错误率统计
      const questionStats = snapshot.map((q, idx) => {
        let correctTimes = 0;
        for (const s of submissions) {
          if (s.gradingDetail[q.questionId]?.isCorrect) {
            correctTimes += 1;
          }
        }
        const wrongTimes = totalSubs - correctTimes;
        const correctRate = totalSubs > 0 ? Math.round((correctTimes / totalSubs) * 100) : 0;
        return {
          index: idx + 1,
          questionId: q.questionId,
          type: q.type,
          stem: q.stem,
          chapterTitle: q.chapterTitle || '未分类',
          score: q.score,
          correctTimes,
          wrongTimes,
          correctRate,
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
          startsAt: toIsoOrNull(exam.starts_at),
          endsAt: toIsoOrNull(exam.ends_at),
          endedAt: toIsoOrNull(exam.ended_at),
          maxTabSwitches: Number(exam.max_tab_switches ?? 5),
          blockEmulator: Boolean(exam.block_emulator),
          strictAntiCheat:
            exam.strict_anti_cheat === undefined ? true : Boolean(exam.strict_anti_cheat),
          autoSubmitOnCheat:
            exam.auto_submit_on_cheat === undefined ? true : Boolean(exam.auto_submit_on_cheat),
          status: String(exam.status),
        },
        summary: {
          submissionCount: totalSubs,
          inProgressCount: activeSessions.length,
          avgScore,
          avgAccuracy,
          maxScore,
          minScore,
          passCount,
          passRate,
          riskSubmissionCount,
        },
        activeSessions,
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
        total_questions: number;
      }>('SELECT grading_detail, total_questions FROM exam_submissions WHERE id = $1 AND exam_id = $2', [
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
      const totalQ = Number(subRows[0].total_questions ?? values.length) || values.length;
      const newAccuracy = totalQ > 0 ? Number(((newCorrectCount / totalQ) * 100).toFixed(1)) : 0;
      const newIsPassed = newTotalScore >= Number(examRows[0].pass_score ?? 60);

      await db.query(
        `UPDATE exam_submissions
         SET grading_detail = $1::jsonb, score = $2, correct_count = $3, accuracy = $4, is_passed = $5
         WHERE id = $6`,
        [
          JSON.stringify(detail),
          newTotalScore,
          newCorrectCount,
          newAccuracy,
          newIsPassed,
          req.params.submissionId,
        ]
      );

      res.json({
        ok: true,
        score: newTotalScore,
        correctCount: newCorrectCount,
        accuracy: newAccuracy,
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
