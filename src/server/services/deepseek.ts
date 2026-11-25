import { getAppConfig } from '../config.js';
import type { DbClient } from '../db/client.js';
import { assertSafeAiBaseUrl } from '../middleware/security.js';
import type {
  AIConfig,
  ImportValidationSummary,
  ParsedQuestionDraft,
  QuestionOption,
  QuestionType,
  UserSettings,
} from '../../shared/types.js';
import {
  formatDraftsToCanonicalText,
  normalizeAndValidateDraft,
  validateDraftBatch,
} from '../../shared/questionSchema.js';
import {
  extractAnswerKeySection,
  matchChapterHeading,
  matchSectionTypeHeading,
} from './parser.js';

export interface ResolvedAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  source: 'personal' | 'system' | 'env';
}

export function normalizeChatUrl(baseUrl: string): string {
  const cleaned = (baseUrl || 'https://api.deepseek.com/v1').trim().replace(/\/+$/, '');
  if (cleaned.endsWith('/chat/completions')) {
    return cleaned;
  }
  if (/\/v\d+$/i.test(cleaned)) {
    return `${cleaned}/chat/completions`;
  }
  return `${cleaned}/v1/chat/completions`;
}

export function normalizeModelsUrl(baseUrl: string): string {
  const chatUrl = normalizeChatUrl(baseUrl);
  return chatUrl.replace(/\/chat\/completions$/, '/models');
}

export function maskApiKey(key: string): string {
  const trimmed = (key || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '****';
  return `${trimmed.slice(0, 4)}****${trimmed.slice(-4)}`;
}

function sanitizeJsonCandidate(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
}

function tryParseRelaxedJson<T>(raw: string): T | null {
  const cleaned = sanitizeJsonCandidate(raw);
  if (!cleaned) return null;

  const tryDirect = (s: string): T | null => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return null;
    }
  };

  const direct = tryDirect(cleaned);
  if (direct !== null) return direct;

  const slices: string[] = [];
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    slices.push(cleaned.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    slices.push(cleaned.slice(firstBracket, lastBracket + 1));
  }

  for (const s of slices) {
    const ok = tryDirect(s);
    if (ok !== null) return ok;
  }

  // 轻度结构修复：清理尾随逗号、补齐相邻对象/数组缺失逗号
  for (const s of [cleaned, ...slices]) {
    const repaired = s
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/\}\s*\{/g, '},{')
      .replace(/\]\s*\[/g, '],[');
    const ok = tryDirect(repaired);
    if (ok !== null) return ok;
  }

  return null;
}

export function extractJsonObject<T = Record<string, unknown>>(rawText: string): T {
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }
  const parsed = tryParseRelaxedJson<T>(cleaned);
  if (parsed !== null) {
    return parsed;
  }
  throw new Error('AI 返回内容不是合法的 JSON 格式，请重试或换用 deepseek-chat 模型');
}

export async function getSystemAIConfig(db: DbClient): Promise<AIConfig> {
  const appCfg = getAppConfig();
  const { rows } = await db.query<{ value: Partial<AIConfig> }>(
    `SELECT value FROM system_settings WHERE key = 'ai_config'`
  );
  const stored = rows[0]?.value ?? {};
  return {
    baseUrl: (stored.baseUrl || appCfg.deepseekBaseUrl || 'https://api.deepseek.com/v1').trim(),
    apiKey: (stored.apiKey || appCfg.deepseekApiKey || '').trim(),
    model: (stored.model || appCfg.deepseekModel || 'deepseek-chat').trim(),
    allowMemberUseSystemKey: stored.allowMemberUseSystemKey !== false,
  };
}

export async function resolveEffectiveAIConfig(
  db: DbClient,
  userId?: string
): Promise<ResolvedAIConfig> {
  const sysCfg = await getSystemAIConfig(db);

  if (userId) {
    const { rows } = await db.query<{ role: string; settings: UserSettings }>(
      'SELECT role, settings FROM users WHERE id = $1',
      [userId]
    );
    const userRow = rows[0];
    const personal = userRow?.settings?.aiConfig;
    if (personal?.apiKey && personal.apiKey.trim()) {
      const personalUrl = (personal.baseUrl || sysCfg.baseUrl || 'https://api.deepseek.com/v1').trim();
      if (userRow.role !== 'admin') {
        await assertSafeAiBaseUrl(personalUrl, { allowPrivate: false });
      }
      return {
        baseUrl: personalUrl,
        apiKey: personal.apiKey.trim(),
        model: (personal.model || sysCfg.model || 'deepseek-chat').trim(),
        source: 'personal',
      };
    }

    if (userRow && userRow.role !== 'admin' && sysCfg.allowMemberUseSystemKey === false) {
      throw new Error('管理员未开放系统公共 AI 额度，请在「设置」中配置您个人的 DeepSeek API Key');
    }
  }

  if (!sysCfg.apiKey) {
    throw new Error('尚未配置 DeepSeek API Key，请前往「设置」页填写您的 API Key 后再使用 AI 功能');
  }

  return {
    baseUrl: sysCfg.baseUrl,
    apiKey: sysCfg.apiKey,
    model: sysCfg.model,
    source: 'system',
  };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function createTaggedAiError(message: string, code?: string): Error {
  const err = new Error(message) as Error & { code?: string };
  if (code) {
    err.code = code;
  }
  return err;
}

function extractMessageText(rawContent: unknown): string {
  if (typeof rawContent === 'string') {
    return rawContent;
  }
  if (Array.isArray(rawContent)) {
    return rawContent
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>;
          if (typeof p.text === 'string') return p.text;
          if (typeof p.content === 'string') return p.content;
        }
        return '';
      })
      .join('');
  }
  return '';
}

