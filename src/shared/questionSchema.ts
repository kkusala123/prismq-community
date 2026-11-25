import type {
  ImportValidationSummary,
  ParsedQuestionDraft,
  QuestionOption,
  QuestionType,
} from './types.js';

export const STANDARD_SCHEMA_VERSION = 'kaoshibao.qbank.v1';

export const STANDARD_QUESTION_BANK_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://kaoshibao.local/schemas/qbank.v1.json',
  title: '棱题 · PrismQ 标准题库数据契约 (v1)',
  version: STANDARD_SCHEMA_VERSION,
  type: 'object',
  required: ['schemaVersion', 'questions'],
  properties: {
    schemaVersion: {
      type: 'string',
      const: STANDARD_SCHEMA_VERSION,
    },
    title: {
      type: 'string',
      description: '题库标题（可选）',
    },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['type', 'stem', 'answer'],
        properties: {
          type: {
            type: 'string',
            enum: ['single', 'multiple', 'boolean', 'fill', 'short'],
            description: '题型：single=单选, multiple=多选, boolean=判断, fill=填空, short=简答',
          },
          stem: {
            type: 'string',
            minLength: 1,
            description: '题干正文（不含前导序号与题型标签；填空题统一使用 （____） 标记空位）',
          },
          options: {
            type: 'array',
            description: '选项数组（单选/多选 2~8 项；判断固定 A=正确 B=错误；填空/简答为空数组）',
            items: {
              type: 'object',
              required: ['key', 'content'],
              properties: {
                key: { type: 'string', pattern: '^[A-H]$' },
                content: { type: 'string', minLength: 1 },
              },
            },
          },
          answer: {
            type: 'string',
            minLength: 1,
            description:
              '标准答案：单选为单字母(B)；多选为按序排列大写字母(ABD)；判断为 A(正确) 或 B(错误)；填空多空用 | 分隔，同空等价答案用 // 分隔',
          },
          explanation: {
            type: 'string',
            description: '答案解析与考点说明',
          },
          chapterTitle: {
            type: 'string',
            description: '所属章节名称',
          },
          difficulty: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            default: 2,
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export const CANONICAL_FORMAT_SAMPLE = `### 第一章 · 计算机网络基础

1. [单选题] 在 OSI 七层参考模型中，负责端到端可靠传输与流量控制的是哪一层？
A. 网络层
B. 传输层
C. 数据链路层
D. 会话层
答案：B
解析：传输层（如 TCP）负责端到端通信与流量控制；网络层负责路由分组转发。
难度：1
标签：OSI模型, 传输层

2. [多选题] 下列关于 HTTP/2 的改进，说法正确的有哪些？
A. 支持二进制分帧与单连接多路复用
B. 引入 HPACK 算法压缩请求头
C. 放弃 TCP 改用 UDP 协议
D. 支持服务端主动推送
答案：ABD
解析：HTTP/2 仍基于 TCP 协议运行；改用 UDP（QUIC）的是 HTTP/3。
难度：2

3. [判断题] HTTPS 协议默认使用的 TCP 端口是 443。
答案：正确
解析：HTTP 默认 80 端口，HTTPS 默认 443 端口。

4. [填空题] SSH 协议默认端口是（____），PostgreSQL 数据库默认端口是（____）。
答案：22|5432
解析：多空填空题使用竖线 | 依次分隔每个空的答案。

5. [简答题] 简述 Docker Compose 中 volumes 数据卷的核心作用。
答案：实现容器数据持久化存储，容器销毁或升级重建后数据库等关键数据不会丢失。
解析：容器可写层随生命周期释放，挂载 Named Volume 或宿主机目录是生产持久化标准做法。`;

const BOOLEAN_TRUE_TOKENS = new Set([
  'A',
  '对',
  '正确',
  '√',
  '✓',
  '✔',
  'T',
  'TRUE',
  'YES',
  'Y',
  '1',
  '是',
]);
const BOOLEAN_FALSE_TOKENS = new Set([
  'B',
  '错',
  '错误',
  '×',
  '✗',
  'X',
  '✘',
  '✕',
  '✖',
  'F',
  'FALSE',
  'NO',
  'N',
  '0',
  '否',
]);

export function normalizeCanonicalAnswer(type: QuestionType, raw: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';

  if (type === 'single') {
    const letters = trimmed.toUpperCase().match(/[A-H]/g);
    return letters && letters.length > 0 ? letters[0] : trimmed.toUpperCase();
  }
  if (type === 'multiple') {
    const letters = Array.from(new Set(trimmed.toUpperCase().match(/[A-H]/g) || [])).sort();
    return letters.join('');
  }
  if (type === 'boolean') {
    const upper = trimmed
      .replace(/^[（(\[【\s]+|[）)\]】\s.。、,，]+$/g, '')
      .trim()
      .toUpperCase();
    if (BOOLEAN_TRUE_TOKENS.has(upper)) return 'A';
    if (BOOLEAN_FALSE_TOKENS.has(upper)) return 'B';
    return upper;
  }
  if (type === 'fill') {
    return trimmed
      .split(/[|｜\n]+/)
      .map((p) => p.trim())
      .filter((p, idx, arr) => p.length > 0 || arr.length === 1)
      .join('|');
  }
  return trimmed;
}

export function cleanStemText(rawStem: string, type: QuestionType): string {
  let stem = (rawStem ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ')
    .trim();

  const tagRe =
    /^(?:[【\[（(]\s*(?:单选题|多选题|多项选择题|单项选择题|单选|多选|不定项|判断题|判断|填空题|填空|简答题|简答|问答)\s*[】\]）)])\s*/;
  const numRe =
    /^(?:第\s*\d+\s*题\s*[：:.\s]*|\d{1,4}\s*[.、．)）]\s*|[（(]\s*\d{1,4}\s*[)）]\s*[.、．:：]?\s*)/;

  stem = stem.replace(tagRe, '').replace(numRe, '').replace(tagRe, '').trim();

  if (type === 'fill') {
    stem = stem.replace(/[（(][\s_＿]*[）)]|_{3,}|＿{3,}/g, '（____）');
  }

  return stem;
}

export function normalizeOptionsForType(
  type: QuestionType,
  rawOptions: unknown
): QuestionOption[] {
  if (type === 'boolean') {
    return [
      { key: 'A', content: '正确' },
      { key: 'B', content: '错误' },
    ];
  }
  if (type === 'fill' || type === 'short') {
    return [];
  }
  if (!Array.isArray(rawOptions)) return [];

  const seenKeys = new Set<string>();
  const cleaned: QuestionOption[] = [];
  rawOptions.forEach((opt, idx) => {
    let key = String.fromCharCode(65 + idx);
    let content = '';
    if (typeof opt === 'string') {
      const m = opt.trim().match(/^([A-H])[.、．:：)）\s]+(.*)$/i);
      if (m) {
        key = m[1].toUpperCase();
        content = m[2].trim();
      } else {
        content = opt.trim();
      }
    } else if (opt && typeof opt === 'object') {
      const obj = opt as Record<string, unknown>;
      key = String(obj.key || key).trim().toUpperCase().slice(0, 1) || key;
      content = String(obj.content ?? obj.text ?? '')
        .trim()
        .replace(/^[A-H][.、．:：)）]\s*/, '')
        .trim();
    }
    if (content && !seenKeys.has(key)) {
      seenKeys.add(key);
      cleaned.push({ key, content });
    }
  });

  return cleaned;
}

