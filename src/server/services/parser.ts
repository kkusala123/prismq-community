import zlib from 'node:zlib';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import * as xlsxNamespace from 'xlsx';
import type {
  ImportValidationSummary,
  ParsedQuestionDraft,
  QuestionOption,
  QuestionType,
} from '../../shared/types.js';
import {
  formatDraftsToCanonicalText,
  normalizeAndValidateDraft,
  validateDraftBatch,
} from '../../shared/questionSchema.js';
import { normalizeBooleanToken } from './grader.js';

const XLSX: typeof xlsxNamespace =
  (xlsxNamespace as unknown as { default?: typeof xlsxNamespace }).default?.read
    ? (xlsxNamespace as unknown as { default: typeof xlsxNamespace }).default
    : xlsxNamespace;

const mammothApi =
  (mammoth as unknown as { default?: typeof mammoth }).default?.extractRawText
    ? (mammoth as unknown as { default: typeof mammoth }).default
    : mammoth;

export function decodeBufferToText(buffer: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('gb18030').decode(buffer);
  }
  return text.replace(/^\uFEFF/, '');
}

function detectTypeFromLabel(label: string): QuestionType | null {
  const s = label.trim().toLowerCase();
  if (!s) return null;
  if (s.includes('单选') || s === 'single' || s === 'choice' || s === 'single_choice') return 'single';
  if (s.includes('多选') || s.includes('不定项') || s === 'multiple' || s === 'multiple_choice') return 'multiple';
  if (
    s.includes('判断') ||
    s.includes('是非') ||
    s === 'boolean' ||
    s === 'bool' ||
    s === 'tf' ||
    s === 'true_false'
  ) {
    return 'boolean';
  }
  if (s.includes('填空') || s === 'fill' || s === 'blank') return 'fill';
  if (s.includes('简答') || s.includes('问答') || s.includes('论述') || s === 'short' || s === 'essay') return 'short';
  return null;
}

const FILL_BLANK_SLOT_RE =
  /(?<![A-Za-z0-9_])[（(][\s_＿]+[）)]|(?<![A-Za-z0-9_])（[\s_＿]*）|(?<=[\u4e00-\u9fa5，,。：:])\(\)|_{3,}|＿{3,}/;

function inferQuestionType(
  explicitType: QuestionType | null,
  stem: string,
  options: QuestionOption[],
  rawAnswer: string
): QuestionType {
  if (explicitType) return explicitType;

  const ansTrim = rawAnswer.trim();
  const boolVal = normalizeBooleanToken(ansTrim);
  const isBoolOptions =
    options.length === 2 &&
    ['正确', '对', 'true', '是'].includes(options[0].content.trim().toLowerCase()) &&
    ['错误', '错', 'false', '否'].includes(options[1].content.trim().toLowerCase());

  if (isBoolOptions || (options.length === 0 && boolVal && !/^[AB]$/i.test(ansTrim))) {
    return 'boolean';
  }

  if (options.length >= 2) {
    const letters = ansTrim.toUpperCase().match(/[A-H]/g) || [];
    const uniqueLetters = Array.from(new Set(letters));
    if (uniqueLetters.length > 1) return 'multiple';
    return 'single';
  }

  if (ansTrim.includes('|') || ansTrim.includes('｜') || FILL_BLANK_SLOT_RE.test(stem)) {
    return 'fill';
  }

  return 'short';
}

export function normalizeChapterKey(chapterTitle: string): string {
  return chapterTitle.trim().replace(/\s+/g, '').toLowerCase();
}

function extractCoreChapterKey(chapterTitle: string): string {
  const trimmed = chapterTitle.trim();
  const m = trimmed.match(
    /^(第\s*[一二三四五六七八九十百千\d]+\s*[章节部分讲篇单元回课]|(?:习题|练习|单元|实验|项目|专题|测试|测验)\s*[一二三四五六七八九十百\d]+|(?:Chapter|Unit|Lesson|Section|Part)\s*\d+)/i
  );
  return m ? normalizeChapterKey(m[1]) : normalizeChapterKey(trimmed);
}

const SECTION_TYPE_HEADING_RE =
  /^(?:(?:[一二三四五六七八九十百]+|[（(]\s*[一二三四五六七八九十\d]+\s*[)）]|\d{1,2})\s*[、.．:：]?\s*)?(单项选择题|多项选择题|不定项选择题|单选题|多选题|不定项|判断题|是非题|填空题|简答题|问答题|论述题|选择题)(?:\s*(?:\([^()\n]*\)|（[^（）\n]*）|【[^【】\n]*】|\[[^\[\]\n]*\]|(?:共\s*\d+\s*[小]?题|每[小]?题\s*\d+\s*分)[^\n]*))*\s*[:：]?\s*$/;

export function matchSectionTypeHeading(line: string): { matched: true; type: QuestionType | null } | null {
  const m = line.trim().match(SECTION_TYPE_HEADING_RE);
  if (!m) return null;
  const keyword = m[1];
  return {
    matched: true,
    type: keyword === '选择题' ? null : detectTypeFromLabel(keyword),
  };
}

export function matchChapterHeading(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 50 || /[。！？?!]$/.test(trimmed)) {
    return null;
  }

  const mdMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
  if (mdMatch) {
    return mdMatch[1].trim();
  }

  if (
    /^(?:第\s*[一二三四五六七八九十百千\d]+\s*[章节部分讲篇单元回课](?:\s*[·:：.\-、\s]*.*)?|(?:习题|练习|单元|实验|项目|专题|测试|测验|模拟卷|真题)\s*[一二三四五六七八九十百\d]+(?:\s*[·:：.\-、\s]*[^\n]{0,30})?|(?:Chapter|Unit|Lesson|Section|Part)\s*\d+(?:\s*[:.\-\s]+[^\n]{0,30})?)$/i.test(
      trimmed
    )
  ) {
    return trimmed;
  }

  return null;
}

function matchQuestionStart(line: string): { num: number; rest: string } | null {
  const trimmed = line.trim();
  const patterns = [
    /^第\s*(\d{1,4})\s*题\s*[：:.\s]*(.+)$/,
    /^(\d{1,4})\s*[.、．)）]\s*(.+)$/,
    /^[（(]\s*(\d{1,4})\s*[)）]\s*[.、．:：]?\s*(.+)$/,
  ];
  for (const re of patterns) {
    const m = trimmed.match(re);
    if (m) {
      const num = Number(m[1]);
      const rest = m[2].trim();
      if (num >= 1 && rest) {
        return { num, rest };
      }
    }
  }
  return null;
}

const TOP_LEVEL_CODE_START_RE =
  /^(?:(?:public|private|protected|abstract|final|static)\s+)*(?:class|interface|enum|record)\s+[A-Za-z_$][\w$]*|^import\s+(?:static\s+)?[A-Za-z_$][\w$.*]*\s*;?|^package\s+[A-Za-z_$][\w$.]*\s*;?|^#include\s*[<"]|^def\s+[A-Za-z_]\w*\s*\(|^function\s+[A-Za-z_$][\w$]*\s*\(/;

function hasUnclosedBrace(text: string): boolean {
  let balance = 0;
  for (const ch of text) {
    if (ch === '{') balance += 1;
    else if (ch === '}') balance -= 1;
  }
  return balance > 0;
}

function isCodeLikeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (TOP_LEVEL_CODE_START_RE.test(trimmed)) return true;
  if (/^[{}\[\]();]+$/.test(trimmed)) return true;
  if (/^(?:\/\/|\/\*|\*\/)/.test(trimmed)) return true;
  const hanCount = (trimmed.match(/[\u4e00-\u9fa5]/g) || []).length;
  if (hanCount === 0 && /[;{}()=<>+\-*/[\]]/.test(trimmed)) return true;
  if (
    hanCount <= 3 &&
    /^(?:(?:public|private|protected|static|final|void|int|double|float|char|boolean|byte|short|long|String|return|if|else|for|while|switch|case|break|continue|new|try|catch|throw|System\.)\b|[A-Za-z_$][\w$.]*\s*[.(={\[]])/.test(
      trimmed
    ) &&
    /[;{}()=]/.test(trimmed)
  ) {
    return true;
  }
  return false;
}

function splitInlineOptions(
  line: string,
  allowMissingA = false
): Array<{ key: string; content: string }> | null {
  const regex = /(?:^|\s+)([A-H])\s*[.、．:：)）]\s*/g;
  const matches: Array<{ key: string; index: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(line)) !== null) {
    matches.push({
      key: m[1].toUpperCase(),
      index: m.index,
      end: m.index + m[0].length,
    });
  }
  if (matches.length === 0) return null;

  if (matches[0].index > 0 && matches.length < 2) {
    return null;
  }

  for (let i = 1; i < matches.length; i += 1) {
    if (matches[i].key.charCodeAt(0) <= matches[i - 1].key.charCodeAt(0)) {
      return null;
    }
  }

  const out: Array<{ key: string; content: string }> = [];

  // 容错恢复首项漏写 "A." 的同行选项（如 `m---<=0   B.++m>0   C.m++>0   D.--m<0`）
  if (allowMissingA && matches.length >= 2 && matches[0].key === 'B' && matches[0].index > 0) {
    const prefix = line.slice(0, matches[0].index).trim();
    if (
      prefix &&
      prefix.length <= 80 &&
      !/(?:[？?：:]$|下列|以下|正确的是|错误的是|说法|叙述|[（(]\s*[)）])/.test(prefix)
    ) {
      out.push({ key: 'A', content: prefix });
    }
  }

  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].end;
    const end = i + 1 < matches.length ? matches[i + 1].index : line.length;
    const content = line.slice(start, end).trim();
    if (content) {
      out.push({ key: matches[i].key, content });
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * 解析 Moodle GIFT 标准格式（支持单选、多选、判断、填空）
 */
function tryParseGiftFormat(rawText: string, defaultChapter = ''): ParsedQuestionDraft[] | null {
  const cleanLines = rawText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'));

  const cleaned = cleanLines.join('\n').trim();
  const giftSignal = /\{(?:\s*(?:T|F|TRUE|FALSE)\s*|[~=][^}]+)\}/i;
  if (!giftSignal.test(cleaned)) return null;

  const blocks = cleaned.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const rawDrafts: Array<Partial<ParsedQuestionDraft>> = [];
  let currentChapter = defaultChapter.trim();

  for (let idx = 0; idx < blocks.length; idx += 1) {
    const block = blocks[idx];
    const catMatch = block.match(/^\$CATEGORY:\s*(.+)$/i);
    if (catMatch) {
      currentChapter = catMatch[1].trim();
      continue;
    }

    const braceMatch = block.match(/\{([\s\S]+?)\}/);
    if (!braceMatch || braceMatch.index === undefined) continue;

    let before = block.slice(0, braceMatch.index).trim();
    const after = block.slice(braceMatch.index + braceMatch[0].length).trim();
    const titleMatch = before.match(/^::([^:]+)::\s*/);
    const chapter = currentChapter;
    if (titleMatch) {
      before = before.slice(titleMatch[0].length).trim();
    }

    const inner = braceMatch[1].trim();
    const upperInner = inner.toUpperCase();

    if (['T', 'TRUE', 'F', 'FALSE'].includes(upperInner)) {
      rawDrafts.push({
        type: 'boolean',
        stem: `${before}${after ? ' ' + after : ''}`.trim(),
        answer: upperInner.startsWith('T') ? 'A' : 'B',
        chapterTitle: chapter,
      });
      continue;
    }

    // 拆解 = / ~ 选项条目
    const tokens: Array<{ prefix: '=' | '~'; text: string; isPositiveWeight: boolean }> = [];
    const itemRe = /([=~])\s*([^=~]+)/g;
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(inner)) !== null) {
      const prefix = im[1] as '=' | '~';
      let itemBody = im[2].trim();
      let isPos = prefix === '=';
      const weightMatch = itemBody.match(/^%(-?\d+(?:\.\d+)?)%\s*/);
      if (weightMatch) {
        isPos = Number(weightMatch[1]) > 0;
        itemBody = itemBody.slice(weightMatch[0].length).trim();
      }
      // 剥离 GIFT 反馈注释 `#feedback`
      const feedbackIdx = itemBody.indexOf('#');
      if (feedbackIdx >= 0) {
        itemBody = itemBody.slice(0, feedbackIdx).trim();
      }
      if (itemBody) {
        tokens.push({ prefix, text: itemBody, isPositiveWeight: isPos });
      }
    }

    if (tokens.length === 0) continue;

    // 全部是 `=` 且没有 `~` -> 填空题
    if (tokens.every((t) => t.prefix === '=')) {
      const fillStem = `${before}（____）${after}`.trim();
      const fillAnswer = tokens.map((t) => t.text).join('//');
      rawDrafts.push({
        type: 'fill',
        stem: fillStem,
        options: [],
        answer: fillAnswer,
        chapterTitle: chapter,
      });
      continue;
    }

    // 单选 / 多选
    const options: QuestionOption[] = tokens.slice(0, 8).map((t, oIdx) => ({
      key: String.fromCharCode(65 + oIdx),
      content: t.text,
    }));
    const correctKeys = tokens
      .slice(0, 8)
      .map((t, oIdx) => (t.isPositiveWeight ? String.fromCharCode(65 + oIdx) : ''))
      .filter(Boolean);

    rawDrafts.push({
      type: correctKeys.length > 1 ? 'multiple' : 'single',
      stem: `${before}${after ? ' ' + after : ''}`.trim(),
      options,
      answer: correctKeys.join(''),
      chapterTitle: chapter,
    });
  }

  if (rawDrafts.length === 0) return null;
  return validateDraftBatch(rawDrafts).drafts;
}

const ANSWER_KEY_HEADER_RE =
  /^(?:#{1,3}\s*)?[【\[]?(?:附\s*[:：]\s*)?(?:试卷|本卷|综合|教材|习题)?\s*(?:参考答案|标准答案|答案与解析|参考答案及解析)[】\]]?\s*[:：]?\s*$/;

/**
 * 识别文档后半段集中出现的“参考答案/标准答案”区块（供规则解析与 AI 分块回填答案使用）
 */
export function extractAnswerKeySection(rawText: string): {
  bodyText: string;
  answerKeyText: string;
} {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length < 8) {
    return { bodyText: normalized, answerKeyText: '' };
  }

  // 只从文档 30% 位置以后寻找独立答案区标题，避免误伤开篇书名/卷头或单题“答案：A”
  const minLineIndex = Math.floor(lines.length * 0.3);
  let splitIdx = -1;
  for (let i = minLineIndex; i < lines.length; i += 1) {
    if (ANSWER_KEY_HEADER_RE.test(lines[i].trim())) {
      splitIdx = i;
      break;
    }
  }

  if (splitIdx < 0) {
    return { bodyText: normalized, answerKeyText: '' };
  }

  const bodyText = lines.slice(0, splitIdx).join('\n').trim();
  const answerKeyText = lines.slice(splitIdx).join('\n').trim();
  return { bodyText, answerKeyText };
}

