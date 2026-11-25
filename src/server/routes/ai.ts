import { Router } from 'express';
import multer from 'multer';
import type { DbClient } from '../db/client.js';
import { createAuthMiddlewares } from '../middleware/auth.js';
import { assertSafeAiBaseUrl, createRateLimiter } from '../middleware/security.js';
import {
  aiExplainQuestion,
  aiExtractQuestionsFromText,
  aiGenerateQuestionsFromTopic,
  aiGenerateSimilarQuestion,
  aiRateQuestionsBatch,
  aiRepairQuestions,
  fetchAvailableModels,
  getSystemAIConfig,
  resolveEffectiveAIConfig,
  testAIConnection,
  type ResolvedAIConfig,
} from '../services/deepseek.js';
import { extractRawTextFromUpload, parseUploadedFile } from '../services/parser.js';
import {
  getAiJobManager,
  maskModelNameForRole,
  sanitizeAiErrorMessage,
} from '../services/aiJobs.js';
import { fixMulterFilename, loadBankStemFingerprints } from './import.js';
import type {
  ParsedQuestionDraft,
  QuestionOption,
  QuestionType,
  UserSettings,
} from '../../shared/types.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});

function parseBoolOption(val: unknown, fallback: boolean): boolean {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'boolean') return val;
  return String(val).toLowerCase() === 'true' || String(val) === '1';
}

async function resolvePersonalOnlyConfig(
  db: DbClient,
  userId: string
): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  const { rows } = await db.query<{ settings: UserSettings }>(
    'SELECT settings FROM users WHERE id = $1',
    [userId]
  );
  const personal = rows[0]?.settings?.aiConfig;
  if (!personal?.apiKey || !personal.apiKey.trim()) {
    throw new Error('请先填写您个人的 API Key');
  }
  return {
    baseUrl: (personal.baseUrl || 'https://api.deepseek.com/v1').trim(),
    apiKey: personal.apiKey.trim(),
    model: (personal.model || 'deepseek-chat').trim(),
  };
}