export function countFillBlankSlots(stem: string): number {
  const matches = stem.match(/（____）|[（(][\s_＿]*[）)]|_{3,}|＿{3,}/g);
  return matches ? matches.length : 0;
}

export function computeStemFingerprint(stem: string): string {
  return stem
    .toLowerCase()
    .replace(/[\s，,。.;；:：!！?？（）()【】\[\]_＿"'‘’“”`]/g, '');
}

export function normalizeAndValidateDraft(
  input: Partial<ParsedQuestionDraft> & { type?: QuestionType | string },
  index = 0
): ParsedQuestionDraft {
  const validTypes: QuestionType[] = ['single', 'multiple', 'boolean', 'fill', 'short'];
  const type: QuestionType = validTypes.includes(input.type as QuestionType)
    ? (input.type as QuestionType)
    : 'single';

  const stem = cleanStemText(String(input.stem ?? ''), type);
  const options = normalizeOptionsForType(type, input.options);
  const answer = normalizeCanonicalAnswer(type, String(input.answer ?? ''));
  const explanation = String(input.explanation ?? '').trim();
  const chapterTitle = String(input.chapterTitle ?? '').trim();
  const difficulty = Math.min(5, Math.max(1, Number(input.difficulty ?? 2) || 2));
  const tags = Array.isArray(input.tags)
    ? Array.from(new Set(input.tags.map((t) => String(t).trim()).filter(Boolean)))
    : [];

  const errors: string[] = [];
  const warnings: string[] = [];

  if (!stem) {
    errors.push('题干为空');
  }

  if (type === 'single' || type === 'multiple') {
    if (options.length < 2) {
      errors.push('选择题有效选项不足 2 项');
    } else if (options.length > 8) {
      errors.push('选择题选项超过 8 项上限（A-H）');
    }
  }

  if (!answer) {
    errors.push('缺少标准答案，请补充后入库');
  } else if (type === 'single') {
    const validKeys = new Set(options.map((o) => o.key));
    if (answer.length !== 1 || (options.length > 0 && !validKeys.has(answer))) {
      errors.push(`单选题答案「${answer}」不在选项范围内`);
    }
  } else if (type === 'multiple') {
    const validKeys = new Set(options.map((o) => o.key));
    const invalid = answer.split('').filter((ch) => options.length > 0 && !validKeys.has(ch));
    if (invalid.length > 0) {
      errors.push(`多选题答案包含不存在的选项 ${invalid.join(',')}`);
    } else if (answer.length < 2) {
      errors.push('多选题答案仅有 1 项，请改为单选题或补充正确选项');
    }
  } else if (type === 'boolean') {
    if (answer !== 'A' && answer !== 'B') {
      errors.push(`判断题答案「${answer}」无效，应为「正确(A)」或「错误(B)」`);
    }
  } else if (type === 'fill') {
    const slotCount = countFillBlankSlots(stem);
    const ansParts = answer.split('|').filter((p) => p.trim().length > 0);
    if (slotCount > 0 && ansParts.length !== slotCount) {
      warnings.push(
        `题干共有 ${slotCount} 个填空位，但答案按 | 拆分共 ${ansParts.length} 项，请核对`
      );
    }
  }

  if (!explanation) {
    warnings.push('缺少答案解析，建议补充或点击「AI 一键补解析」');
  }

  if (input.aiInferredAnswer) {
    warnings.push('答案由 AI 根据知识推导生成，请人工核对准确性');
  }

  return {
    tempId: input.tempId || `draft-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    stem,
    options,
    answer,
    explanation,
    chapterTitle,
    difficulty,
    tags,
    errors,
    warnings,
    sourceLine: input.sourceLine,
    isDuplicate: Boolean(input.isDuplicate),
    aiInferredAnswer: Boolean(input.aiInferredAnswer),
  };
}

export function validateDraftBatch(
  rawDrafts: Array<Partial<ParsedQuestionDraft> & { type?: QuestionType | string }>,
  existingFingerprints?: Set<string>
): { drafts: ParsedQuestionDraft[]; summary: ImportValidationSummary } {
  const seenInBatch = new Set<string>();
  const drafts = rawDrafts.map((item, idx) => {
    const draft = normalizeAndValidateDraft(item, idx);
    const fp = computeStemFingerprint(draft.stem);
    let isDup = false;
    if (fp.length >= 4) {
      if (seenInBatch.has(fp) || existingFingerprints?.has(fp)) {
        isDup = true;
      }
      seenInBatch.add(fp);
    }
    if (isDup) {
      draft.isDuplicate = true;
      if (!draft.warnings.includes('疑似与同批或目标题库已有题目重复')) {
        draft.warnings.push('疑似与同批或目标题库已有题目重复');
      }
    }
    return draft;
  });

  const errorCount = drafts.filter((d) => d.errors.length > 0).length;
  const warningCount = drafts.filter((d) => d.warnings.length > 0).length;
  const duplicateCount = drafts.filter((d) => d.isDuplicate).length;
  const validCount = drafts.length - errorCount;

  return {
    drafts,
    summary: {
      total: drafts.length,
      validCount,
      errorCount,
      warningCount,
      duplicateCount,
    },
  };
}

const TYPE_TAG_MAP: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  boolean: '判断题',
  fill: '填空题',
  short: '简答题',
};

export function formatDraftsToCanonicalText(drafts: ParsedQuestionDraft[]): string {
  const lines: string[] = [];
  let lastChapter = '';

  drafts.forEach((d, idx) => {
    const ch = (d.chapterTitle || '').trim();
    if (ch && ch !== lastChapter) {
      if (lines.length > 0) lines.push('');
      lines.push(`### ${ch}`);
      lines.push('');
      lastChapter = ch;
    }

    lines.push(`${idx + 1}. [${TYPE_TAG_MAP[d.type] || '单选题'}] ${d.stem}`);
    if (d.type === 'single' || d.type === 'multiple') {
      for (const opt of d.options) {
        lines.push(`${opt.key}. ${opt.content}`);
      }
    }

    const displayAnswer =
      d.type === 'boolean'
        ? d.answer === 'A'
          ? '正确'
          : d.answer === 'B'
            ? '错误'
            : d.answer
        : d.answer;
    lines.push(`答案：${displayAnswer}`);

    if (d.explanation) {
      lines.push(`解析：${d.explanation}`);
    }
    if (d.difficulty && d.difficulty !== 2) {
      lines.push(`难度：${d.difficulty}`);
    }
    if (d.tags && d.tags.length > 0) {
      lines.push(`标签：${d.tags.join(', ')}`);
    }
    lines.push('');
  });

  return lines.join('\n').trim();
}
