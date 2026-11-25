import type { DbClient } from '../db/client.js';
import type {
  AiConversionJobDetail,
  AiConversionJobOptions,
  AiConversionJobSummary,
  AiJobStatus,
  ImportValidationSummary,
  ParsedQuestionDraft,
  UserRole,
} from '../../shared/types.js';
import {
  aiExtractQuestionsFromText,
  resolveEffectiveAIConfig,
  type AiExtractOptions,
  type ResolvedAIConfig,
} from './deepseek.js';
import { batchInsertQuestionsToBank } from './bankImport.js';
import { loadBankStemFingerprints } from '../routes/import.js';

export function maskModelNameForRole(config: ResolvedAIConfig, role: UserRole): string {
  if (role === 'admin' || config.source === 'personal') {
    return config.model;
  }
  return '系统内置 AI';
}

export function sanitizeAiErrorMessage(
  err: unknown,
  role: UserRole,
  config?: ResolvedAIConfig,
  fallback = 'AI 请求失败'
): string {
  const msg = err instanceof Error ? err.message : fallback;
  if (role !== 'admin' && config && config.source !== 'personal') {
    return '系统 AI 服务暂时不可用，请稍后重试或配置个人 API';
  }
  return msg;
}

export type AiJobExtractorFn = (
  config: ResolvedAIConfig,
  rawText: string,
  options?: AiExtractOptions
) => Promise<{
  drafts: ParsedQuestionDraft[];
  summary: ImportValidationSummary;
  canonicalText: string;
  chunksProcessed: number;
  detectedAnswerKey: boolean;
}>;

interface JobRow {
  id: string;
  user_id: string;
  job_type: string;
  status: string;
  source_filename: string;
  source_text?: string;
  source_char_count: number;
  options: unknown;
  target_bank_id: string | null;
  new_bank_title: string;
  auto_import: boolean;
  progress_pct: number;
  current_chunk: number;
  total_chunks: number;
  progress_message: string;
  model_used: string;
  detected_answer_key: boolean;
  result_drafts?: unknown;
  result_summary: unknown;
  result_canonical_text?: string;
  imported_bank_id: string | null;
  imported_count: number;
  skipped_count: number;
  error_message: string;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  updated_at: Date | string;
}

const EMPTY_SUMMARY: ImportValidationSummary = {
  total: 0,
  validCount: 0,
  errorCount: 0,
  warningCount: 0,
  duplicateCount: 0,
};

const SUMMARY_COLUMNS = `
  id, user_id, job_type, status, source_filename, source_char_count,
  options, target_bank_id, new_bank_title, auto_import,
  progress_pct, current_chunk, total_chunks, progress_message,
  model_used, detected_answer_key, result_summary,
  imported_bank_id, imported_count, skipped_count, error_message,
  created_at, started_at, finished_at, updated_at
`;

const DETAIL_COLUMNS = `
  ${SUMMARY_COLUMNS},
  source_text, result_drafts, result_canonical_text
`;