export interface StructuredAnswerKey {
  hasHierarchy: boolean;
  totalEntries: number;
  byChapterSectionNum: Map<string, string>;
  byChapterNum: Map<string, string>;
  bySectionNum: Map<string, string>;
  flat: Map<number, string>;
}

function cleanParsedAnswerValue(rawVal: string, sectionType: QuestionType | null): string {
  const stripped = rawVal
    .trim()
    .replace(/[,，;；|｜\s]+$/g, '')
    .replace(/^[（(\[【\s]+|[）)\]】\s]+$/g, '')
    .replace(/[,，;；|｜.\s]+$/g, '')
    .trim();

  if (!stripped) return '';

  if (sectionType === 'boolean') {
    const tok = stripped.replace(/^[（(\[【\s]+|[）)\]】\s.。、,，]+$/g, '').trim();
    if (normalizeBooleanToken(tok)) {
      return tok;
    }
  }

  if (sectionType === 'single' || sectionType === 'multiple') {
    if (/^[A-Ha-h\s,，、.。()（）]+$/.test(stripped)) {
      const letters = stripped.toUpperCase().match(/[A-H]/g);
      if (letters && letters.length > 0) {
        return sectionType === 'single' ? letters[0] : Array.from(new Set(letters)).join('');
      }
    }
  }

  return stripped;
}

/**
 * 解析文末参考答案区：同时支持「章节 -> 大题型 -> 重置题号」分层结构与传统扁平全局序号
 */
export function parseStructuredAnswerKey(answerKeyText: string): StructuredAnswerKey {
  const result: StructuredAnswerKey = {
    hasHierarchy: false,
    totalEntries: 0,
    byChapterSectionNum: new Map<string, string>(),
    byChapterNum: new Map<string, string>(),
    bySectionNum: new Map<string, string>(),
    flat: new Map<number, string>(),
  };
  if (!answerKeyText.trim()) return result;

  const lines = answerKeyText.replace(/\r\n/g, '\n').split('\n');
  let curChapterKey = '';
  let curCoreChapterKey = '';
  let curSectionType: QuestionType | null = null;

  const tokenRe =
    /(?:^|(?<=[\s,，;；|｜、)）]))(?:[（(]\s*(\d{1,4})\s*[)）]\s*[.、．:：]?|(?:第\s*)?(\d{1,4})\s*(?:题)?\s*[.、．:：)）])\s*/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || ANSWER_KEY_HEADER_RE.test(line)) {
      continue;
    }

    const sec = matchSectionTypeHeading(line);
    if (sec) {
      curSectionType = sec.type;
      result.hasHierarchy = true;
      continue;
    }

    const ch = matchChapterHeading(line);
    if (ch) {
      curChapterKey = normalizeChapterKey(ch);
      curCoreChapterKey = extractCoreChapterKey(ch);
      curSectionType = null;
      result.hasHierarchy = true;
      continue;
    }

    tokenRe.lastIndex = 0;
    const hits: Array<{ num: number; index: number; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = tokenRe.exec(line)) !== null) {
      const num = Number(m[1] || m[2]);
      if (num >= 1) {
        hits.push({ num, index: m.index, end: m.index + m[0].length });
      }
    }
    if (hits.length === 0) continue;

    for (let i = 0; i < hits.length; i += 1) {
      const num = hits[i].num;
      const valEnd = i + 1 < hits.length ? hits[i + 1].index : line.length;
      const ans = cleanParsedAnswerValue(line.slice(hits[i].end, valEnd), curSectionType);
      if (!ans) continue;

      result.totalEntries += 1;
      result.flat.set(num, ans);

      if (curChapterKey && curSectionType) {
        result.byChapterSectionNum.set(`${curChapterKey}::${curSectionType}::${num}`, ans);
        if (curCoreChapterKey && curCoreChapterKey !== curChapterKey) {
          result.byChapterSectionNum.set(`${curCoreChapterKey}::${curSectionType}::${num}`, ans);
        }
      }
      if (curChapterKey) {
        result.byChapterNum.set(`${curChapterKey}::${num}`, ans);
        if (curCoreChapterKey && curCoreChapterKey !== curChapterKey) {
          result.byChapterNum.set(`${curCoreChapterKey}::${num}`, ans);
        }
      }
      if (curSectionType) {
        result.bySectionNum.set(`${curSectionType}::${num}`, ans);
      }
    }
  }

  return result;
}

/**
 * 从文末集中参考答案区解析 题号(1-based) -> 答案 映射（兼容既有调用方）
 */
export function parseAnswerKeyMap(answerKeyText: string): Map<number, string> {
  return parseStructuredAnswerKey(answerKeyText).flat;
}

function lookupHierarchicalAnswer(
  answerKey: StructuredAnswerKey,
  chapterTitle: string,
  tentativeType: QuestionType | null,
  questionNum: number | null,
  sectionOrdinal: number,
  globalOrdinal: number
): string {
  const chKey = normalizeChapterKey(chapterTitle);
  const coreChKey = extractCoreChapterKey(chapterTitle);
  const candidateNums = questionNum !== null ? [questionNum] : [sectionOrdinal];

  if (chKey && tentativeType) {
    for (const num of candidateNums) {
      const hit =
        answerKey.byChapterSectionNum.get(`${chKey}::${tentativeType}::${num}`) ||
        answerKey.byChapterSectionNum.get(`${coreChKey}::${tentativeType}::${num}`);
      if (hit) return hit;
    }
  }

  if (chKey && answerKey.byChapterSectionNum.size === 0) {
    for (const num of candidateNums) {
      const hit =
        answerKey.byChapterNum.get(`${chKey}::${num}`) ||
        answerKey.byChapterNum.get(`${coreChKey}::${num}`);
      if (hit) return hit;
    }
  }

  if (
    tentativeType &&
    answerKey.byChapterSectionNum.size === 0 &&
    answerKey.byChapterNum.size === 0
  ) {
    for (const num of candidateNums) {
      const hit = answerKey.bySectionNum.get(`${tentativeType}::${num}`);
      if (hit) return hit;
    }
  }

  // 分层参考答案严禁跨章节借用错位全局序号
  if (!answerKey.hasHierarchy) {
    return (
      answerKey.flat.get(questionNum ?? globalOrdinal) ||
      answerKey.flat.get(globalOrdinal) ||
      ''
    );
  }

  return '';
}