function parseUpstreamCompletionPayload(rawBody: string): {
  content: string;
  reasoningContent: string;
  finishReason?: string;
} {
  try {
    const data = JSON.parse(rawBody) as Record<string, unknown>;
    const choices = Array.isArray(data.choices)
      ? (data.choices as Array<Record<string, unknown>>)
      : [];
    const choice = choices[0];
    const message = (choice?.message && typeof choice.message === 'object'
      ? choice.message
      : {}) as Record<string, unknown>;

    const content =
      extractMessageText(message.content) ||
      (typeof choice?.text === 'string' ? choice.text : '') ||
      (typeof data.output_text === 'string' ? data.output_text : '');
    const reasoningContent =
      extractMessageText(message.reasoning_content) || extractMessageText(message.reasoning);
    const finishReason =
      typeof choice?.finish_reason === 'string' && choice.finish_reason
        ? choice.finish_reason
        : undefined;

    return { content, reasoningContent, finishReason };
  } catch {
    // 兼容部分反向代理即使未传 stream:true 仍以 SSE data: 分片返回的情况
    if (/(?:^|\n)\s*data:\s*/.test(rawBody)) {
      let content = '';
      let reasoningContent = '';
      let finishReason: string | undefined;
      let parsedChunks = 0;

      for (const rawLine of rawBody.split('\n')) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payloadText = line.slice(5).trim();
        if (!payloadText || payloadText === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payloadText) as Record<string, unknown>;
          parsedChunks += 1;
          const choices = Array.isArray(chunk.choices)
            ? (chunk.choices as Array<Record<string, unknown>>)
            : [];
          const choice = choices[0];
          if (!choice) continue;
          const delta = (choice.delta && typeof choice.delta === 'object'
            ? choice.delta
            : choice.message && typeof choice.message === 'object'
              ? choice.message
              : {}) as Record<string, unknown>;
          content += extractMessageText(delta.content);
          reasoningContent +=
            extractMessageText(delta.reasoning_content) || extractMessageText(delta.reasoning);
          if (typeof choice.finish_reason === 'string' && choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
        } catch {
          // 忽略单个无法解析的 SSE 心跳/注释分片
        }
      }

      if (parsedChunks > 0) {
        return { content, reasoningContent, finishReason };
      }
    }

    throw new Error(`AI 服务返回了非 JSON 响应: ${rawBody.slice(0, 180)}`);
  }
}

async function waitWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    const abortErr = new Error('任务已取消');
    abortErr.name = 'AbortError';
    throw abortErr;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      const abortErr = new Error('任务已取消');
      abortErr.name = 'AbortError';
      reject(abortErr);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function sendSingleCompletionRequest(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  externalSignal?: AbortSignal
): Promise<{ ok: boolean; status: number; rawBody: string; latencyMs: number }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('AI 接口请求超时')), 180000);
  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason || new Error('任务已取消'));
  };
  externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const rawBody = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      rawBody,
      latencyMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function callDeepSeekChat(
  config: { baseUrl: string; apiKey: string; model: string },
  messages: ChatMessage[],
  options?: { temperature?: number; maxTokens?: number; jsonMode?: boolean; signal?: AbortSignal }
): Promise<{ content: string; latencyMs: number; finishReason?: string }> {
  const url = normalizeChatUrl(config.baseUrl);
  const modelName = (config.model || 'deepseek-chat').trim() || 'deepseek-chat';
  const isReasoner = modelName.toLowerCase().includes('reasoner');

  let reqMaxTokens = options?.maxTokens ?? 4096;
  let includeResponseFormat = Boolean(options?.jsonMode && !isReasoner);
  let downgradedMaxTokens = false;
  let retriedEmpty = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (options?.signal?.aborted) {
      const abortErr = new Error('任务已取消');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const body: Record<string, unknown> = {
      model: modelName,
      messages,
      max_tokens: reqMaxTokens,
    };

    if (!isReasoner) {
      body.temperature = options?.temperature ?? 0.15;
      if (includeResponseFormat) {
        body.response_format = { type: 'json_object' };
      }
    }

    const { ok, status, rawBody, latencyMs } = await sendSingleCompletionRequest(
      url,
      config.apiKey,
      body,
      options?.signal
    );

    if (!ok) {
      if (
        status === 400 &&
        !downgradedMaxTokens &&
        reqMaxTokens > 8192 &&
        /(?:max_tokens|8192)/i.test(rawBody)
      ) {
        downgradedMaxTokens = true;
        reqMaxTokens = 8192;
        continue;
      }

      let errMsg = `DeepSeek 接口请求失败 (HTTP ${status})`;
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed?.error?.message) {
          errMsg = `${errMsg}: ${parsed.error.message}`;
        }
      } catch {
        if (rawBody) errMsg = `${errMsg}: ${rawBody.slice(0, 200)}`;
      }
      throw new Error(errMsg);
    }

    const { content, reasoningContent, finishReason } = parseUpstreamCompletionPayload(rawBody);
    if (content.trim().length > 0) {
      return { content, latencyMs, finishReason };
    }

    // 首次正文为空时：思考耗尽 length 则自动扩容 max_tokens 并去掉 response_format 重试；否则短暂停顿重试
    if (!retriedEmpty && !options?.signal?.aborted) {
      retriedEmpty = true;
      if (finishReason === 'length' || reasoningContent.trim().length > 0) {
        if (!downgradedMaxTokens) {
          reqMaxTokens = Math.min(32768, Math.max(reqMaxTokens * 2, 16384));
        }
        includeResponseFormat = false;
        continue;
      }
      includeResponseFormat = false;
      await waitWithAbort(500, options?.signal);
      continue;
    }

    // 若未截断但模型把 JSON 写进了 reasoning_content，在 jsonMode 下尝试直接救回合法 JSON
    if (reasoningContent.trim().length > 0 && finishReason !== 'length' && options?.jsonMode) {
      try {
        extractJsonObject(reasoningContent);
        return { content: reasoningContent, latencyMs, finishReason };
      } catch {
        // 思考文本中不含完整 JSON，继续抛出明确错误
      }
    }

    if (finishReason === 'length' && reasoningContent.trim().length > 0) {
      throw createTaggedAiError(
        'AI 模型思考过程耗尽了输出长度上限（finish_reason=length），未能输出正文；请适当缩短单次文本或切换非思考模型',
        'AI_EMPTY_LENGTH'
      );
    }

    throw createTaggedAiError(
      `AI 服务返回了空响应（finish_reason=${finishReason || 'unknown'}），请稍后重试或检查模型网关配置`,
      finishReason === 'length' ? 'AI_EMPTY_LENGTH' : 'AI_EMPTY_RESPONSE'
    );
  }

  throw createTaggedAiError('AI 服务返回了空响应，请稍后重试', 'AI_EMPTY_RESPONSE');
}