function parseJsonValue<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function toIsoString(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeJobOptions(raw: unknown): AiConversionJobOptions {
  const obj = parseJsonValue<Record<string, unknown>>(raw, {});
  return {
    defaultChapter: String(obj.defaultChapter ?? '').trim(),
    preserveOriginalWording: obj.preserveOriginalWording !== false,
    autoGenerateExplanation: obj.autoGenerateExplanation !== false,
    autoInferMissingAnswer: Boolean(obj.autoInferMissingAnswer),
  };
}

function normalizeResultSummary(raw: unknown): ImportValidationSummary {
  const obj = parseJsonValue<Partial<ImportValidationSummary>>(raw, EMPTY_SUMMARY);
  return {
    total: Number(obj.total ?? 0),
    validCount: Number(obj.validCount ?? 0),
    errorCount: Number(obj.errorCount ?? 0),
    warningCount: Number(obj.warningCount ?? 0),
    duplicateCount: Number(obj.duplicateCount ?? 0),
  };
}

function rowToSummary(row: JobRow): AiConversionJobSummary {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    jobType: 'extract',
    status: (row.status as AiJobStatus) || 'queued',
    sourceFilename: String(row.source_filename || ''),
    sourceCharCount: Number(row.source_char_count ?? 0),
    options: normalizeJobOptions(row.options),
    targetBankId: row.target_bank_id ? String(row.target_bank_id) : null,
    newBankTitle: String(row.new_bank_title || ''),
    autoImport: Boolean(row.auto_import),
    progressPct: Number(row.progress_pct ?? 0),
    currentChunk: Number(row.current_chunk ?? 0),
    totalChunks: Number(row.total_chunks ?? 0),
    progressMessage: String(row.progress_message || ''),
    modelUsed: String(row.model_used || ''),
    detectedAnswerKey: Boolean(row.detected_answer_key),
    resultSummary: normalizeResultSummary(row.result_summary),
    importedBankId: row.imported_bank_id ? String(row.imported_bank_id) : null,
    importedCount: Number(row.imported_count ?? 0),
    skippedCount: Number(row.skipped_count ?? 0),
    errorMessage: String(row.error_message || ''),
    createdAt: toIsoString(row.created_at) || new Date().toISOString(),
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at),
    updatedAt: toIsoString(row.updated_at) || new Date().toISOString(),
  };
}

function rowToDetail(row: JobRow): AiConversionJobDetail {
  return {
    ...rowToSummary(row),
    sourceText: String(row.source_text || ''),
    resultDrafts: parseJsonValue<ParsedQuestionDraft[]>(row.result_drafts, []),
    resultCanonicalText: String(row.result_canonical_text || ''),
  };
}

function stripFilenameExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, '').trim();
}

export class AiJobManager {
  private readonly db: DbClient;
  private extractor: AiJobExtractorFn = aiExtractQuestionsFromText;
  private readonly maxConcurrency = 2;
  private readonly pendingQueue: string[] = [];
  private readonly activeRunners = new Map<string, Promise<void>>();
  private readonly runningControllers = new Map<string, AbortController>();

  constructor(db: DbClient) {
    this.db = db;
  }

  /**
   * 测试替身注入点，传入 null 恢复真实 DeepSeek 调用
   */
  setExtractorForTesting(fn: AiJobExtractorFn | null): void {
    this.extractor = fn ?? aiExtractQuestionsFromText;
  }

  /**
   * 等待当前内存队列中的后台任务全部落库结束（供测试清理时安全关闭数据库连接）
   */
  async waitForIdle(): Promise<void> {
    while (this.pendingQueue.length > 0 || this.activeRunners.size > 0) {
      const promises = Array.from(this.activeRunners.values());
      if (promises.length > 0) {
        await Promise.allSettled(promises);
      } else {
        await new Promise((r) => setTimeout(r, 15));
      }
    }
  }

  async recoverInterruptedJobs(): Promise<{ recoveredFailed: number; requeued: number }> {
    const failedRes = await this.db.query<{ id: string }>(
      `UPDATE ai_conversion_jobs
       SET status = 'failed',
           error_message = '服务重启导致后台转换中断，可点击重试',
           progress_message = '后台转换因服务重启中断',
           finished_at = NOW(),
           updated_at = NOW()
       WHERE status = 'running'
       RETURNING id`
    );

    const queuedRes = await this.db.query<{ id: string }>(
      `SELECT id FROM ai_conversion_jobs
       WHERE status = 'queued'
       ORDER BY created_at ASC`
    );

    for (const row of queuedRes.rows) {
      this.enqueue(String(row.id));
    }

    return {
      recoveredFailed: failedRes.rowCount,
      requeued: queuedRes.rowCount,
    };
  }