export function parseStructuredText(rawText: string, defaultChapter = ''): ParsedQuestionDraft[] {
  // 优先检测 GIFT 格式
  const giftResult = tryParseGiftFormat(rawText, defaultChapter);
  if (giftResult && giftResult.length > 0) {
    return giftResult;
  }

  // 自动识别并剥离文末集中参考答案区，供无内联答案的试卷/教材自动回填
  const { bodyText, answerKeyText } = extractAnswerKeySection(rawText);
  const answerKey = parseStructuredAnswerKey(answerKeyText);

  const normalized = (answerKey.totalEntries > 0 && bodyText ? bodyText : rawText)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00A0/g, ' ');

  const lines = normalized.split('\n');
  let currentChapter = defaultChapter.trim();
  let currentSectionType: QuestionType | null = null;

  interface WorkingBlock {
    explicitType: QuestionType | null;
    questionNum: number | null;
    stemLines: string[];
    options: QuestionOption[];
    answer: string;
    explanationLines: string[];
    chapterTitle: string;
    difficulty: number;
    tags: string[];
    readingExplanation: boolean;
    inPostOptionsCode: boolean;
    inStemCode: boolean;
    sourceLine: number;
  }

  const blocks: WorkingBlock[] = [];
  let active: WorkingBlock | null = null;

  const flushActive = () => {
    if (active && active.stemLines.join('').trim()) {
      blocks.push(active);
    }
    active = null;
  };

  const typeTagPrefixRe =
    /^(?:[【\[（(]\s*(单选题|多选题|多项选择题|单项选择题|单选|多选|不定项|判断题|是非题|判断|填空题|填空|简答题|简答|问答|论述)\s*[】\]）)])\s*/;
  const answerLineRe =
    /^(?:[【\[]?\s*(?:参考|标准|正确)?\s*答案\s*[】\]]?|答|ANSWER)\s*[:：]\s*(.*)$/i;
  const answerBracketRe =
    /^[【\[]\s*(?:参考|标准|正确)?\s*答案\s*[】\]]\s*[:：]?\s*(.*)$/i;
  const explanationLineRe =
    /^(?:[【\[]?\s*(?:答案|试题|题目)?\s*(?:解析|详解|分析)\s*[】\]]?|解析|EXPLANATION)\s*[:：]\s*(.*)$/i;
  const difficultyLineRe = /^(?:[【\[]?\s*难度\s*[】\]]?)\s*[:：]?\s*(\d)/;
  const chapterMetaLineRe = /^(?:[【\[]?\s*(?:章节|模块|分类)\s*[】\]]?)\s*[:：]\s*(.+)$/;
  const tagsLineRe = /^(?:[【\[]?\s*(?:标签|考点)\s*[】\]]?)\s*[:：]\s*(.+)$/;

  const isMetadataLine = (l: string): boolean =>
    answerLineRe.test(l) ||
    answerBracketRe.test(l) ||
    explanationLineRe.test(l) ||
    difficultyLineRe.test(l) ||
    chapterMetaLineRe.test(l) ||
    tagsLineRe.test(l);

  const createWorkingBlock = (
    overrides: Partial<WorkingBlock> & { sourceLine: number; stemLines: string[] }
  ): WorkingBlock => ({
    explicitType: currentSectionType,
    questionNum: null,
    options: [],
    answer: '',
    explanationLines: [],
    chapterTitle: currentChapter,
    difficulty: 2,
    tags: [],
    readingExplanation: false,
    inPostOptionsCode: false,
    inStemCode: false,
    ...overrides,
  });

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const lineNumber = lineIdx + 1;
    const line = lines[lineIdx].trim();
    if (!line) {
      if (active?.readingExplanation) {
        active.readingExplanation = false;
      }
      continue;
    }

    // 1. 大题型分组标题（必须在题号匹配之前检查，防止 `1.判断题` / `2.单选题` 被当成题目）
    const secMatch = matchSectionTypeHeading(line);
    if (secMatch) {
      flushActive();
      currentSectionType = secMatch.type;
      continue;
    }

    // 2. 章节标题（如 `习题1` / `第一章 概述` / `# 标题`）
    const chMatch = matchChapterHeading(line);
    if (chMatch) {
      flushActive();
      currentChapter = chMatch;
      currentSectionType = null;
      continue;
    }

    // 3. 过滤文档首行总标题横幅（如 `教材习题及参考答案`，下一非空行为章节/题型/序号题时跳过）
    if (
      !active &&
      blocks.length === 0 &&
      !currentChapter &&
      !currentSectionType &&
      !typeTagPrefixRe.test(line) &&
      !matchQuestionStart(line) &&
      !isMetadataLine(line) &&
      !splitInlineOptions(line)
    ) {
      let nextNonEmpty = '';
      for (let k = lineIdx + 1; k < lines.length; k += 1) {
        const candidate = lines[k].trim();
        if (candidate) {
          nextNonEmpty = candidate;
          break;
        }
      }
      if (
        nextNonEmpty &&
        (matchChapterHeading(nextNonEmpty) ||
          matchSectionTypeHeading(nextNonEmpty) ||
          matchQuestionStart(nextNonEmpty))
      ) {
        continue;
      }
    }

    // Aiken 兼容性：如果当前题目已经填完 ANSWER 行且不在读取解析中，遇到非元数据、非选项的新文本行时自动开启下一道无序号题目
    if (
      active &&
      active.answer &&
      !active.readingExplanation &&
      !isMetadataLine(line) &&
      !splitInlineOptions(line)
    ) {
      flushActive();
    }

    // 4. 检测新题开始
    let workingLine = line;
    let prefixType: QuestionType | null = null;
    const tagMatch = workingLine.match(typeTagPrefixRe);
    if (tagMatch) {
      prefixType = detectTypeFromLabel(tagMatch[1]);
      workingLine = workingLine.slice(tagMatch[0].length).trim();
    }

    const qStartMatch = matchQuestionStart(workingLine);
    if (
      qStartMatch ||
      (tagMatch && workingLine.length > 0 && !answerLineRe.test(line) && !explanationLineRe.test(line))
    ) {
      let stemText = qStartMatch ? qStartMatch.rest : workingLine;
      const innerTagMatch = stemText.match(typeTagPrefixRe);
      if (!prefixType && innerTagMatch) {
        prefixType = detectTypeFromLabel(innerTagMatch[1]);
        stemText = stemText.slice(innerTagMatch[0].length).trim();
      }

      const inlineSplit = splitInlineOptions(stemText);
      let firstStem = stemText;
      let initialOpts: QuestionOption[] = [];
      if (inlineSplit && inlineSplit.length >= 2) {
        const firstOptIdx = stemText.search(/\s+[A-H]\s*[.、．:：)）]/);
        if (firstOptIdx > 0) {
          firstStem = stemText.slice(0, firstOptIdx).trim();
          initialOpts = inlineSplit;
        }
      }

      // 对连续重复粘贴的同题号同题干去重（不覆盖已采集的选项或答案）
      if (
        active &&
        qStartMatch &&
        active.options.length === 0 &&
        !active.answer &&
        active.questionNum === qStartMatch.num &&
        active.stemLines.length === 1 &&
        active.stemLines[0] === firstStem
      ) {
        continue;
      }

      flushActive();
      active = createWorkingBlock({
        explicitType: prefixType ?? currentSectionType,
        questionNum: qStartMatch ? qStartMatch.num : null,
        stemLines: [firstStem],
        options: initialOpts,
        inStemCode: isCodeLikeLine(firstStem),
        sourceLine: lineNumber,
      });
      continue;
    }

    if (!active) {
      if (!isMetadataLine(line) && !splitInlineOptions(line)) {
        active = createWorkingBlock({
          explicitType: prefixType ?? currentSectionType,
          stemLines: [workingLine],
          inStemCode: isCodeLikeLine(workingLine),
          sourceLine: lineNumber,
        });
      }
      continue;
    }

    // 5. 元数据行：答案 / 解析 / 难度 / 章节 / 标签
    const ansMatch = line.match(answerLineRe) || line.match(answerBracketRe);
    if (ansMatch) {
      active.readingExplanation = false;
      active.inPostOptionsCode = false;
      active.answer = ansMatch[1].trim();
      continue;
    }

    const expMatch = line.match(explanationLineRe);
    if (expMatch) {
      active.readingExplanation = true;
      active.inPostOptionsCode = false;
      if (expMatch[1].trim()) {
        active.explanationLines.push(expMatch[1].trim());
      }
      continue;
    }

    const diffMatch = line.match(difficultyLineRe);
    if (diffMatch) {
      active.difficulty = Number(diffMatch[1]) || 2;
      continue;
    }

    const chMetaMatch = line.match(chapterMetaLineRe);
    if (chMetaMatch) {
      active.chapterTitle = chMetaMatch[1].trim();
      continue;
    }

    const tagMetaMatch = line.match(tagsLineRe);
    if (tagMetaMatch) {
      active.tags = tagMetaMatch[1]
        .split(/[,，、;；\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      continue;
    }

    // 6. 选项之后附加的独立代码块（如题干先写 A~D 选项、末尾再附 class/import 代码块）：归入题干而非污染选项 D
    if (!active.readingExplanation && active.options.length >= 2) {
      if (active.inPostOptionsCode) {
        active.stemLines.push(line);
        continue;
      }
      const lastOpt = active.options[active.options.length - 1];
      if (TOP_LEVEL_CODE_START_RE.test(line) && !hasUnclosedBrace(lastOpt.content)) {
        active.inPostOptionsCode = true;
        active.stemLines.push(line);
        continue;
      }
    }

    // 7. 已集齐选项的选择题后紧跟漏写题号的新选择题题干时自动拆题
    if (
      !active.readingExplanation &&
      !active.inPostOptionsCode &&
      active.options.length >= 3 &&
      !hasUnclosedBrace(active.options[active.options.length - 1].content) &&
      !splitInlineOptions(line) &&
      !/^[①-⑳]/.test(line) &&
      !isCodeLikeLine(line) &&
      /(?:[（(]\s*[)）]\s*[。.?？]?$|[？?]$|(?:下列|以下|对于|用下列|关于).*(?:正确的是|错误的是|的是|说法|叙述|代码))/.test(
        line
      )
    ) {
      flushActive();
      active = createWorkingBlock({
        stemLines: [line],
        sourceLine: lineNumber,
      });
      continue;
    }

    // 8. 判断题分组内无序号连续命题按完整句自动拆题
    if (
      currentSectionType === 'boolean' &&
      active.explicitType === 'boolean' &&
      active.questionNum === null &&
      active.options.length === 0 &&
      !active.answer &&
      !active.readingExplanation &&
      !active.inStemCode
    ) {
      if (isCodeLikeLine(line)) {
        active.inStemCode = true;
        active.stemLines.push(line);
        continue;
      }
      const prevStemLine = active.stemLines[active.stemLines.length - 1] || '';
      if (/[。！？?!）)]$/.test(prevStemLine)) {
        flushActive();
        active = createWorkingBlock({
          stemLines: [line],
          sourceLine: lineNumber,
        });
        continue;
      }
    }

    // 9. 选项行
    if (!active.readingExplanation) {
      const opts = splitInlineOptions(line, active.options.length === 0);
      if (opts && opts.length > 0) {
        for (const opt of opts) {
          const existingIdx = active.options.findIndex((o) => o.key === opt.key);
          if (existingIdx >= 0) {
            active.options[existingIdx] = opt;
          } else {
            active.options.push(opt);
          }
        }
        continue;
      }
    }

    if (active.readingExplanation) {
      active.explanationLines.push(line);
    } else if (active.options.length > 0) {
      const last = active.options[active.options.length - 1];
      const useNewline =
        /[{;}]$/.test(last.content) || /^[{}①-⑳]/.test(line) || isCodeLikeLine(line);
      last.content = `${last.content}${useNewline ? '\n' : ' '}${line}`.trim();
    } else {
      if (isCodeLikeLine(line)) {
        active.inStemCode = true;
      }
      active.stemLines.push(line);
    }
  }

  flushActive();

  const lastNumByBucket = new Map<string, number>();

  const rawDrafts = blocks.map((b, idx) => {
    let stem = b.stemLines.join('\n').trim();
    let rawAnswer = b.answer.trim();

    if (!rawAnswer) {
      const inlineAnsRe = /[（(]\s*([A-H]{1,8}|对|错|正确|错误|√|✓|×|✗|X)\s*[)）]/;
      const m = stem.match(inlineAnsRe);
      if (m) {
        rawAnswer = m[1];
        stem = stem.replace(m[0], '（   ）');
      }
    }

    const tentativeType: QuestionType | null =
      b.explicitType ?? (b.options.length >= 2 ? 'single' : null);
    const bucketKey = `${normalizeChapterKey(b.chapterTitle)}::${tentativeType || 'unknown'}`;
    const sectionOrdinal = (lastNumByBucket.get(bucketKey) ?? 0) + 1;
    const effectiveNum = b.questionNum ?? sectionOrdinal;
    lastNumByBucket.set(bucketKey, effectiveNum);

    if (!rawAnswer && answerKey.totalEntries > 0) {
      rawAnswer = lookupHierarchicalAnswer(
        answerKey,
        b.chapterTitle,
        tentativeType,
        b.questionNum,
        sectionOrdinal,
        idx + 1
      );
    }

    const finalType = inferQuestionType(b.explicitType, stem, b.options, rawAnswer);
    return normalizeAndValidateDraft(
      {
        type: finalType,
        stem,
        options: b.options,
        answer: rawAnswer,
        explanation: b.explanationLines.join('\n'),
        chapterTitle: b.chapterTitle,
        difficulty: b.difficulty,
        tags: b.tags,
        sourceLine: b.sourceLine,
      },
      idx
    );
  });

  return validateDraftBatch(rawDrafts).drafts;
}