export async function fetchAvailableModels(config: {
  baseUrl: string;
  apiKey: string;
}): Promise<Array<{ id: string; name?: string }>> {
  if (!config.apiKey?.trim()) {
    throw new Error('API Key 不能为空');
  }
  const url = normalizeModelsUrl(config.baseUrl);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${config.apiKey.trim()}`,
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`拉取模型列表失败 (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  const data = JSON.parse(text) as {
    data?: Array<{ id?: string; name?: string }>;
  };
  const list = Array.isArray(data?.data) ? data.data : [];
  return list
    .filter((m) => Boolean(m?.id))
    .map((m) => ({ id: String(m.id), name: m.name ? String(m.name) : undefined }));
}

export async function testAIConnection(config: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<{ ok: boolean; latencyMs: number; reply: string; endpoint: string }> {
  if (!config.apiKey?.trim()) {
    throw new Error('API Key 不能为空');
  }
  const { content, latencyMs } = await callDeepSeekChat(
    config,
    [{ role: 'user', content: '请只回复 OK' }],
    { temperature: 0, maxTokens: 1024 }
  );
  return {
    ok: true,
    latencyMs,
    reply: content.trim(),
    endpoint: normalizeChatUrl(config.baseUrl),
  };
}

const AI_SECTION_LABELS: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  boolean: '判断题',
  fill: '填空题',
  short: '简答题',
};

function scanHeadingContext(
  text: string,
  state: { chapter: string; sectionLabel: string }
): void {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const sec = matchSectionTypeHeading(line);
    if (sec) {
      state.sectionLabel = sec.type ? AI_SECTION_LABELS[sec.type] : line;
      continue;
    }
    const ch = matchChapterHeading(line);
    if (ch) {
      state.chapter = ch;
      state.sectionLabel = '';
    }
  }
}

function prependContextBannerIfNeeded(
  chunk: string,
  state: { chapter: string; sectionLabel: string }
): string {
  const firstNonEmpty =
    chunk
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || '';
  if (matchChapterHeading(firstNonEmpty) || matchSectionTypeHeading(firstNonEmpty)) {
    return chunk;
  }
  const parts = [state.chapter, state.sectionLabel].filter(Boolean);
  if (parts.length === 0) return chunk;
  return `【续前文：${parts.join(' / ')}】\n${chunk}`;
}

function splitTextIntoChunks(rawText: string, maxChunkSize = 2400): string[] {
  const paragraphs = rawText.replace(/\r\n/g, '\n').split(/\n{2,}/);
  const chunks: string[] = [];
  const ctxState = { chapter: '', sectionLabel: '' };
  let current = '';

  const pushChunk = (rawChunk: string) => {
    const trimmed = rawChunk.trim();
    if (!trimmed) return;
    const decorated = chunks.length > 0 ? prependContextBannerIfNeeded(trimmed, ctxState) : trimmed;
    chunks.push(decorated);
    scanHeadingContext(trimmed, ctxState);
  };

  for (const para of paragraphs) {
    if (para.length > maxChunkSize) {
      if (current.trim()) {
        pushChunk(current);
        current = '';
      }
      const lines = para.split('\n');
      for (const line of lines) {
        if ((current + '\n' + line).length > maxChunkSize && current.trim()) {
          pushChunk(current);
          current = line;
        } else {
          current = current ? `${current}\n${line}` : line;
        }
      }
      continue;
    }

    if ((current + '\n\n' + para).length > maxChunkSize && current.trim()) {
      pushChunk(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }

  if (current.trim()) {
    pushChunk(current);
  }
  return chunks.slice(0, 60);
}

function normalizeAiDraftItems(rawItems: unknown[], defaultChapter = ''): ParsedQuestionDraft[] {
  const drafts: ParsedQuestionDraft[] = [];
  for (let i = 0; i < rawItems.length; i += 1) {
    const item = rawItems[i] as Record<string, unknown>;
    if (!item || typeof item !== 'object') continue;
    const stem = String(item.stem ?? item.question ?? '').trim();
    if (!stem) continue;

    let type = String(item.type ?? item.question_type ?? 'single').trim().toLowerCase() as QuestionType;
    if (!['single', 'multiple', 'boolean', 'fill', 'short'].includes(type)) {
      type = 'single';
    }

    const answerRaw = Array.isArray(item.answer)
      ? item.answer.join('')
      : String(item.answer ?? '');

    drafts.push(
      normalizeAndValidateDraft(
        {
          type,
          stem,
          options: Array.isArray(item.options) ? (item.options as QuestionOption[]) : [],
          answer: answerRaw,
          explanation: String(item.explanation ?? item.analysis ?? '').trim(),
          chapterTitle: String(item.chapterTitle ?? item.chapter ?? defaultChapter).trim(),
          difficulty: Number(item.difficulty ?? 2) || 2,
          tags: Array.isArray(item.tags) ? item.tags.map((t) => String(t).trim()).filter(Boolean) : [],
          aiInferredAnswer: Boolean(item.aiInferredAnswer),
        },
        i
      )
    );
  }
  return drafts;
}

export interface AiExtractOptions {
  defaultChapter?: string;
  preserveOriginalWording?: boolean;
  autoGenerateExplanation?: boolean;
  autoInferMissingAnswer?: boolean;
  existingFingerprints?: Set<string>;
  signal?: AbortSignal;
  onProgress?: (event: {
    phase: 'starting' | 'extracting' | 'validating';
    chunkIndex: number;
    totalChunks: number;
    chunkDrafts?: ParsedQuestionDraft[];
  }) => void | Promise<void>;
}

function splitChunkInHalf(chunkText: string): [string, string] | null {
  const len = chunkText.length;
  if (len <= 600) return null;
  const mid = Math.floor(len / 2);
  const minPos = Math.floor(len * 0.25);
  const maxPos = Math.floor(len * 0.75);

  let bestIdx = -1;
  let bestDist = Infinity;

  let pos = chunkText.indexOf('\n\n', minPos);
  while (pos !== -1 && pos <= maxPos) {
    const dist = Math.abs(pos - mid);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = pos;
    }
    pos = chunkText.indexOf('\n\n', pos + 2);
  }

  if (bestIdx < 0) {
    pos = chunkText.indexOf('\n', minPos);
    while (pos !== -1 && pos <= maxPos) {
      const dist = Math.abs(pos - mid);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = pos;
      }
      pos = chunkText.indexOf('\n', pos + 1);
    }
  }

  if (bestIdx < 0) {
    bestIdx = mid;
  }

  const left = chunkText.slice(0, bestIdx).trim();
  const rightRaw = chunkText.slice(bestIdx).trim();
  if (!left || !rightRaw) return null;

  const ctxState = { chapter: '', sectionLabel: '' };
  scanHeadingContext(left, ctxState);
  const right = prependContextBannerIfNeeded(rightRaw, ctxState);
  return [left, right];
}