  async createExtractJob(params: {
    userId: string;
    userRole: UserRole;
    sourceFilename?: string;
    sourceText: string;
    options: AiConversionJobOptions;
    targetBankId?: string;
    newBankTitle?: string;
    autoImport?: boolean;
  }): Promise<AiConversionJobSummary> {
    const sourceText = params.sourceText.trim();
    if (!sourceText) {
      throw new Error('请提供待识别的文本内容或上传非空文档');
    }

    // 入队前立即校验是否存在可用的 AI API Key，避免排队后才失败
    const cfg = await resolveEffectiveAIConfig(this.db, params.userId);
    const modelUsed = maskModelNameForRole(cfg, params.userRole);

    const rawTargetBankId = (params.targetBankId || '').trim();
    let validatedTargetBankId: string | null = null;
    if (rawTargetBankId && rawTargetBankId !== '__new__') {
      const bankCheck = await this.db.query<{ id: string; owner_id: string }>(
        'SELECT id, owner_id FROM question_banks WHERE id = $1',
        [rawTargetBankId]
      );
      if (bankCheck.rows.length === 0) {
        throw new Error('所选目标题库不存在');
      }
      if (bankCheck.rows[0].owner_id !== params.userId && params.userRole !== 'admin') {
        throw new Error('无权向所选目标题库导入试题');
      }
      validatedTargetBankId = bankCheck.rows[0].id;
    }

    const sourceFilename = (params.sourceFilename || '').trim();
    const newBankTitle = (params.newBankTitle || '').trim();

    const { rows } = await this.db.query<JobRow>(
      `INSERT INTO ai_conversion_jobs (
         user_id, job_type, status, source_filename, source_text, source_char_count,
         options, target_bank_id, new_bank_title, auto_import,
         progress_pct, current_chunk, total_chunks, progress_message, model_used
       ) VALUES (
         $1, 'extract', 'queued', $2, $3, $4,
         $5::jsonb, $6, $7, $8,
         5, 0, 0, '已加入后台队列，等待处理...', $9
       )
       RETURNING ${SUMMARY_COLUMNS}`,
      [
        params.userId,
        sourceFilename,
        sourceText,
        sourceText.length,
        JSON.stringify(params.options),
        validatedTargetBankId,
        newBankTitle,
        Boolean(params.autoImport),
        modelUsed,
      ]
    );

    const summary = rowToSummary(rows[0]);
    this.enqueue(summary.id);
    return summary;
  }

  async listJobs(
    userId: string,
    limit = 25
  ): Promise<{ jobs: AiConversionJobSummary[]; activeCount: number }> {
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const { rows } = await this.db.query<JobRow>(
      `SELECT ${SUMMARY_COLUMNS}
       FROM ai_conversion_jobs
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, safeLimit]
    );

    const activeRes = await this.db.query<{ cnt: number | string }>(
      `SELECT COUNT(*) AS cnt
       FROM ai_conversion_jobs
       WHERE user_id = $1 AND status IN ('queued', 'running')`,
      [userId]
    );

    return {
      jobs: rows.map(rowToSummary),
      activeCount: Number(activeRes.rows[0]?.cnt ?? 0),
    };
  }

  async getJobDetail(userId: string, jobId: string): Promise<AiConversionJobDetail | null> {
    const { rows } = await this.db.query<JobRow>(
      `SELECT ${DETAIL_COLUMNS}
       FROM ai_conversion_jobs
       WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );
    if (rows.length === 0) return null;
    return rowToDetail(rows[0]);
  }