function normalizeHeaderName(key: string): string {
  return key.trim().toLowerCase().replace(/[\s_（）()【】\[\]]/g, '');
}

function getRowField(row: Record<string, unknown>, aliases: string[]): string {
  for (const [k, v] of Object.entries(row)) {
    const norm = normalizeHeaderName(k);
    if (aliases.includes(norm)) {
      return String(v ?? '').trim();
    }
  }
  return '';
}

export function parseTabularRecords(
  rows: Array<Record<string, unknown>>,
  defaultChapter = ''
): ParsedQuestionDraft[] {
  const optionAliases: Array<{ key: string; aliases: string[] }> = [
    { key: 'A', aliases: ['a', '选项a', 'optiona', '选项1'] },
    { key: 'B', aliases: ['b', '选项b', 'optionb', '选项2'] },
    { key: 'C', aliases: ['c', '选项c', 'optionc', '选项3'] },
    { key: 'D', aliases: ['d', '选项d', 'optiond', '选项4'] },
    { key: 'E', aliases: ['e', '选项e', 'optione', '选项5'] },
    { key: 'F', aliases: ['f', '选项f', 'optionf', '选项6'] },
    { key: 'G', aliases: ['g', '选项g', 'optiong', '选项7'] },
    { key: 'H', aliases: ['h', '选项h', 'optionh', '选项8'] },
  ];

  const rawDrafts: ParsedQuestionDraft[] = [];

  rows.forEach((row, idx) => {
    const stem = getRowField(row, ['题干', '题目', '问题', '内容', '试题内容', 'stem', 'question']);
    if (!stem) return;

    const rawType = getRowField(row, ['题型', '类型', '题目类型', '试题类型', 'type', 'questiontype']);
    const rawAnswer = getRowField(row, ['答案', '正确答案', '参考答案', '标准答案', 'answer']);
    const explanation = getRowField(row, [
      '解析',
      '答案解析',
      '试题解析',
      '详解',
      '分析',
      'explanation',
      'analysis',
    ]);
    const chapterTitle =
      getRowField(row, ['章节', '所属章节', '分类', '模块', 'chapter', 'chaptertitle']) ||
      defaultChapter;
    const rawDifficulty = getRowField(row, ['难度', '难易度', 'difficulty']);
    const rawTags = getRowField(row, ['标签', '考点', '知识点', 'tags']);

    let options: QuestionOption[] = [];
    for (const oa of optionAliases) {
      const val = getRowField(row, oa.aliases);
      if (val) {
        options.push({ key: oa.key, content: val.replace(/^[A-H][.、:：\s]+/, '').trim() });
      }
    }

    if (options.length === 0) {
      const combinedOptions = getRowField(row, ['选项', '候选选项', 'options']);
      if (combinedOptions) {
        const inline = splitInlineOptions(combinedOptions.replace(/\n+/g, ' '));
        if (inline) {
          options = inline;
        } else {
          options = combinedOptions
            .split(/[\n;；|]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((s, oIdx) => ({
              key: String.fromCharCode(65 + oIdx),
              content: s.replace(/^[A-H][.、:：\s]+/, '').trim(),
            }));
        }
      }
    }

    const explicitType = detectTypeFromLabel(rawType);
    const inferredType = inferQuestionType(explicitType, stem, options, rawAnswer);

    rawDrafts.push(
      normalizeAndValidateDraft(
        {
          type: inferredType,
          stem,
          options,
          answer: rawAnswer,
          explanation,
          chapterTitle,
          difficulty: Number(rawDifficulty) || 2,
          tags: rawTags
            ? rawTags
                .split(/[,，、;；\s]+/)
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
        },
        idx
      )
    );
  });

  return validateDraftBatch(rawDrafts).drafts;
}

export function parseSpreadsheetBuffer(
  buffer: Buffer,
  ext: string,
  defaultChapter = ''
): ParsedQuestionDraft[] {
  let workbook: xlsxNamespace.WorkBook;
  if (ext === '.csv') {
    const text = decodeBufferToText(buffer);
    workbook = XLSX.read(text, { type: 'string' });
  } else {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  }

  const allDrafts: ParsedQuestionDraft[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (rows.length === 0) continue;
    const sheetChapter =
      defaultChapter ||
      (workbook.SheetNames.length > 1 && !/^sheet\d+$/i.test(sheetName) ? sheetName : '');
    const parsed = parseTabularRecords(rows, sheetChapter);
    allDrafts.push(...parsed);
  }

  return validateDraftBatch(allDrafts).drafts;
}

export function parseJsonBuffer(buffer: Buffer, defaultChapter = ''): ParsedQuestionDraft[] {
  const raw = decodeBufferToText(buffer);
  const data = JSON.parse(raw) as unknown;
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { questions?: unknown[] })?.questions)
      ? (data as { questions: unknown[] }).questions
      : [];

  const rawDrafts = list
    .map((item, idx) => {
      const obj = item as Record<string, unknown>;
      const stem = String(obj.stem ?? obj.question ?? '').trim();
      if (!stem) return null;
      const options: QuestionOption[] = Array.isArray(obj.options)
        ? obj.options.map((opt, oIdx) => {
            if (typeof opt === 'string') {
              return { key: String.fromCharCode(65 + oIdx), content: opt };
            }
            const o = opt as Record<string, unknown>;
            return {
              key: String(o.key || String.fromCharCode(65 + oIdx)).toUpperCase(),
              content: String(o.content || o.text || ''),
            };
          })
        : [];
      const explicitType = detectTypeFromLabel(String(obj.type ?? obj.question_type ?? ''));
      const rawAns = Array.isArray(obj.answer)
        ? obj.answer.join('')
        : String(obj.answer ?? '');
      const inferredType = inferQuestionType(explicitType, stem, options, rawAns);
      return normalizeAndValidateDraft(
        {
          type: inferredType,
          stem,
          options,
          answer: rawAns,
          explanation: String(obj.explanation ?? obj.analysis ?? ''),
          chapterTitle: String(obj.chapterTitle ?? obj.chapter ?? defaultChapter),
          difficulty: Number(obj.difficulty ?? 2),
          tags: Array.isArray(obj.tags) ? obj.tags.map(String) : [],
        },
        idx
      );
    })
    .filter((d): d is ParsedQuestionDraft => Boolean(d));

  return validateDraftBatch(rawDrafts).drafts;
}