function isSplittableExtractError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'AI_EMPTY_LENGTH' || code === 'AI_EMPTY_RESPONSE') return true;
  const msg = err instanceof Error ? err.message : '';
  return /空响应|finish_reason=length|不是合法的 JSON|思考过程耗尽|Unexpected end/i.test(msg);
}

export async function aiExtractQuestionsFromText(
  config: ResolvedAIConfig,
  rawText: string,
  options: AiExtractOptions = {}
): Promise<{
  drafts: ParsedQuestionDraft[];
  summary: ImportValidationSummary;
  canonicalText: string;
  chunksProcessed: number;
  detectedAnswerKey: boolean;
}> {
  const defaultChapter = (options.defaultChapter || '').trim();
  const preserveOriginalWording = options.preserveOriginalWording !== false;
  const autoGenerateExplanation = options.autoGenerateExplanation !== false;
  const autoInferMissingAnswer = Boolean(options.autoInferMissingAnswer);

  const { bodyText, answerKeyText } = extractAnswerKeySection(rawText);
  const detectedAnswerKey = Boolean(answerKeyText);
  const chunks = splitTextIntoChunks(bodyText || rawText);
  const collected: ParsedQuestionDraft[] = [];

  await options.onProgress?.({
    phase: 'starting',
    chunkIndex: 0,
    totalChunks: chunks.length,
  });

  const buildChunkPrompt = (chunk: string, chunkLabel: string) =>
    `你是专业的题库标准化清洗引擎。请把下方的原始文档、试卷或笔记片段，严格清洗并转换为遵循 kaoshibao.qbank.v1 规范的结构化 JSON 试题数组。

【必须严格遵守的数据规范】
1. 严格只输出一个合法 JSON 对象，顶层键为 "questions"，不得输出任何 Markdown 解释文字。
2. 每道题的字段规范：
   - "type": 只能是 "single" | "multiple" | "boolean" | "fill" | "short"
     * 重要：凡属于「判断题 / 是非题」大题分组（或「续前文：.../ 判断题」）下的题目，即使原文无选项、无内联答案或句末带 "(    )"，type 也必须严格设为 "boolean"，严禁误判为 "short"（简答）或 "fill"（填空）！
   - "stem": 题干正文。必须去掉前导序号(如 "1." / "(1)" / "(7).")和题型标签(如 "[单选]")；修复 PDF 换行断词；如果是填空题，空位统一写成 "（____）"；${preserveOriginalWording ? '其余文字务必忠实保留原题措辞，不要随意改写。' : '可适度润色不通顺语句。'}
   - "options":
     * single / multiple: [{"key":"A","content":"..."}, {"key":"B","content":"..."}]（选项内容不要包含 "A." 等前缀）
     * boolean: [{"key":"A","content":"正确"}, {"key":"B","content":"错误"}]
     * fill / short: []
   - "answer":
     * single: 单个大写字母如 "B"
     * multiple: 按字母升序拼合的大写字母如 "ABD"
     * boolean: "A"（代表正确 / √ / 对）或 "B"（代表错误 / × / X / 错）
     * fill: 多空用 "|" 分隔如 "22|5432"
     * short: 参考答案要点
     * ${autoInferMissingAnswer ? '若原文确实未提供该题答案，请依据专业知识推导标准答案并同时设置 "aiInferredAnswer": true；若原文已有答案（或下方附带参考答案区可查到），设置 "aiInferredAnswer": false。' : '如果原文和下方参考答案区都没有给出答案，请将 "answer" 留空 ""，不要凭空捏造！'}
   - "explanation": ${autoGenerateExplanation ? '若原文无解析，请简明补充一条核心考点解析。' : '仅保留原文中的解析，原文无解析则留空 ""。'}
   - "chapterTitle": 所属章节（如 "习题1" / "第一章"；若原文无章节名，填入 "${defaultChapter}"）
   - "difficulty": 1~5 整数（默认 2）
   - "tags": 字符串数组（1~3 个核心考点词）

【标准输出 Few-Shot 示例】
{
  "questions": [
    {
      "type": "single",
      "stem": "在 Linux 中查看当前目录完整路径的命令是？",
      "options": [{"key":"A","content":"ls"},{"key":"B","content":"pwd"},{"key":"C","content":"cd"},{"key":"D","content":"cat"}],
      "answer": "B",
      "explanation": "pwd 即 Print Working Directory。",
      "chapterTitle": "Linux基础",
      "difficulty": 1,
      "tags": ["Linux", "常用命令"],
      "aiInferredAnswer": false
    },
    {
      "type": "fill",
      "stem": "HTTPS 默认端口是（____），SSH 默认端口是（____）。",
      "options": [],
      "answer": "443|22",
      "explanation": "HTTPS 使用 443，SSH 使用 22。",
      "chapterTitle": "网络协议",
      "difficulty": 1,
      "tags": ["端口"]
    }
  ]
}
${
  answerKeyText
    ? `\n【本文档末尾附带的集中参考答案区（若按「章节 -> 题型 -> 题号」分层分组且每组从 1 重置编号，请严格按「所在章节 + 所在题型 + 题号」精准配对回填）】\n"""\n${answerKeyText.slice(0, 8000)}\n"""\n`
    : ''
}
【待清洗转换的文本块（${chunkLabel}）】
"""
${chunk}
"""`;

  const extractChunkWithFallback = async (
    chunkText: string,
    chunkLabel: string,
    depth = 0
  ): Promise<ParsedQuestionDraft[]> => {
    if (options.signal?.aborted) {
      const abortErr = new Error('任务已取消');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    try {
      const { content } = await callDeepSeekChat(
        config,
        [
          {
            role: 'system',
            content: '你只输出严格的 JSON 对象 {"questions": [...]}，不输出任何多余文本。',
          },
          { role: 'user', content: buildChunkPrompt(chunkText, chunkLabel) },
        ],
        { temperature: 0.1, jsonMode: true, maxTokens: 16384, signal: options.signal }
      );

      const parsed = extractJsonObject<{ questions?: unknown[] }>(content);
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.questions)
          ? parsed.questions
          : [];
      return normalizeAiDraftItems(items, defaultChapter);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || options.signal?.aborted) {
        throw err;
      }
      if (depth < 2 && isSplittableExtractError(err)) {
        const pair = splitChunkInHalf(chunkText);
        if (pair) {
          const leftDrafts = await extractChunkWithFallback(
            pair[0],
            `${chunkLabel}·上半`,
            depth + 1
          );
          const rightDrafts = await extractChunkWithFallback(
            pair[1],
            `${chunkLabel}·下半`,
            depth + 1
          );
          return [...leftDrafts, ...rightDrafts];
        }
      }
      throw err;
    }
  };

  for (let idx = 0; idx < chunks.length; idx += 1) {
    const chunk = chunks[idx];
    const normalizedChunk = await extractChunkWithFallback(
      chunk,
      `第 ${idx + 1}/${chunks.length} 段`,
      0
    );
    collected.push(...normalizedChunk);

    await options.onProgress?.({
      phase: 'extracting',
      chunkIndex: idx + 1,
      totalChunks: chunks.length,
      chunkDrafts: normalizedChunk,
    });
  }

  if (options.signal?.aborted) {
    const abortErr = new Error('任务已取消');
    abortErr.name = 'AbortError';
    throw abortErr;
  }

  await options.onProgress?.({
    phase: 'validating',
    chunkIndex: chunks.length,
    totalChunks: chunks.length,
  });

  const validated = validateDraftBatch(collected, options.existingFingerprints);
  return {
    drafts: validated.drafts,
    summary: validated.summary,
    canonicalText: formatDraftsToCanonicalText(validated.drafts),
    chunksProcessed: chunks.length,
    detectedAnswerKey,
  };
}