  async cancelJob(userId: string, jobId: string): Promise<AiConversionJobSummary | null> {
    const { rows } = await this.db.query<JobRow>(
      `SELECT ${SUMMARY_COLUMNS}
       FROM ai_conversion_jobs
       WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );
    if (rows.length === 0) return null;

    const existing = rowToSummary(rows[0]);
    if (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'cancelled') {
      return existing;
    }

    const idx = this.pendingQueue.indexOf(jobId);
    if (idx >= 0) {
      this.pendingQueue.splice(idx, 1);
    }

    const controller = this.runningControllers.get(jobId);
    if (controller) {
      controller.abort(new Error('任务已手动取消'));
    }

    const updated = await this.db.query<JobRow>(
      `UPDATE ai_conversion_jobs
       SET status = 'cancelled',
           error_message = '',
           progress_message = '任务已手动取消',
           finished_at = NOW(),
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
       RETURNING ${SUMMARY_COLUMNS}`,
      [jobId, userId]
    );

    if (updated.rows.length > 0) {
      return rowToSummary(updated.rows[0]);
    }
    const latest = await this.db.query<JobRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM ai_conversion_jobs WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );
    return latest.rows[0] ? rowToSummary(latest.rows[0]) : existing;
  }

  async retryJob(
    userId: string,
    userRole: UserRole,
    jobId: string
  ): Promise<AiConversionJobSummary | null> {
    const { rows } = await this.db.query<JobRow>(
      `SELECT ${SUMMARY_COLUMNS}
       FROM ai_conversion_jobs
       WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );
    if (rows.length === 0) return null;

    const current = rowToSummary(rows[0]);
    if (current.status !== 'failed' && current.status !== 'cancelled') {
      throw new Error('仅支持重试失败或已取消的后台任务');
    }

    const cfg = await resolveEffectiveAIConfig(this.db, userId);
    const modelUsed = maskModelNameForRole(cfg, userRole);

    const updated = await this.db.query<JobRow>(
      `UPDATE ai_conversion_jobs
       SET status = 'queued',
           progress_pct = 5,
           current_chunk = 0,
           total_chunks = 0,
           progress_message = '已重新加入后台队列，等待处理...',
           model_used = $3,
           detected_answer_key = FALSE,
           result_drafts = '[]'::jsonb,
           result_summary = $4::jsonb,
           result_canonical_text = '',
           imported_bank_id = NULL,
           imported_count = 0,
           skipped_count = 0,
           error_message = '',
           started_at = NULL,
           finished_at = NULL,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING ${SUMMARY_COLUMNS}`,
      [jobId, userId, modelUsed, JSON.stringify(EMPTY_SUMMARY)]
    );

    const summary = rowToSummary(updated.rows[0]);
    this.enqueue(summary.id);
    return summary;
  }

  async deleteJob(userId: string, jobId: string): Promise<boolean> {
    const idx = this.pendingQueue.indexOf(jobId);
    if (idx >= 0) {
      this.pendingQueue.splice(idx, 1);
    }
    const controller = this.runningControllers.get(jobId);
    if (controller) {
      controller.abort(new Error('任务已删除'));
    }

    const res = await this.db.query<{ id: string }>(
      'DELETE FROM ai_conversion_jobs WHERE id = $1 AND user_id = $2 RETURNING id',
      [jobId, userId]
    );
    return res.rowCount > 0;
  }

  private enqueue(jobId: string): void {
    if (!this.pendingQueue.includes(jobId) && !this.activeRunners.has(jobId)) {
      this.pendingQueue.push(jobId);
    }
    setImmediate(() => this.drainQueue());
  }

  private drainQueue(): void {
    while (this.activeRunners.size < this.maxConcurrency && this.pendingQueue.length > 0) {
      const nextId = this.pendingQueue.shift()!;
      if (this.activeRunners.has(nextId)) continue;

      const runner = this.processJob(nextId).finally(() => {
        this.activeRunners.delete(nextId);
        if (this.pendingQueue.length > 0) {
          setImmediate(() => this.drainQueue());
        }
      });
      this.activeRunners.set(nextId, runner);
    }
  }