function decodeHtmlCellText(cellHtml: string): string {
  return cellHtml
    .replace(/<\/p>|<\/div>|<\/li>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * 解析 Word (.docx) 转换后的 HTML 表格（当 Word 题库采用与 Excel 类似的表头表格排版时自动识别）
 */
export function parseWordTablesFromHtml(html: string, defaultChapter = ''): ParsedQuestionDraft[] {
  if (!/<table[\s>]/i.test(html)) return [];

  const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  const allDrafts: ParsedQuestionDraft[] = [];
  let tm: RegExpExecArray | null;

  while ((tm = tableRegex.exec(html)) !== null) {
    const tableInner = tm[1];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const rawRows: string[][] = [];
    let rm: RegExpExecArray | null;

    while ((rm = rowRegex.exec(tableInner)) !== null) {
      const rowInner = rm[1];
      const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      const cells: string[] = [];
      let cm: RegExpExecArray | null;
      while ((cm = cellRegex.exec(rowInner)) !== null) {
        cells.push(decodeHtmlCellText(cm[1]));
      }
      if (cells.some((c) => c.length > 0)) {
        rawRows.push(cells);
      }
    }

    if (rawRows.length < 2) continue;

    // 寻找表头行（前 3 行内包含“题干/题目/问题/试题内容/stem/question”）
    const stemHeaders = ['题干', '题目', '问题', '内容', '试题内容', 'stem', 'question'];
    let headerIdx = -1;
    for (let r = 0; r < Math.min(3, rawRows.length - 1); r += 1) {
      const normalizedCells = rawRows[r].map((c) => normalizeHeaderName(c));
      if (normalizedCells.some((nc) => stemHeaders.includes(nc))) {
        headerIdx = r;
        break;
      }
    }
    if (headerIdx < 0) continue;

    const headers = rawRows[headerIdx];
    const records: Array<Record<string, unknown>> = [];
    for (let r = headerIdx + 1; r < rawRows.length; r += 1) {
      const rowCells = rawRows[r];
      const rec: Record<string, unknown> = {};
      for (let c = 0; c < headers.length; c += 1) {
        const key = headers[c] || `col_${c}`;
        rec[key] = rowCells[c] ?? '';
      }
      records.push(rec);
    }

    const parsed = parseTabularRecords(records, defaultChapter);
    if (parsed.length > 0) {
      allDrafts.push(...parsed);
    }
  }

  return allDrafts.length > 0 ? validateDraftBatch(allDrafts).drafts : [];
}

/**
 * 解析标准 Word (.docx) 文档：同时支持「Word 表格模式」与「Word 规范段落模式」
 */
export async function parseWordDocumentBuffer(
  buffer: Buffer,
  defaultChapter = ''
): Promise<{
  drafts: ParsedQuestionDraft[];
  rawText: string;
  sourceFormat: 'word-table' | 'word-paragraph';
}> {
  const [rawResult, htmlResult] = await Promise.all([
    mammothApi.extractRawText({ buffer }),
    typeof mammothApi.convertToHtml === 'function'
      ? mammothApi.convertToHtml({ buffer }).catch(() => ({ value: '' }))
      : Promise.resolve({ value: '' }),
  ]);

  const rawText = (rawResult.value || '').trim();
  const html = htmlResult.value || '';

  const tableDrafts = parseWordTablesFromHtml(html, defaultChapter);
  const paragraphDrafts = parseStructuredText(rawText, defaultChapter);

  if (tableDrafts.length > 0 && tableDrafts.length >= paragraphDrafts.length) {
    return {
      drafts: tableDrafts,
      rawText,
      sourceFormat: 'word-table',
    };
  }

  return {
    drafts: paragraphDrafts,
    rawText,
    sourceFormat: 'word-paragraph',
  };
}

export async function extractRawTextFromUpload(buffer: Buffer, filename: string): Promise<string> {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.docx')) {
    const result = await mammothApi.extractRawText({ buffer });
    return result.value || '';
  }
  if (lower.endsWith('.pdf')) {
    const result = await extractText(new Uint8Array(buffer), { mergePages: true });
    return Array.isArray(result.text) ? result.text.join('\n') : String(result.text ?? '');
  }
  return decodeBufferToText(buffer);
}

export type UploadedSourceFormat =
  | 'excel'
  | 'word-table'
  | 'word-paragraph'
  | 'json'
  | 'text';

export async function parseUploadedFile(
  buffer: Buffer,
  filename: string,
  defaultChapter = ''
): Promise<{
  drafts: ParsedQuestionDraft[];
  summary: ImportValidationSummary;
  canonicalText: string;
  rawTextPreview: string;
  isStructuredSource: boolean;
  sourceFormat: UploadedSourceFormat;
}> {
  const lower = filename.toLowerCase();
  let drafts: ParsedQuestionDraft[];
  let rawTextPreview: string;
  let isStructuredSource = false;
  let sourceFormat: UploadedSourceFormat = 'text';

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
    drafts = parseSpreadsheetBuffer(buffer, lower.slice(lower.lastIndexOf('.')), defaultChapter);
    rawTextPreview = formatDraftsToCanonicalText(drafts);
    isStructuredSource = true;
    sourceFormat = 'excel';
  } else if (lower.endsWith('.json')) {
    drafts = parseJsonBuffer(buffer, defaultChapter);
    rawTextPreview = formatDraftsToCanonicalText(drafts);
    isStructuredSource = true;
    sourceFormat = 'json';
  } else if (lower.endsWith('.docx')) {
    const wordRes = await parseWordDocumentBuffer(buffer, defaultChapter);
    drafts = wordRes.drafts;
    rawTextPreview = wordRes.rawText;
    isStructuredSource = wordRes.drafts.length > 0;
    sourceFormat = wordRes.sourceFormat;
  } else {
    const rawText = await extractRawTextFromUpload(buffer, filename);
    drafts = parseStructuredText(rawText, defaultChapter);
    rawTextPreview = rawText;
    sourceFormat = 'text';
  }

  const validated = validateDraftBatch(drafts);
  return {
    drafts: validated.drafts,
    summary: validated.summary,
    canonicalText: formatDraftsToCanonicalText(validated.drafts),
    rawTextPreview,
    isStructuredSource,
    sourceFormat,
  };
}