export async function aiRepairQuestions(
  config: ResolvedAIConfig,
  drafts: ParsedQuestionDraft[],
  options?: { fillMissingExplanation?: boolean; existingFingerprints?: Set<string> }
): Promise<{
  drafts: ParsedQuestionDraft[];
  summary: ImportValidationSummary;
  canonicalText: string;
  repairedCount: number;
}> {
  const fillExp = options?.fillMissingExplanation !== false;
  const targetIndices: number[] = [];
  drafts.forEach((d, idx) => {
    if (d.errors.length > 0 || (fillExp && !d.explanation.trim()) || d.warnings.length > 0) {
      targetIndices.push(idx);
    }
  });

  if (targetIndices.length === 0) {
    const validated = validateDraftBatch(drafts, options?.existingFingerprints);
    return {
      drafts: validated.drafts,
      summary: validated.summary,
      canonicalText: formatDraftsToCanonicalText(validated.drafts),
      repairedCount: 0,
    };
  }

  const nextDrafts = drafts.map((d) => ({ ...d }));
  let repairedCount = 0;

  for (let start = 0; start < targetIndices.length; start += 6) {
    const batchIdx = targetIndices.slice(start, start + 6);
    const payload = batchIdx.map((origIdx) => {
      const item = nextDrafts[origIdx];
      return {
        index: origIdx,
        type: item.type,
        stem: item.stem,
        options: item.options,
        answer: item.answer,
        explanation: item.explanation,
        errors: item.errors,
        warnings: item.warnings,
      };
    });

    const prompt = `下面是一批存在格式问题（如缺答案、选项/题型不匹配、填空空位数量不符、缺解析）的试题草稿。请按 kaoshibao.qbank.v1 标准逐题修复：
1. 若某题原本没有 answer，请推导并补全标准答案；若原题标注为多选但只有1个正确项，请把 type 修正为 "single"（或补充正确项）；
2. 若填空题题干空位数量与 answer 用 "|" 分隔的数量不一致，请修正题干 （____） 空位或规范化答案；
3. 为每道缺少 explanation 的题目补充精准简明的解析；
4. 保持每道题对应的 "index" 数值不变！

严格输出 JSON：
{
  "repaired": [
    {
      "index": 0,
      "type": "single|multiple|boolean|fill|short",
      "stem": "修复后题干",
      "options": [{"key":"A","content":"..."}],
      "answer": "修复后答案",
      "explanation": "完整解析",
      "aiInferredAnswer": true
    }
  ]
}

待修复试题列表：
${JSON.stringify(payload, null, 2)}`;

    const { content } = await callDeepSeekChat(
      config,
      [
        { role: 'system', content: '你是题库质检专家，只输出严格 JSON。' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0.15, jsonMode: true, maxTokens: 16384 }
    );

    const parsed = extractJsonObject<{ repaired?: Array<Record<string, unknown>> }>(content);
    const list = Array.isArray(parsed.repaired) ? parsed.repaired : [];
    for (const fixed of list) {
      const idx = Number(fixed.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= nextDrafts.length) continue;
      const orig = nextDrafts[idx];
      const merged = normalizeAndValidateDraft(
        {
          ...orig,
          type: (fixed.type as QuestionType) || orig.type,
          stem: String(fixed.stem ?? orig.stem),
          options: Array.isArray(fixed.options) ? (fixed.options as QuestionOption[]) : orig.options,
          answer: String(fixed.answer ?? orig.answer),
          explanation: String(fixed.explanation ?? orig.explanation),
          aiInferredAnswer: !orig.answer.trim() ? true : orig.aiInferredAnswer,
        },
        idx
      );
      nextDrafts[idx] = merged;
      repairedCount += 1;
    }
  }

  const validated = validateDraftBatch(nextDrafts, options?.existingFingerprints);
  return {
    drafts: validated.drafts,
    summary: validated.summary,
    canonicalText: formatDraftsToCanonicalText(validated.drafts),
    repairedCount,
  };
}

export async function aiGenerateQuestionsFromTopic(
  config: ResolvedAIConfig,
  params: {
    topicOrMaterial: string;
    singleCount: number;
    multipleCount: number;
    booleanCount: number;
    fillCount: number;
    shortCount: number;
    difficulty: number;
    chapterTitle?: string;
  }
): Promise<{
  drafts: ParsedQuestionDraft[];
  summary: ImportValidationSummary;
  canonicalText: string;
}> {
  const total =
    params.singleCount +
    params.multipleCount +
    params.booleanCount +
    params.fillCount +
    params.shortCount;
  if (total <= 0 || total > 30) {
    throw new Error('单次 AI 出题总数须在 1 到 30 题之间');
  }

  const prompt = `请根据以下主题或复习材料，精准命制 ${total} 道严格符合 kaoshibao.qbank.v1 规范的高质量中文考试题：
- 单选题 (single)：${params.singleCount} 道（每题4个选项 A-D）
- 多选题 (multiple)：${params.multipleCount} 道（每题4个选项 A-D，至少2个正确项，答案按字母升序如 ABD）
- 判断题 (boolean)：${params.booleanCount} 道（options 固定为 A:正确, B:错误，答案填 A 或 B）
- 填空题 (fill)：${params.fillCount} 道（题干空位统一写成 （____），多空答案用 | 分隔）
- 简答题 (short)：${params.shortCount} 道
- 目标难度等级：${params.difficulty}（1最简单 ~ 5最难）

请严格输出合法 JSON：
{
  "questions": [
    {
      "type": "single|multiple|boolean|fill|short",
      "stem": "题干",
      "options": [{"key": "A", "content": "..."}],
      "answer": "标准答案",
      "explanation": "清晰详尽的解析",
      "chapterTitle": "${params.chapterTitle || ''}",
      "difficulty": ${params.difficulty},
      "tags": ["核心考点"]
    }
  ]
}

主题或材料：
"""
${params.topicOrMaterial.slice(0, 6000)}
"""`;

  const { content } = await callDeepSeekChat(
    config,
    [
      { role: 'system', content: '你是资深命题专家，只返回标准 JSON 格式试题。' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.4, jsonMode: true, maxTokens: 16384 }
  );

  const parsed = extractJsonObject<{ questions?: unknown[] }>(content);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.questions)
      ? parsed.questions
      : [];
  const normalized = normalizeAiDraftItems(items, params.chapterTitle || '');
  const validated = validateDraftBatch(normalized);
  return {
    drafts: validated.drafts,
    summary: validated.summary,
    canonicalText: formatDraftsToCanonicalText(validated.drafts),
  };
}

export async function aiExplainQuestion(
  config: ResolvedAIConfig,
  params: {
    type: QuestionType;
    stem: string;
    options: QuestionOption[];
    answer: string;
    explanation?: string;
    userAnswer?: string;
  }
): Promise<{ analysis: string; keyPoint: string; mnemonic: string }> {
  const optionsText = params.options.map((o) => `${o.key}. ${o.content}`).join('\n');
  const prompt = `请为考生深度讲解下面这道题，帮助彻底吃透考点并避坑：
题型：${params.type}
题干：${params.stem}
${optionsText ? `选项：\n${optionsText}` : ''}
标准答案：${params.answer}
${params.userAnswer ? `考生作答：${params.userAnswer}` : ''}
${params.explanation ? `已有简略解析：${params.explanation}` : ''}

请返回 JSON 格式：
{
  "keyPoint": "一句话核心考点定位",
  "analysis": "深度解析（包含：1. 为什么正确答案是对的；2. 每个错误/干扰选项为什么错；3. 考生若做错可能踩了什么思维陷阱）",
  "mnemonic": "一句朗朗上口的记忆口诀或秒杀技巧"
}`;

  const { content } = await callDeepSeekChat(
    config,
    [
      { role: 'system', content: '你是耐心、精准的备考名师，只返回标准 JSON。' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.3, jsonMode: true, maxTokens: 4096 }
  );

  const parsed = extractJsonObject<{ analysis?: string; keyPoint?: string; mnemonic?: string }>(content);
  return {
    keyPoint: String(parsed.keyPoint ?? '核心概念辨析').trim(),
    analysis: String(parsed.analysis ?? content).trim(),
    mnemonic: String(parsed.mnemonic ?? '').trim(),
  };
}

export async function aiGenerateSimilarQuestion(
  config: ResolvedAIConfig,
  params: {
    type: QuestionType;
    stem: string;
    options: QuestionOption[];
    answer: string;
    chapterTitle?: string;
  }
): Promise<ParsedQuestionDraft> {
  const optionsText = params.options.map((o) => `${o.key}. ${o.content}`).join('\n');
  const prompt = `请根据下面这道原题的核心考点，出一道“举一反三”的全新变式题（不要照抄原题题干，而是换个角度或结合场景考查同一知识点，题型保持一致为 ${params.type}）：
原题：${params.stem}
${optionsText ? `原选项：\n${optionsText}` : ''}
原答案：${params.answer}

严格返回 JSON：
{
  "type": "${params.type}",
  "stem": "全新变式题题干",
  "options": [{"key": "A", "content": "..."}],
  "answer": "标准答案",
  "explanation": "变式题解析及与原题考点的联系",
  "chapterTitle": "${params.chapterTitle || ''}",
  "difficulty": 2,
  "tags": ["举一反三"]
}`;

  const { content } = await callDeepSeekChat(
    config,
    [
      { role: 'system', content: '你是资深命题教研员，只输出严格 JSON。' },
      { role: 'user', content: prompt },
    ],
    { temperature: 0.5, jsonMode: true, maxTokens: 4096 }
  );

  const parsed = extractJsonObject<Record<string, unknown>>(content);
  const drafts = normalizeAiDraftItems([parsed], params.chapterTitle || '');
  if (drafts.length === 0) {
    throw new Error('AI 未能生成有效变式题，请重试');
  }
  return drafts[0];
}

export interface AiQuestionRatingInput {
  id: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation?: string;
}

export interface AiQuestionRatingResult {
  id: string;
  difficulty: number;
  starRating: number;
  reason: string;
}

type AiRatingBatchRunner = (
  config: ResolvedAIConfig,
  items: AiQuestionRatingInput[]
) => Promise<AiQuestionRatingResult[]>;

let ratingRunnerForTesting: AiRatingBatchRunner | null = null;

export function setAiRatingBatchRunnerForTesting(fn: AiRatingBatchRunner | null): void {
  ratingRunnerForTesting = fn;
}

function clampRatingInt(val: unknown, min: number, max: number, fallback: number): number {
  const num = Number(val);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(Math.min(max, Math.max(min, num)));
}

export interface AiRateQuestionsOptions {
  onBatchRated?: (batchResults: AiQuestionRatingResult[]) => Promise<void> | void;
}

function sanitizeRatingReason(raw: unknown): string {
  return String(raw ?? '')
    .replace(/\\"/g, '"')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * 容错提取 DeepSeek 题目评级结果：
 * 1. 优先使用强化版 extractJsonObject（支持数组、ratings/items/results 包装、尾逗号与缺逗号修复）；
 * 2. 若整体 JSON 因个别条目引号未转义或输出截断而解析失败，则按独立对象块逐条容错恢复已生成条目。
 */
export function parseRatingItemsFromRawText(
  rawText: string,
  chunk: AiQuestionRatingInput[]
): AiQuestionRatingResult[] {
  const byId = new Map<string, AiQuestionRatingInput>(chunk.map((q) => [q.id, q]));
  const byIdx = new Map<number, AiQuestionRatingInput>(chunk.map((q, i) => [i + 1, q]));
  const pickedMap = new Map<string, AiQuestionRatingResult>();

  const resolveTargetId = (rawId: unknown, rawIdx: unknown): string | null => {
    const idStr = String(rawId ?? '').trim();
    if (idStr && byId.has(idStr)) return idStr;
    const idxNum = Number(rawIdx ?? (idStr && /^\d+$/.test(idStr) ? idStr : NaN));
    if (Number.isInteger(idxNum) && byIdx.has(idxNum)) {
      return byIdx.get(idxNum)!.id;
    }
    return null;
  };

  const acceptObj = (obj: Record<string, unknown>) => {
    let targetId = resolveTargetId(obj.id, obj.idx ?? obj.index ?? obj.no);
    if (!targetId && chunk.length === 1 && (obj.difficulty !== undefined || obj.starRating !== undefined || obj.star_rating !== undefined)) {
      targetId = chunk[0].id;
    }
    if (!targetId || pickedMap.has(targetId)) return;
    pickedMap.set(targetId, {
      id: targetId,
      difficulty: clampRatingInt(obj.difficulty, 1, 5, 2),
      starRating: clampRatingInt(obj.starRating ?? obj.star_rating ?? obj.star, 1, 5, 3),
      reason: sanitizeRatingReason(obj.reason),
    });
  };

  try {
    const parsed = extractJsonObject<
      { ratings?: unknown[]; items?: unknown[]; results?: unknown[] } | unknown[]
    >(rawText);
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.ratings)
        ? parsed.ratings
        : Array.isArray(parsed.items)
          ? parsed.items
          : Array.isArray(parsed.results)
            ? parsed.results
            : [parsed];
    for (const raw of list) {
      if (raw && typeof raw === 'object') {
        acceptObj(raw as Record<string, unknown>);
      }
    }
    if (pickedMap.size > 0) {
      return Array.from(pickedMap.values());
    }
  } catch {
    // 进入逐条对象级恢复模式
  }

  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)(?:```|$)/i);
  if (fenceMatch && fenceMatch[1]) {
    cleaned = fenceMatch[1].trim();
  }

  const objectBlocks = cleaned.match(/\{[^{}]*\}/g) || [];
  for (const block of objectBlocks) {
    const objParsed = tryParseRelaxedJson<Record<string, unknown>>(block);
    if (objParsed && typeof objParsed === 'object') {
      acceptObj(objParsed);
      continue;
    }

    const idMatch = block.match(/"id"\s*:\s*"([^"]+)"/i);
    const idxMatch = block.match(/"(?:idx|index|no)"\s*:\s*"?(\d+)"?/i);
    const diffMatch = block.match(/"difficulty"\s*:\s*(\d+)/i);
    const starMatch = block.match(/"(?:starRating|star_rating|star)"\s*:\s*(\d+)/i);
    if (!diffMatch && !starMatch) continue;

    const reasonMatch = block.match(/"reason"\s*:\s*"([\s\S]*?)"\s*(?:,|\}|$)/i);
    acceptObj({
      id: idMatch?.[1],
      idx: idxMatch?.[1],
      difficulty: diffMatch?.[1],
      starRating: starMatch?.[1],
      reason: reasonMatch ? reasonMatch[1] : '',
    });
  }

  return Array.from(pickedMap.values());
}

/**
 * 调用 DeepSeek 对题目进行星级质量评分 (1~5★) 与难度评级 (1~5 级)。
 * 内置紧凑序号协议、单批容错恢复、异常自动二分重试与逐批回调落库。
 */
export async function aiRateQuestionsBatch(
  config: ResolvedAIConfig,
  items: AiQuestionRatingInput[],
  options?: AiRateQuestionsOptions
): Promise<AiQuestionRatingResult[]> {
  if (items.length === 0) return [];
  if (ratingRunnerForTesting) {
    const mocked = await ratingRunnerForTesting(config, items);
    const allowed = new Set(items.map((it) => it.id));
    const normalized = mocked
      .filter((r) => allowed.has(r.id))
      .map((r) => ({
        id: r.id,
        difficulty: clampRatingInt(r.difficulty, 1, 5, 2),
        starRating: clampRatingInt(r.starRating, 1, 5, 3),
        reason: sanitizeRatingReason(r.reason),
      }));
    if (normalized.length > 0) {
      await options?.onBatchRated?.(normalized);
    }
    return normalized;
  }

  const allRecovered = new Map<string, AiQuestionRatingResult>();

  const requestChunkOnce = async (
    chunk: AiQuestionRatingInput[],
    plainJsonMode = false
  ): Promise<AiQuestionRatingResult[]> => {
    const payloadItems = chunk.map((q, i) => ({
      idx: i + 1,
      type: q.type,
      stem: q.stem.slice(0, 300),
      options: (q.options || []).slice(0, 6).map((o) => `${o.key}.${o.content.slice(0, 80)}`),
      answer: q.answer.slice(0, 100),
      hasExplanation: Boolean(q.explanation && q.explanation.trim()),
    }));

    const prompt = `你是资深命题教研专家，请对下面这 ${chunk.length} 道试题逐题进行【难度评级】与【星级质量打评】，便于动态均衡组卷与高星题精选。

【评分标准】
1. "difficulty" (1~5 整数难度评级):
   - 1 = 简单（概念识记，一眼可辨）
   - 2 = 基础（常规理解或单步推导）
   - 3 = 中等（需分析辨析或两步推理）
   - 4 = 较难（多知识点串联、细微概念对比）
   - 5 = 困难（高阶综合应用或高频难点）
2. "starRating" (1~5 整数题目星级):
   - 5 = 极优经典题（题干严谨、考点核心、区分度高）
   - 4 = 优质标准题（规范清晰，适合考试）
   - 3 = 常规合格题（可用，区分度一般）
   - 2 = 质量偏弱（表述或干扰项较粗糙）
   - 1 = 待完善题（存在模糊或缺少关键信息）
3. "reason": 不超过 30 字的简明评级理由；注意严禁在文本值内出现英文双引号 " ，如需强调请使用「」。

【待评级试题（按 idx 序号 1~${chunk.length}）】
${JSON.stringify(payloadItems)}

请严格只输出合法 JSON（务必保证数组元素之间都有英文逗号）：
{
  "ratings": [
    { "idx": 1, "difficulty": 3, "starRating": 4, "reason": "考点典型，干扰项具区分度" }
  ]
}`;

    const { content } = await callDeepSeekChat(
      config,
      [
        {
          role: 'system',
          content:
            '你是严格遵循 JSON 语法的考试题目评级引擎，只输出 {"ratings": [...]}，禁止输出多余解释。',
        },
        { role: 'user', content: prompt },
      ],
      { temperature: plainJsonMode ? 0 : 0.15, jsonMode: !plainJsonMode, maxTokens: 4096 }
    );

    return parseRatingItemsFromRawText(content, chunk);
  };

  const rateChunkWithFallback = async (
    chunk: AiQuestionRatingInput[],
    depth = 0,
    plainJsonMode = false
  ): Promise<void> => {
    if (chunk.length === 0) return;

    try {
      const recovered = await requestChunkOnce(chunk, plainJsonMode);
      const freshItems: AiQuestionRatingResult[] = [];
      for (const item of recovered) {
        if (!allRecovered.has(item.id)) {
          allRecovered.set(item.id, item);
          freshItems.push(item);
        }
      }
      if (freshItems.length > 0) {
        await options?.onBatchRated?.(freshItems);
      }

      const missing = chunk.filter((q) => !allRecovered.has(q.id));
      if (missing.length === 0) return;

      if (missing.length > 1 && depth < 3) {
        const mid = Math.ceil(missing.length / 2);
        await rateChunkWithFallback(missing.slice(0, mid), depth + 1, plainJsonMode);
        await rateChunkWithFallback(missing.slice(mid), depth + 1, plainJsonMode);
      } else if (missing.length === 1 && !plainJsonMode) {
        await rateChunkWithFallback(missing, depth + 1, true);
      } else if (recovered.length === 0) {
        throw new Error('AI 未能返回有效的 JSON 评级数据，请重试或检查模型兼容性');
      }
    } catch (err) {
      if (chunk.length > 1 && depth < 3) {
        const mid = Math.ceil(chunk.length / 2);
        await rateChunkWithFallback(chunk.slice(0, mid), depth + 1, plainJsonMode);
        await rateChunkWithFallback(chunk.slice(mid), depth + 1, plainJsonMode);
        return;
      }
      if (chunk.length === 1 && !plainJsonMode) {
        await rateChunkWithFallback(chunk, depth + 1, true);
        return;
      }
      throw err;
    }
  };

  const batchSize = 10;
  for (let start = 0; start < items.length; start += batchSize) {
    const chunk = items.slice(start, start + batchSize);
    await rateChunkWithFallback(chunk, 0, false);
  }

  return Array.from(allRecovered.values());
}