export function createAiRouter(db: DbClient): Router {
  const router = Router();
  const { requireAuth } = createAuthMiddlewares(db);
  const jobManager = getAiJobManager(db);
  const aiProbeLimiter = createRateLimiter({
    windowMs: 10 * 60 * 1000,
    max: 30,
    keyPrefix: 'ai:probe',
    message: '接口探测过于频繁，请稍后再试',
  });

  router.post('/test', requireAuth, aiProbeLimiter, async (req, res) => {
    try {
      const scope = String(req.body?.scope ?? (req.user!.role === 'admin' ? 'auto' : 'personal'));
      if (scope === 'system' && req.user!.role !== 'admin') {
        res.status(403).json({ ok: false, error: '仅系统管理员可测试全局 API 配置' });
        return;
      }

      const incomingBaseUrl = String(req.body?.baseUrl ?? '').trim();
      const incomingKey = String(req.body?.apiKey ?? '').trim();
      const incomingModel = String(req.body?.model ?? '').trim();

      let cfgToTest: { baseUrl: string; apiKey: string; model: string };
      if (incomingKey && !incomingKey.includes('****')) {
        cfgToTest = {
          baseUrl: incomingBaseUrl || 'https://api.deepseek.com/v1',
          apiKey: incomingKey,
          model: incomingModel || 'deepseek-chat',
        };
      } else if (req.user!.role === 'admin' && scope === 'system') {
        const sys = await getSystemAIConfig(db);
        if (!sys.apiKey) {
          throw new Error('全局 API Key 尚未配置');
        }
        cfgToTest = {
          baseUrl: incomingBaseUrl || sys.baseUrl,
          apiKey: sys.apiKey,
          model: incomingModel || sys.model,
        };
      } else {
        // 个人测试或非管理员绝对禁止回退使用系统全局 Key
        const personal = await resolvePersonalOnlyConfig(db, req.user!.userId);
        cfgToTest = {
          baseUrl: incomingBaseUrl || personal.baseUrl,
          apiKey: personal.apiKey,
          model: incomingModel || personal.model,
        };
      }

      await assertSafeAiBaseUrl(cfgToTest.baseUrl, {
        allowPrivate: req.user!.role === 'admin',
      });
      const result = await testAIConnection(cfgToTest);
      res.json(result);
    } catch (err) {
      res.status(400).json({
        ok: false,
        error: err instanceof Error ? err.message : '连接测试失败',
      });
    }
  });

  router.post('/models', requireAuth, aiProbeLimiter, async (req, res) => {
    try {
      const scope = String(req.body?.scope ?? (req.user!.role === 'admin' ? 'auto' : 'personal'));
      if (scope === 'system' && req.user!.role !== 'admin') {
        res.status(403).json({ error: '仅系统管理员可查看全局 API 模型列表' });
        return;
      }

      const incomingBaseUrl = String(req.body?.baseUrl ?? '').trim();
      const incomingKey = String(req.body?.apiKey ?? '').trim();

      let cfgToUse: { baseUrl: string; apiKey: string };
      if (incomingKey && !incomingKey.includes('****')) {
        cfgToUse = {
          baseUrl: incomingBaseUrl || 'https://api.deepseek.com/v1',
          apiKey: incomingKey,
        };
      } else if (req.user!.role === 'admin' && scope === 'system') {
        const sys = await getSystemAIConfig(db);
        if (!sys.apiKey) {
          throw new Error('全局 API Key 尚未配置');
        }
        cfgToUse = {
          baseUrl: incomingBaseUrl || sys.baseUrl,
          apiKey: sys.apiKey,
        };
      } else {
        // 非管理员严格只允许拉取自己个人填写的模型列表，防止探测全局配置
        const personal = await resolvePersonalOnlyConfig(db, req.user!.userId);
        cfgToUse = {
          baseUrl: incomingBaseUrl || personal.baseUrl,
          apiKey: personal.apiKey,
        };
      }

      await assertSafeAiBaseUrl(cfgToUse.baseUrl, {
        allowPrivate: req.user!.role === 'admin',
      });
      const models = await fetchAvailableModels(cfgToUse);
      res.json({ models });
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : '拉取模型列表失败',
      });
    }
  });

  router.post('/extract', requireAuth, upload.single('file'), async (req, res) => {
    let config: ResolvedAIConfig | undefined;
    try {
      config = await resolveEffectiveAIConfig(db, req.user!.userId);
      const defaultChapter = String(req.body?.defaultChapter ?? '').trim();
      const bankId = String(req.body?.bankId ?? '').trim();
      const preserveOriginalWording = parseBoolOption(req.body?.preserveOriginalWording, true);
      const autoGenerateExplanation = parseBoolOption(req.body?.autoGenerateExplanation, true);
      const autoInferMissingAnswer = parseBoolOption(req.body?.autoInferMissingAnswer, false);

      let rawText = String(req.body?.rawText ?? '').trim();
      if (req.file) {
        const filename = fixMulterFilename(req.file.originalname);
        rawText = await extractRawTextFromUpload(req.file.buffer, filename);
      }

      if (!rawText.trim()) {
        res.status(400).json({ error: '请提供待识别的文本内容或上传文档' });
        return;
      }

      const existingFingerprints = await loadBankStemFingerprints(
        db,
        bankId,
        req.user!.userId,
        req.user!.role
      );

      const result = await aiExtractQuestionsFromText(config, rawText, {
        defaultChapter,
        preserveOriginalWording,
        autoGenerateExplanation,
        autoInferMissingAnswer,
        existingFingerprints,
      });

      res.json({
        count: result.drafts.length,
        chunksProcessed: result.chunksProcessed,
        detectedAnswerKey: result.detectedAnswerKey,
        drafts: result.drafts,
        summary: result.summary,
        canonicalText: result.canonicalText,
        modelUsed: maskModelNameForRole(config, req.user!.role),
      });
    } catch (err) {
      console.error('[ai extract]', err);
      res.status(400).json({
        error: sanitizeAiErrorMessage(err, req.user!.role, config, 'AI 智能导题失败'),
      });
    }
  });

  // SSE 流式进度 AI 智能导题
  router.post('/extract-stream', requireAuth, upload.single('file'), async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let closed = false;
    const abortController = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished && !res.writableEnded) {
        closed = true;
        abortController.abort(new Error('客户端已断开连接'));
      }
    });

    const keepAliveTimer = setInterval(() => {
      if (!closed && !res.writableEnded) {
        res.write(': keepalive\n\n');
      }
    }, 15000);
    keepAliveTimer.unref?.();

    const sendEvent = (event: string, data: unknown) => {
      if (!closed && !res.writableEnded) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    let config: ResolvedAIConfig | undefined;
    try {
      config = await resolveEffectiveAIConfig(db, req.user!.userId);
      const defaultChapter = String(req.body?.defaultChapter ?? '').trim();
      const bankId = String(req.body?.bankId ?? '').trim();
      const preserveOriginalWording = parseBoolOption(req.body?.preserveOriginalWording, true);
      const autoGenerateExplanation = parseBoolOption(req.body?.autoGenerateExplanation, true);
      const autoInferMissingAnswer = parseBoolOption(req.body?.autoInferMissingAnswer, false);

      let rawText = String(req.body?.rawText ?? '').trim();
      if (req.file) {
        const filename = fixMulterFilename(req.file.originalname);
        rawText = await extractRawTextFromUpload(req.file.buffer, filename);
      }

      if (!rawText.trim()) {
        sendEvent('error', { error: '请提供待识别的文本内容或上传文档' });
        res.end();
        return;
      }

      const existingFingerprints = await loadBankStemFingerprints(
        db,
        bankId,
        req.user!.userId,
        req.user!.role
      );

      const displayModel = maskModelNameForRole(config, req.user!.role);

      sendEvent('progress', {
        phase: 'starting',
        message: `已连接 ${displayModel}，正在分块清洗为标准题库格式...`,
      });

      const result = await aiExtractQuestionsFromText(config, rawText, {
        defaultChapter,
        preserveOriginalWording,
        autoGenerateExplanation,
        autoInferMissingAnswer,
        existingFingerprints,
        signal: abortController.signal,
        onProgress: (ev) => {
          sendEvent('progress', {
            phase: ev.phase,
            chunkIndex: ev.chunkIndex,
            totalChunks: ev.totalChunks,
            chunkCount: ev.chunkDrafts?.length ?? 0,
            message:
              ev.phase === 'extracting'
                ? `已完成第 ${ev.chunkIndex} / ${ev.totalChunks} 段智能识别（新增 ${ev.chunkDrafts?.length ?? 0} 题）`
                : '正在执行标准 Schema 校验与去重检查...',
          });
        },
      });

      sendEvent('done', {
        count: result.drafts.length,
        chunksProcessed: result.chunksProcessed,
        detectedAnswerKey: result.detectedAnswerKey,
        drafts: result.drafts,
        summary: result.summary,
        canonicalText: result.canonicalText,
        modelUsed: displayModel,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || closed) {
        return;
      }
      console.error('[ai extract-stream]', err);
      sendEvent('error', {
        error: sanitizeAiErrorMessage(err, req.user!.role, config, 'AI 流式导题失败'),
      });
    } finally {
      clearInterval(keepAliveTimer);
      if (!res.writableEnded) {
        res.end();
      }
    }
  });

  // 创建后端 AI 异步转换任务（支持直接上传文件或提交文本）
  router.post('/jobs', requireAuth, upload.single('file'), async (req, res) => {
    try {
      const defaultChapter = String(req.body?.defaultChapter ?? '').trim();
      const targetBankId = String(req.body?.targetBankId ?? req.body?.bankId ?? '').trim();
      const newBankTitle = String(req.body?.newBankTitle ?? '').trim();
      const autoImport = parseBoolOption(req.body?.autoImport, false);
      const preserveOriginalWording = parseBoolOption(req.body?.preserveOriginalWording, true);
      const autoGenerateExplanation = parseBoolOption(req.body?.autoGenerateExplanation, true);
      const autoInferMissingAnswer = parseBoolOption(req.body?.autoInferMissingAnswer, false);

      let sourceFilename = String(req.body?.sourceFilename ?? '').trim();
      let rawText = String(req.body?.rawText ?? '').trim();

      if (req.file) {
        sourceFilename = fixMulterFilename(req.file.originalname);
        const lower = sourceFilename.toLowerCase();
        if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
          const parsed = await parseUploadedFile(req.file.buffer, sourceFilename, defaultChapter);
          rawText = (parsed.canonicalText || parsed.rawTextPreview || '').trim();
          if (!rawText && lower.endsWith('.csv')) {
            rawText = await extractRawTextFromUpload(req.file.buffer, sourceFilename);
          }
        } else {
          rawText = await extractRawTextFromUpload(req.file.buffer, sourceFilename);
        }
      }

      if (!rawText.trim()) {
        res.status(400).json({ error: '未能从文件或文本中提取到有效内容，请检查文档格式' });
        return;
      }

      const job = await jobManager.createExtractJob({
        userId: req.user!.userId,
        userRole: req.user!.role,
        sourceFilename,
        sourceText: rawText,
        options: {
          defaultChapter,
          preserveOriginalWording,
          autoGenerateExplanation,
          autoInferMissingAnswer,
        },
        targetBankId,
        newBankTitle,
        autoImport,
      });

      res.status(202).json({ job });
    } catch (err) {
      console.error('[ai create job]', err);
      res.status(400).json({
        error: err instanceof Error ? err.message : '创建后台 AI 转换任务失败',
      });
    }
  });

  router.get('/jobs', requireAuth, async (req, res) => {
    try {
      const limit = Number(req.query?.limit ?? 25) || 25;
      const result = await jobManager.listJobs(req.user!.userId, limit);
      res.json(result);
    } catch (err) {
      console.error('[ai list jobs]', err);
      res.status(500).json({ error: '获取后台转换任务列表失败' });
    }
  });

  router.get('/jobs/:id', requireAuth, async (req, res) => {
    try {
      const job = await jobManager.getJobDetail(req.user!.userId, String(req.params.id));
      if (!job) {
        res.status(404).json({ error: '转换任务不存在或无权查看' });
        return;
      }
      res.json({ job });
    } catch (err) {
      console.error('[ai get job]', err);
      res.status(500).json({ error: '获取后台转换任务详情失败' });
    }
  });

  router.post('/jobs/:id/cancel', requireAuth, async (req, res) => {
    try {
      const job = await jobManager.cancelJob(req.user!.userId, String(req.params.id));
      if (!job) {
        res.status(404).json({ error: '转换任务不存在或无权操作' });
        return;
      }
      res.json({ job });
    } catch (err) {
      console.error('[ai cancel job]', err);
      res.status(400).json({ error: err instanceof Error ? err.message : '取消任务失败' });
    }
  });

  router.post('/jobs/:id/retry', requireAuth, async (req, res) => {
    try {
      const job = await jobManager.retryJob(
        req.user!.userId,
        req.user!.role,
        String(req.params.id)
      );
      if (!job) {
        res.status(404).json({ error: '转换任务不存在或无权操作' });
        return;
      }
      res.status(202).json({ job });
    } catch (err) {
      console.error('[ai retry job]', err);
      res.status(400).json({ error: err instanceof Error ? err.message : '重试任务失败' });
    }
  });

  router.delete('/jobs/:id', requireAuth, async (req, res) => {
    try {
      const ok = await jobManager.deleteJob(req.user!.userId, String(req.params.id));
      if (!ok) {
        res.status(404).json({ error: '转换任务不存在或无权删除' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[ai delete job]', err);
      res.status(500).json({ error: '删除任务失败' });
    }
  });

  // 一键 AI 修复异常题目与补全缺失解析
  router.post('/repair', requireAuth, async (req, res) => {
    let config: ResolvedAIConfig | undefined;
    try {
      config = await resolveEffectiveAIConfig(db, req.user!.userId);
      const drafts = Array.isArray(req.body?.drafts)
        ? (req.body.drafts as ParsedQuestionDraft[])
        : [];
      const bankId = String(req.body?.bankId ?? '').trim();
      const fillMissingExplanation = parseBoolOption(req.body?.fillMissingExplanation, true);

      if (drafts.length === 0) {
        res.status(400).json({ error: '没有需要修复的题目' });
        return;
      }

      const existingFingerprints = await loadBankStemFingerprints(
        db,
        bankId,
        req.user!.userId,
        req.user!.role
      );

      const result = await aiRepairQuestions(config, drafts, {
        fillMissingExplanation,
        existingFingerprints,
      });

      res.json({
        ...result,
        modelUsed: maskModelNameForRole(config, req.user!.role),
      });
    } catch (err) {
      console.error('[ai repair]', err);
      res.status(400).json({
        error: sanitizeAiErrorMessage(err, req.user!.role, config, 'AI 一键修复失败'),
      });
    }
  });

  router.post('/generate', requireAuth, async (req, res) => {
    let config: ResolvedAIConfig | undefined;
    try {
      config = await resolveEffectiveAIConfig(db, req.user!.userId);
      const topicOrMaterial = String(req.body?.topicOrMaterial ?? '').trim();
      if (!topicOrMaterial) {
        res.status(400).json({ error: '请输入知识点主题或复习讲义内容' });
        return;
      }

      const result = await aiGenerateQuestionsFromTopic(config, {
        topicOrMaterial,
        singleCount: Math.max(0, Number(req.body?.singleCount ?? 3)),
        multipleCount: Math.max(0, Number(req.body?.multipleCount ?? 1)),
        booleanCount: Math.max(0, Number(req.body?.booleanCount ?? 1)),
        fillCount: Math.max(0, Number(req.body?.fillCount ?? 0)),
        shortCount: Math.max(0, Number(req.body?.shortCount ?? 0)),
        difficulty: Math.min(5, Math.max(1, Number(req.body?.difficulty ?? 2))),
        chapterTitle: String(req.body?.chapterTitle ?? '').trim(),
      });

      res.json({
        count: result.drafts.length,
        drafts: result.drafts,
        summary: result.summary,
        canonicalText: result.canonicalText,
        modelUsed: maskModelNameForRole(config, req.user!.role),
      });
    } catch (err) {
      console.error('[ai generate]', err);
      res.status(400).json({
        error: sanitizeAiErrorMessage(err, req.user!.role, config, 'AI 自动出题失败'),
      });
    }
  });

  router.post('/explain', requireAuth, async (req, res) => {
    let config: ResolvedAIConfig | undefined;
    try {
      config = await resolveEffectiveAIConfig(db, req.user!.userId);
      const questionId = req.body?.questionId ? String(req.body.questionId) : '';
      const userAnswer = req.body?.userAnswer ? String(req.body.userAnswer) : '';
      const saveToQuestion = Boolean(req.body?.saveToQuestion);

      let questionData: {
        type: QuestionType;
        stem: string;
        options: QuestionOption[];
        answer: string;
        explanation: string;
        bankOwnerId?: string;
      } | null = null;

      if (questionId) {
        const { rows } = await db.query<{
          type: QuestionType;
          stem: string;
          options: QuestionOption[];
          answer: string;
          explanation: string;
          owner_id: string;
        }>(
          `SELECT q.type, q.stem, q.options, q.answer, q.explanation, b.owner_id
           FROM questions q
           JOIN question_banks b ON b.id = q.bank_id
           WHERE q.id = $1 AND (
             b.owner_id = $2
             OR b.visibility = 'public'
             OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2)
             OR $3 = 'admin'
           )`,
          [questionId, req.user!.userId, req.user!.role]
        );
        if (rows.length === 0) {
          res.status(404).json({ error: '题目不存在或无权访问' });
          return;
        }
        questionData = {
          type: rows[0].type,
          stem: rows[0].stem,
          options: rows[0].options || [],
          answer: rows[0].answer,
          explanation: rows[0].explanation || '',
          bankOwnerId: rows[0].owner_id,
        };
      } else if (req.body?.stem) {
        questionData = {
          type: (req.body.type || 'single') as QuestionType,
          stem: String(req.body.stem),
          options: Array.isArray(req.body.options) ? req.body.options : [],
          answer: String(req.body.answer ?? ''),
          explanation: String(req.body.explanation ?? ''),
        };
      }

      if (!questionData) {
        res.status(400).json({ error: '缺少题目信息' });
        return;
      }

      const result = await aiExplainQuestion(config, {
        ...questionData,
        userAnswer,
      });

      if (
        saveToQuestion &&
        questionId &&
        (questionData.bankOwnerId === req.user!.userId || req.user!.role === 'admin')
      ) {
        const merged = [
          `【考点】${result.keyPoint}`,
          result.analysis,
          result.mnemonic ? `【记忆口诀】${result.mnemonic}` : '',
        ]
          .filter(Boolean)
          .join('\n');
        await db.query('UPDATE questions SET explanation = $1, updated_at = NOW() WHERE id = $2', [
          merged,
          questionId,
        ]);
      }

      res.json({ ...result, modelUsed: maskModelNameForRole(config, req.user!.role) });
    } catch (err) {
      console.error('[ai explain]', err);
      res.status(400).json({
        error: sanitizeAiErrorMessage(err, req.user!.role, config, 'AI 讲题失败'),
      });
    }
  });

  router.post('/similar', requireAuth, async (req, res) => {
    let config: ResolvedAIConfig | undefined;
    try {
      config = await resolveEffectiveAIConfig(db, req.user!.userId);
      const questionId = req.body?.questionId ? String(req.body.questionId) : '';
      let source: {
        type: QuestionType;
        stem: string;
        options: QuestionOption[];
        answer: string;
        chapterTitle?: string;
      } | null = null;

      if (questionId) {
        const { rows } = await db.query<{
          type: QuestionType;
          stem: string;
          options: QuestionOption[];
          answer: string;
          chapter_title: string | null;
        }>(
          `SELECT q.type, q.stem, q.options, q.answer, c.title AS chapter_title
           FROM questions q
           JOIN question_banks b ON b.id = q.bank_id
           LEFT JOIN chapters c ON c.id = q.chapter_id
           WHERE q.id = $1 AND (
             b.owner_id = $2
             OR b.visibility = 'public'
             OR EXISTS (SELECT 1 FROM bank_shares bs WHERE bs.bank_id = b.id AND bs.user_id = $2)
             OR $3 = 'admin'
           )`,
          [questionId, req.user!.userId, req.user!.role]
        );
        if (rows.length === 0) {
          res.status(404).json({ error: '题目不存在或无权访问' });
          return;
        }
        source = {
          type: rows[0].type,
          stem: rows[0].stem,
          options: rows[0].options || [],
          answer: rows[0].answer,
          chapterTitle: rows[0].chapter_title || '',
        };
      } else if (req.body?.stem) {
        source = {
          type: (req.body.type || 'single') as QuestionType,
          stem: String(req.body.stem),
          options: Array.isArray(req.body.options) ? req.body.options : [],
          answer: String(req.body.answer ?? ''),
          chapterTitle: String(req.body.chapterTitle ?? ''),
        };
      }

      if (!source) {
        res.status(400).json({ error: '缺少原题信息' });
        return;
      }

      const draft = await aiGenerateSimilarQuestion(config, source);
      res.json({ draft, modelUsed: maskModelNameForRole(config, req.user!.role) });
    } catch (err) {
      console.error('[ai similar]', err);
      res.status(400).json({
        error: sanitizeAiErrorMessage(err, req.user!.role, config, '生成举一反三变式题失败'),
      });
    }
  });

  // 批量或指定题目进行 DeepSeek 星级打分与难度评级
  router.post('/rate-bank', requireAuth, async (req, res) => {
    let config: ResolvedAIConfig | undefined;
    try {
      const bankId = String(req.body?.bankId ?? '').trim();
      if (!bankId) {
        res.status(400).json({ error: '请指定需要评级的题库' });
        return;
      }

      const { rows: bankRows } = await db.query<{ id: string; owner_id: string }>(
        'SELECT id, owner_id FROM question_banks WHERE id = $1',
        [bankId]
      );
      if (bankRows.length === 0) {
        res.status(404).json({ error: '题库不存在' });
        return;
      }
      if (bankRows[0].owner_id !== req.user!.userId && req.user!.role !== 'admin') {
        res.status(403).json({ error: '仅题库创建者或管理员可执行 AI 题目评级' });
        return;
      }

      const onlyUnrated = req.body?.onlyUnrated !== false;
      const limit = Math.min(100, Math.max(1, Number(req.body?.limit ?? 20) || 20));
      const offset = onlyUnrated
        ? 0
        : Math.max(0, Math.floor(Number(req.body?.offset ?? 0) || 0));
      const questionIds = Array.isArray(req.body?.questionIds)
        ? req.body.questionIds.map((id: unknown) => String(id).trim()).filter(Boolean)
        : [];

      const { rows: targetRows } =
        questionIds.length > 0
          ? await db.query<{
              id: string;
              type: QuestionType;
              stem: string;
              options: QuestionOption[];
              answer: string;
              explanation: string;
            }>(
              `SELECT id, type, stem, options, answer, explanation
               FROM questions
               WHERE bank_id = $1 AND id = ANY($2::uuid[])
               ORDER BY sort_order ASC, created_at ASC, id ASC`,
              [bankId, questionIds]
            )
          : await db.query<{
              id: string;
              type: QuestionType;
              stem: string;
              options: QuestionOption[];
              answer: string;
              explanation: string;
            }>(
              `SELECT id, type, stem, options, answer, explanation
               FROM questions
               WHERE bank_id = $1 ${onlyUnrated ? 'AND star_rating = 0' : ''}
               ORDER BY sort_order ASC, created_at ASC, id ASC
               LIMIT $2 OFFSET $3`,
              [bankId, limit, offset]
            );

      if (targetRows.length === 0) {
        const { rows: remRows } = await db.query<{ cnt: string | number }>(
          'SELECT COUNT(*) AS cnt FROM questions WHERE bank_id = $1 AND star_rating = 0',
          [bankId]
        );
        res.json({
          ratedCount: 0,
          processedCount: 0,
          remainingUnrated: Number(remRows[0]?.cnt ?? 0),
          modelUsed: '',
          results: [],
        });
        return;
      }

      config = await resolveEffectiveAIConfig(db, req.user!.userId);
      const rated = await aiRateQuestionsBatch(
        config,
        targetRows.map((q) => ({
          id: q.id,
          type: q.type,
          stem: q.stem,
          options: Array.isArray(q.options) ? q.options : [],
          answer: q.answer,
          explanation: q.explanation,
        })),
        {
          onBatchRated: async (batch) => {
            if (batch.length === 0) return;
            await db.withTransaction(async (tx) => {
              for (const item of batch) {
                await tx.query(
                  `UPDATE questions
                   SET difficulty = $1, star_rating = $2, rating_reason = $3, rated_at = NOW(), updated_at = NOW()
                   WHERE id = $4 AND bank_id = $5`,
                  [item.difficulty, item.starRating, item.reason, item.id, bankId]
                );
              }
              await tx.query('UPDATE question_banks SET updated_at = NOW() WHERE id = $1', [bankId]);
            });
          },
        }
      );

      const { rows: remRows } = await db.query<{ cnt: string | number }>(
        'SELECT COUNT(*) AS cnt FROM questions WHERE bank_id = $1 AND star_rating = 0',
        [bankId]
      );

      res.json({
        ratedCount: rated.length,
        processedCount: targetRows.length,
        remainingUnrated: Number(remRows[0]?.cnt ?? 0),
        modelUsed: maskModelNameForRole(config, req.user!.role),
        results: rated,
      });
    } catch (err) {
      console.error('[ai rate-bank]', err);
      res.status(400).json({
        error: sanitizeAiErrorMessage(err, req.user!.role, config, 'AI 题目评级失败'),
      });
    }
  });

  return router;
}