export function generateImportTemplateWorkbook(): Buffer {
  const rows = [
    {
      章节: '第一章 计算机基础',
      题型: '单选题',
      题干: '以下哪种 HTTP 状态码表示客户端请求的资源未找到？',
      选项A: '200',
      选项B: '301',
      选项C: '404',
      选项D: '500',
      选项E: '',
      选项F: '',
      正确答案: 'C',
      解析: '404 Not Found 表示服务器找不到请求的资源；200 表示成功，500 表示服务器内部错误。',
      难度: 1,
      标签: 'HTTP,基础',
    },
    {
      章节: '第一章 计算机基础',
      题型: '多选题',
      题干: '下列哪些属于常见的关系型数据库？',
      选项A: 'PostgreSQL',
      选项B: 'MySQL',
      选项C: 'Redis',
      选项D: 'Oracle',
      选项E: '',
      选项F: '',
      正确答案: 'ABD',
      解析: 'Redis 属于基于内存的键值型非关系型数据库（NoSQL）。',
      难度: 2,
      标签: '数据库',
    },
    {
      章节: '第二章 运维常识',
      题型: '判断题',
      题干: 'HTTPS 协议是在 HTTP 与 TCP 之间增加了 TLS/SSL 安全层以提供加密传输。',
      选项A: '正确',
      选项B: '错误',
      选项C: '',
      选项D: '',
      选项E: '',
      选项F: '',
      正确答案: '正确',
      解析: 'HTTPS = HTTP + TLS/SSL，可防窃听、防篡改并验证服务端身份。',
      难度: 1,
      标签: '网络安全',
    },
    {
      章节: '第二章 运维常识',
      题型: '填空题',
      题干: 'PostgreSQL 数据库默认监听的 TCP 端口是（____）。',
      选项A: '',
      选项B: '',
      选项C: '',
      选项D: '',
      选项E: '',
      选项F: '',
      正确答案: '5432',
      解析: 'PostgreSQL 默认端口为 5432，多空题答案请用竖线 | 分隔，如 80|443。',
      难度: 1,
      标签: 'PostgreSQL',
    },
    {
      章节: '第二章 运维常识',
      题型: '简答题',
      题干: '简述 Docker Compose 中 volumes 数据卷的作用。',
      选项A: '',
      选项B: '',
      选项C: '',
      选项D: '',
      选项E: '',
      选项F: '',
      正确答案: '实现容器数据持久化存储，容器重建或升级后数据库等重要数据不会丢失。',
      解析: '容器内部文件系统默认随容器销毁而消失，挂载卷可将数据保存在宿主机持久化存储中。',
      难度: 2,
      标签: 'Docker',
    },
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 18 },
    { wch: 10 },
    { wch: 44 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 20 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 44 },
    { wch: 8 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, '棱题标准导题模板');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const TYPE_LABEL_EXPORT: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  boolean: '判断题',
  fill: '填空题',
  short: '简答题',
};