  private async processJob(jobId: string): Promise<void> {
    const claimed = await this.db.query<JobRow>(
      `UPDATE ai_conversion_jobs
       SET status = 'running',
           started_at = COALESCE(started_at, NOW()),
           finished_at = NULL,
           error_message = '',
           progress_pct = 8,
           progress_message = '正在初始化后端 AI 转换引擎...',
           updated_at = NOW()
       WHERE id = $1 AND status = 'queued'
       RETURNING ${DETAIL_COLUMNS}`,
      [jobId]
    );

    if (claimed.rows.length === 0) {
      return;
    }

    const jobRow = claimed.rows[0];
    const job = rowToDetail(jobRow);
    const controller = new AbortController();
    this.runningControllers.set(jobId, controller);

    let userRole: UserRole = 'member';
    let resolvedConfig: ResolvedAIConfig | undefined;

    try {
      const userRes = await this.db.query<{ role: string }>('SELECT role FROM users WHERE id = $1', [
        job.userId,
      ]);
      userRole = userRes.rows[0]?.role === 'admin' ? 'admin' : 'member';

      resolvedConfig = await resolveEffectiveAIConfig(this.db, job.userId);
      const displayModel = maskModelNameForRole(resolvedConfig, userRole);

      const existingFingerprints = job.targetBankId
        ? await loadBankStemFingerprints(this.db, job.targetBankId, job.userId, userRole)
        : undefined;

      await this.db.query(
        `UPDATE ai_conversion_jobs
         SET model_used = $2,
             progress_message = $3,
             updated_at = NOW()
         WHERE id = $1 AND status = 'running'`,
        [jobId, displayModel, `已连接 ${displayModel}，正在分块清洗与识别试题...`]
      );

      const result = await this.extractor(resolvedConfig, job.sourceText, {
        defaultChapter: job.options.defaultChapter || '',
        preserveOriginalWording: job.options.preserveOriginalWording,
        autoGenerateExplanation: job.options.autoGenerateExplanation,
        autoInferMissingAnswer: job.options.autoInferMissingAnswer,
        existingFingerprints,
        signal: controller.signal,
        onProgress: async (ev) => {
          if (controller.signal.aborted) return;
          let pct = 10;
          let msg = '正在处理...';
          if (ev.phase === 'starting') {
            pct = 10;
            msg =
              ev.totalChunks > 0
                ? `已拆分为 ${ev.totalChunks} 个片段，正在调用 ${displayModel} 识别转换...`
                : `正在调用 ${displayModel} 识别转换...`;
          } else if (ev.phase === 'extracting') {
            const total = Math.max(1, ev.totalChunks);
            pct = Math.min(88, Math.max(12, Math.round(10 + (ev.chunkIndex / total) * 78)));
            msg = `已完成第 ${ev.chunkIndex} / ${ev.totalChunks} 段识别（本段新增 ${
              ev.chunkDrafts?.length ?? 0
            } 题）`;
          } else if (ev.phase === 'validating') {
            pct = 92;
            msg = '正在执行标准 Schema 校验与去重检查...';
          }

          await this.db.query(
            `UPDATE ai_conversion_jobs
             SET progress_pct = $2,
                 current_chunk = $3,
                 total_chunks = $4,
                 progress_message = $5,
                 updated_at = NOW()
             WHERE id = $1 AND status = 'running'`,
            [jobId, pct, ev.chunkIndex, ev.totalChunks, msg]
          );
        },
      });

      if (controller.signal.aborted) {
        return;
      }

      const checkRunning = await this.db.query<{ status: string }>(
        'SELECT status FROM ai_conversion_jobs WHERE id = $1',
        [jobId]
      );
      if (checkRunning.rows[0]?.status !== 'running') {
        return;
      }

      let importedBankId: string | null = null;
      let importedCount = 0;
      let skippedCount = 0;

      if (job.autoImport && result.summary.validCount > 0) {
        await this.db.query(
          `UPDATE ai_conversion_jobs
           SET progress_pct = 96,
               progress_message = '正在将合格试题自动写入目标题库...',
               updated_at = NOW()
           WHERE id = $1 AND status = 'running'`,
          [jobId]
        );

        let destBankId = job.targetBankId;
        if (!destBankId) {
          const bankTitle =
            job.newBankTitle.trim() ||
            stripFilenameExtension(job.sourceFilename) ||
            `AI 后台导题 ${new Date().toLocaleDateString()}`;
          const created = await this.db.query<{ id: string }>(
            `INSERT INTO question_banks (owner_id, title, category, visibility)
             VALUES ($1, $2, '智能导题', 'private')
             RETURNING id`,
            [job.userId, bankTitle]
          );
          destBankId = created.rows[0].id;
        }

        const importRes = await batchInsertQuestionsToBank(this.db, {
          bankId: destBankId,
          items: result.drafts,
          skipInvalid: true,
        });
        if (importRes.ok) {
          importedBankId = destBankId;
          importedCount = importRes.insertedCount;
          skippedCount = importRes.skippedCount;
        }
      }

      const doneMsg = importedBankId
        ? `转换并自动入库完成：共 ${result.summary.total} 题，已入库 ${importedCount} 题${
            skippedCount > 0 ? `（跳过错误 ${skippedCount} 题）` : ''
          }`
        : `后台转换完成：共识别 ${result.summary.total} 题（合格 ${result.summary.validCount} 题，待修正 ${result.summary.errorCount} 题）`;

      await this.db.query(
        `UPDATE ai_conversion_jobs
         SET status = 'completed',
             progress_pct = 100,
             current_chunk = $2,
             total_chunks = $2,
             progress_message = $3,
             model_used = $4,
             detected_answer_key = $5,
             result_drafts = $6::jsonb,
             result_summary = $7::jsonb,
             result_canonical_text = $8,
             imported_bank_id = $9,
             imported_count = $10,
             skipped_count = $11,
             finished_at = NOW(),
             updated_at = NOW()
         WHERE id = $1 AND status = 'running'`,
        [
          jobId,
          result.chunksProcessed,
          doneMsg,
          displayModel,
          result.detectedAnswerKey,
          JSON.stringify(result.drafts),
          JSON.stringify(result.summary),
          result.canonicalText,
          importedBankId,
          importedCount,
          skippedCount,
        ]
      );
    } catch (err) {
      const currentStatusRes = await this.db
        .query<{ status: string }>('SELECT status FROM ai_conversion_jobs WHERE id = $1', [jobId])
        .catch(() => ({ rows: [] as Array<{ status: string }> }));

      const currentStatus = currentStatusRes.rows[0]?.status;
      if (
        controller.signal.aborted ||
        currentStatus === 'cancelled' ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        if (currentStatus === 'running' || currentStatus === 'queued') {
          await this.db
            .query(
              `UPDATE ai_conversion_jobs
               SET status = 'cancelled',
                   error_message = '',
                   progress_message = '任务已手动取消',
                   finished_at = COALESCE(finished_at, NOW()),
                   updated_at = NOW()
               WHERE id = $1 AND status IN ('queued', 'running')`,
              [jobId]
            )
            .catch(() => undefined);
        }
        return;
      }

      if (!currentStatus) {
        return;
      }

      const safeErr = sanitizeAiErrorMessage(err, userRole, resolvedConfig, 'AI 后台转换失败');
      console.error(`[ai job ${jobId}]`, err);
      await this.db
        .query(
          `UPDATE ai_conversion_jobs
           SET status = 'failed',
               error_message = $2,
               progress_message = '后台转换失败',
               finished_at = NOW(),
               updated_at = NOW()
           WHERE id = $1 AND status IN ('queued', 'running')`,
          [jobId, safeErr]
        )
        .catch(() => undefined);
    } finally {
      this.runningControllers.delete(jobId);
    }
  }
}

const managersByDb = new WeakMap<DbClient, AiJobManager>();

export function getAiJobManager(db: DbClient): AiJobManager {
  let manager = managersByDb.get(db);
  if (!manager) {
    manager = new AiJobManager(db);
    managersByDb.set(db, manager);
  }
  return manager;
}