export function exportQuestionsToWorkbook(
  questions: Array<{
    chapterTitle?: string;
    type: QuestionType;
    stem: string;
    options: QuestionOption[];
    answer: string;
    explanation: string;
    difficulty: number;
    tags: string[];
  }>,
  sheetName = '题库导出'
): Buffer {
  const rows = questions.map((q) => {
    const optMap = new Map(q.options.map((o) => [o.key.toUpperCase(), o.content]));
    const exportedAnswer =
      q.type === 'boolean' ? (q.answer === 'A' ? '正确' : q.answer === 'B' ? '错误' : q.answer) : q.answer;
    return {
      章节: q.chapterTitle || '',
      题型: TYPE_LABEL_EXPORT[q.type] || q.type,
      题干: q.stem,
      选项A: optMap.get('A') || '',
      选项B: optMap.get('B') || '',
      选项C: optMap.get('C') || '',
      选项D: optMap.get('D') || '',
      选项E: optMap.get('E') || '',
      选项F: optMap.get('F') || '',
      正确答案: exportedAnswer,
      解析: q.explanation || '',
      难度: q.difficulty || 2,
      标签: (q.tags || []).join(','),
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0
      ? rows
      : [
          {
            章节: '',
            题型: '单选题',
            题干: '',
            选项A: '',
            选项B: '',
            选项C: '',
            选项D: '',
            选项E: '',
            选项F: '',
            正确答案: '',
            解析: '',
            难度: 2,
            标签: '',
          },
        ]
  );
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 30) || '题库导出');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/* ==================== 标准 Word (.docx) 生成器（零外部依赖 OpenXML + ZIP） ==================== */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const uncompressed = entry.data;
    const compressed = zlib.deflateRawSync(uncompressed);
    const sum = crc32(uncompressed);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(sum, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(uncompressed.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(sum, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(uncompressed.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface DocxParagraphSpec {
  text: string;
  bold?: boolean;
  sizeHalfPt?: number;
  colorHex?: string;
}

export function buildDocxFromParagraphs(paragraphs: DocxParagraphSpec[]): Buffer {
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const bodyParagraphs = paragraphs
    .map((p) => {
      if (!p.text) {
        return '<w:p/>';
      }
      const rPrParts: string[] = [];
      if (p.bold) rPrParts.push('<w:b/>');
      if (p.sizeHalfPt) rPrParts.push(`<w:sz w:val="${p.sizeHalfPt}"/><w:szCs w:val="${p.sizeHalfPt}"/>`);
      if (p.colorHex) rPrParts.push(`<w:color w:val="${p.colorHex}"/>`);
      const rPr = rPrParts.length > 0 ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
      return `<w:p><w:r>${rPr}<w:t xml:space="preserve">${escapeXml(p.text)}</w:t></w:r></w:p>`;
    })
    .join('\n    ');

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyParagraphs}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  return createZipArchive([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypesXml, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(relsXml, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ]);
}

/**
 * 生成棱题 · PrismQ 标准 Word (.docx) 导题模板（涵盖单选、多选、判断、填空、简答 5 大题型与章节规范）
 */
export function generateImportTemplateDocx(): Buffer {
  const sampleQuestions: Array<{
    chapterTitle?: string;
    type: QuestionType;
    stem: string;
    options: QuestionOption[];
    answer: string;
    explanation: string;
    difficulty: number;
    tags: string[];
  }> = [
    {
      chapterTitle: '第一章 计算机基础',
      type: 'single',
      stem: '以下哪种 HTTP 状态码表示客户端请求的资源未找到？',
      options: [
        { key: 'A', content: '200' },
        { key: 'B', content: '301' },
        { key: 'C', content: '404' },
        { key: 'D', content: '500' },
      ],
      answer: 'C',
      explanation: '404 Not Found 表示服务器找不到请求的资源；200 表示成功，500 表示服务器内部错误。',
      difficulty: 1,
      tags: ['HTTP', '基础'],
    },
    {
      chapterTitle: '第一章 计算机基础',
      type: 'multiple',
      stem: '下列哪些属于常见的关系型数据库？',
      options: [
        { key: 'A', content: 'PostgreSQL' },
        { key: 'B', content: 'MySQL' },
        { key: 'C', content: 'Redis' },
        { key: 'D', content: 'Oracle' },
      ],
      answer: 'ABD',
      explanation: 'Redis 属于基于内存的键值型非关系型数据库（NoSQL）。',
      difficulty: 2,
      tags: ['数据库'],
    },
    {
      chapterTitle: '第二章 运维常识',
      type: 'boolean',
      stem: 'HTTPS 协议是在 HTTP 与 TCP 之间增加了 TLS/SSL 安全层以提供加密传输。',
      options: [
        { key: 'A', content: '正确' },
        { key: 'B', content: '错误' },
      ],
      answer: 'A',
      explanation: 'HTTPS = HTTP + TLS/SSL，可防窃听、防篡改并验证服务端身份。',
      difficulty: 1,
      tags: ['网络安全'],
    },
    {
      chapterTitle: '第二章 运维常识',
      type: 'fill',
      stem: 'PostgreSQL 数据库默认监听的 TCP 端口是（____）。',
      options: [],
      answer: '5432',
      explanation: 'PostgreSQL 默认端口为 5432，多空题答案请用竖线 | 分隔，如 80|443。',
      difficulty: 1,
      tags: ['PostgreSQL'],
    },
    {
      chapterTitle: '第二章 运维常识',
      type: 'short',
      stem: '简述 Docker Compose 中 volumes 数据卷的作用。',
      options: [],
      answer: '实现容器数据持久化存储，容器重建或升级后数据库等重要数据不会丢失。',
      explanation: '容器内部文件系统默认随容器销毁而消失，挂载卷可将数据保存在宿主机持久化存储中。',
      difficulty: 2,
      tags: ['Docker'],
    },
  ];

  return exportQuestionsToDocx(sampleQuestions);
}

/**
 * 将题库或试题列表导出为符合棱题 · PrismQ 规范的 Word (.docx) 文档（可直接在 Word 编辑，亦可原样重新导入）
 */
export function exportQuestionsToDocx(
  questions: Array<{
    chapterTitle?: string;
    type: QuestionType;
    stem: string;
    options: QuestionOption[];
    answer: string;
    explanation: string;
    difficulty: number;
    tags: string[];
  }>
): Buffer {
  const paragraphs: DocxParagraphSpec[] = [];
  let lastChapter = '';

  questions.forEach((q, idx) => {
    const ch = (q.chapterTitle || '').trim();
    if (ch && ch !== lastChapter) {
      if (paragraphs.length > 0) paragraphs.push({ text: '' });
      paragraphs.push({
        text: `# ${ch}`,
        bold: true,
        sizeHalfPt: 26,
        colorHex: '1E3A8A',
      });
      paragraphs.push({ text: '' });
      lastChapter = ch;
    }

    const typeLabel = TYPE_LABEL_EXPORT[q.type] || '单选题';
    paragraphs.push({
      text: `${idx + 1}. [${typeLabel}] ${q.stem}`,
      bold: true,
      sizeHalfPt: 22,
    });

    if (q.type === 'single' || q.type === 'multiple') {
      for (const opt of q.options) {
        paragraphs.push({
          text: `${opt.key}. ${opt.content}`,
          sizeHalfPt: 21,
        });
      }
    }

    const displayAns =
      q.type === 'boolean'
        ? q.answer === 'A' || q.answer === '正确'
          ? '正确'
          : '错误'
        : q.answer;
    paragraphs.push({
      text: `答案：${displayAns}`,
      bold: true,
      sizeHalfPt: 21,
      colorHex: '047857',
    });

    if (q.explanation) {
      paragraphs.push({
        text: `解析：${q.explanation}`,
        sizeHalfPt: 20,
        colorHex: '475569',
      });
    }

    if (q.difficulty && q.difficulty !== 2) {
      paragraphs.push({
        text: `难度：${q.difficulty}`,
        sizeHalfPt: 19,
        colorHex: '64748B',
      });
    }

    if (q.tags && q.tags.length > 0) {
      paragraphs.push({
        text: `标签：${q.tags.join(', ')}`,
        sizeHalfPt: 19,
        colorHex: '64748B',
      });
    }

    paragraphs.push({ text: '' });
  });

  if (paragraphs.length === 0) {
    paragraphs.push({ text: '1. [单选题] 示例题目题干', bold: true, sizeHalfPt: 22 });
    paragraphs.push({ text: 'A. 选项A', sizeHalfPt: 21 });
    paragraphs.push({ text: 'B. 选项B', sizeHalfPt: 21 });
    paragraphs.push({ text: '答案：A', bold: true, sizeHalfPt: 21 });
  }

  return buildDocxFromParagraphs(paragraphs);
}
