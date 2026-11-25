import React, { useEffect, useMemo, useState } from 'react';
import {
  Bookmark,
  CheckCircle2,
  XCircle,
  Sparkles,
  StickyNote,
  Scissors,
  RefreshCw,
  RotateCcw,
  Plus,
  Send,
  Star,
} from 'lucide-react';
import {
  DIFFICULTY_LABELS,
  QUESTION_TYPE_LABELS,
  type ParsedQuestionDraft,
  type QuestionItem,
  type QuestionOption,
} from '../../shared/types.js';
import { apiFetch } from '../lib/api';
import { Alert, Badge, Button, Card, INPUT_CLS, TEXTAREA_CLS } from './ui';

const renderDifficultyAndStarBadges = (q: QuestionItem) => {
  const diffTone = q.difficulty >= 4 ? 'danger' : q.difficulty <= 2 ? 'success' : 'neutral';
  const diffLabel = DIFFICULTY_LABELS[q.difficulty] || `难度${q.difficulty}`;
  return (
    <>
      <Badge tone={diffTone}>{diffLabel}</Badge>
      {(q.starRating ?? 0) > 0 && (
        <Badge tone="warning" className="gap-0.5 tabular-nums">
          <Star className="h-3 w-3 fill-current" />
          {q.starRating}星
        </Badge>
      )}
    </>
  );
};

export type QuestionFontSize = 'sm' | 'md' | 'lg';

interface QuestionCardProps {
  question: QuestionItem;
  index: number;
  total: number;
  reciteMode: boolean;
  shuffleOptions?: boolean;
  canSaveAiToQuestion?: boolean;
  fontSize?: QuestionFontSize;
  eyeCare?: boolean;
  onSubmitAnswer: (answer: string) => Promise<{
    isCorrect: boolean;
    standardAnswer: string;
    explanation: string;
    removedFromMistakeBook?: boolean;
    threshold?: number;
  }>;
  onToggleMaster?: () => Promise<void>;
  onToggleFavorite?: () => Promise<void>;
  onSaveNote?: (note: string) => Promise<void>;
  onImportSimilarToBank?: (draft: ParsedQuestionDraft) => Promise<void>;
}

const DISPLAY_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

const STEM_SIZE_CLASSES: Record<QuestionFontSize, string> = {
  sm: 'text-sm leading-relaxed sm:text-[15px]',
  md: 'text-base leading-relaxed sm:text-[17px]',
  lg: 'text-lg leading-relaxed sm:text-xl',
};

const OPT_SIZE_CLASSES: Record<QuestionFontSize, string> = {
  sm: 'text-xs leading-relaxed sm:text-sm',
  md: 'text-sm leading-relaxed sm:text-[15px]',
  lg: 'text-base leading-relaxed sm:text-[17px]',
};

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getRenderedOptions(
  question: QuestionItem,
  shuffleOptions: boolean
): Array<QuestionOption & { displayKey: string }> {
  const opts = question.options || [];
  if (!shuffleOptions || question.type === 'boolean' || opts.length <= 1) {
    return opts.map((o, i) => ({
      ...o,
      displayKey: o.key || DISPLAY_LETTERS[i] || String(i + 1),
    }));
  }
  const copy = [...opts];
  let state = hashSeed(question.id) || 1;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.map((o, i) => ({ ...o, displayKey: DISPLAY_LETTERS[i] || o.key }));
}

function formatQuestionDisplayAnswer(question: QuestionItem, ans: string): string {
  if (question.type === 'boolean') {
    return ans === 'A' ? '正确 (A)' : ans === 'B' ? '错误 (B)' : ans;
  }
  if (question.type === 'fill') {
    return ans.split('|').join('  |  ');
  }
  return ans;
}

function checkOptionCorrect(standardAnswer: string, optKey: string): boolean {
  const ans = (standardAnswer || '').toUpperCase();
  return ans.includes(optKey.toUpperCase());
}

function parseRecordedAnswer(
  question: QuestionItem,
  blankSlotCount: number
): {
  hasHistory: boolean;
  selectedKeys: string[];
  fillValues: string[];
  shortValue: string;
} {
  const rec = question.record;
  const hasHistory = Boolean(rec && rec.answeredCount > 0 && rec.lastIsCorrect !== null);
  if (!hasHistory) {
    return {
      hasHistory: false,
      selectedKeys: [],
      fillValues: Array.from({ length: blankSlotCount }, () => ''),
      shortValue: '',
    };
  }
  const raw = (rec?.lastAnswer ?? '').trim();
  if (question.type === 'fill') {
    const parts = raw ? raw.split('|') : [];
    const fillValues = Array.from({ length: blankSlotCount }, (_, idx) => parts[idx] ?? '');
    return { hasHistory: true, selectedKeys: [], fillValues, shortValue: '' };
  }
  if (question.type === 'short') {
    return {
      hasHistory: true,
      selectedKeys: [],
      fillValues: Array.from({ length: blankSlotCount }, () => ''),
      shortValue: raw,
    };
  }
  if (question.type === 'multiple') {
    const keys = Array.from(new Set(raw.toUpperCase().match(/[A-H]/g) || [])).sort();
    return {
      hasHistory: true,
      selectedKeys: keys,
      fillValues: Array.from({ length: blankSlotCount }, () => ''),
      shortValue: '',
    };
  }
  const letters = raw.toUpperCase().match(/[A-H]/g);
  const selectedKeys = letters && letters.length > 0 ? [letters[0]] : raw ? [raw.toUpperCase()] : [];
  return {
    hasHistory: true,
    selectedKeys,
    fillValues: Array.from({ length: blankSlotCount }, () => ''),
    shortValue: '',
  };
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  index,
  total,
  reciteMode,
  shuffleOptions = false,
  canSaveAiToQuestion = false,
  fontSize = 'md',
  eyeCare = false,
  onSubmitAnswer,
  onToggleMaster,
  onToggleFavorite,
  onSaveNote,
  onImportSimilarToBank,
}) => {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [fillValues, setFillValues] = useState<string[]>(['']);
  const [shortValue, setShortValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [historyRevealed, setHistoryRevealed] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [submittedResult, setSubmittedResult] = useState<{
    isCorrect: boolean;
    standardAnswer: string;
    explanation: string;
    removedFromMistakeBook?: boolean;
    threshold?: number;
  } | null>(null);

  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [noteText, setNoteText] = useState(question.record?.note || '');
  const [savingNote, setSavingNote] = useState(false);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiExplain, setAiExplain] = useState<{
    keyPoint: string;
    analysis: string;
    mnemonic: string;
  } | null>(null);
  const [aiError, setAiError] = useState('');
  const [savedToQuestionToast, setSavedToQuestionToast] = useState(false);

  const [similarLoading, setSimilarLoading] = useState(false);
  const [similarDraft, setSimilarDraft] = useState<ParsedQuestionDraft | null>(null);
  const [similarAnswer, setSimilarAnswer] = useState('');
  const [similarChecked, setSimilarChecked] = useState<boolean | null>(null);
  const [similarSaved, setSimilarSaved] = useState(false);

  const blankSlotCount = useMemo(() => {
    if (question.type !== 'fill') return 1;
    const ansSlots = question.answer ? question.answer.split('|').length : 1;
    return Math.max(1, ansSlots);
  }, [question.type, question.answer]);

  const renderedOptions: Array<QuestionOption & { displayKey: string }> = useMemo(
    () => getRenderedOptions(question, shuffleOptions),
    [question, shuffleOptions]
  );

  useEffect(() => {
    const parsed = parseRecordedAnswer(question, blankSlotCount);
    setSelectedKeys(parsed.selectedKeys);
    setFillValues(parsed.fillValues);
    setShortValue(parsed.shortValue);
    setHistoryRevealed(parsed.hasHistory);
    setSubmittedResult(null);
    setSubmitError('');
    setNoteText(question.record?.note || '');
    setShowNoteEditor(Boolean(question.record?.note));
    setAiExplain(null);
    setAiError('');
    setSavedToQuestionToast(false);
    setSimilarDraft(null);
    setSimilarAnswer('');
    setSimilarChecked(null);
    setSimilarSaved(false);
  }, [question.id, blankSlotCount]);

  const showReveal = reciteMode || submittedResult !== null || historyRevealed;
  const standardAnswer = submittedResult?.standardAnswer ?? question.answer;
  const explanationText = submittedResult?.explanation ?? question.explanation;

  const isOptionCorrect = (optKey: string) => checkOptionCorrect(standardAnswer, optKey);

  const handleRedo = () => {
    setSelectedKeys([]);
    setFillValues(Array.from({ length: blankSlotCount }, () => ''));
    setShortValue('');
    setSubmittedResult(null);
    setHistoryRevealed(false);
    setSubmitError('');
  };

  const handleSubmit = async (answerToSend: string) => {
    if (submitting || !answerToSend.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await onSubmitAnswer(answerToSend);
      setSubmittedResult(res);
      setHistoryRevealed(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '提交作答失败，请检查网络后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOptionClick = (optKey: string) => {
    if (showReveal || submitting) return;
    if (question.type === 'single' || question.type === 'boolean') {
      setSelectedKeys([optKey]);
      void handleSubmit(optKey);
    } else if (question.type === 'multiple') {
      setSelectedKeys((prev) =>
        prev.includes(optKey) ? prev.filter((k) => k !== optKey) : [...prev, optKey].sort()
      );
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (showReveal) return;

      const upper = e.key.toUpperCase();
      let targetIdx = -1;
      if (['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        targetIdx = Number(e.key) - 1;
      } else if (['A', 'B', 'C', 'D', 'E', 'F'].includes(upper)) {
        targetIdx = upper.charCodeAt(0) - 65;
      }
      if (targetIdx >= 0 && targetIdx < renderedOptions.length) {
        e.preventDefault();
        handleOptionClick(renderedOptions[targetIdx].key);
      } else if (e.key === 'Enter' && question.type === 'multiple' && selectedKeys.length > 0) {
        e.preventDefault();
        void handleSubmit(selectedKeys.join(''));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [renderedOptions, showReveal, question.type, selectedKeys]);

  const handleSaveNote = async () => {
    if (!onSaveNote) return;
    setSavingNote(true);
    try {
      await onSaveNote(noteText);
    } finally {
      setSavingNote(false);
    }
  };

  const handleAskAiExplain = async (saveToQuestion = false) => {
    setAiLoading(true);
    setAiError('');
    try {
      const userAns =
        question.type === 'fill'
          ? fillValues.join('|')
          : question.type === 'short'
            ? shortValue
            : selectedKeys.join('');
      const data = await apiFetch<{
        keyPoint: string;
        analysis: string;
        mnemonic: string;
      }>('/api/ai/explain', {
        method: 'POST',
        json: {
          questionId: question.id,
          userAnswer: userAns || undefined,
          saveToQuestion,
        },
      });
      setAiExplain(data);
      if (saveToQuestion) {
        setSavedToQuestionToast(true);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 讲题请求失败');
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerateSimilar = async () => {
    setSimilarLoading(true);
    setAiError('');
    setSimilarDraft(null);
    setSimilarAnswer('');
    setSimilarChecked(null);
    setSimilarSaved(false);
    try {
      const data = await apiFetch<{ draft: ParsedQuestionDraft }>('/api/ai/similar', {
        method: 'POST',
        json: { questionId: question.id },
      });
      setSimilarDraft(data.draft);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '生成举一反三题目失败');
    } finally {
      setSimilarLoading(false);
    }
  };

  const formatDisplayAnswer = (ans: string) => formatQuestionDisplayAnswer(question, ans);

  const isMulti = question.type === 'multiple';

  return (
    <Card
      padding="lg"
      className={eyeCare ? 'border-[#D9E5C9] bg-[#F7FAF2]' : 'border-[#EBEEF5] bg-white'}
    >
      {/* 顶部题目元信息与工具按钮（收藏 / 斩题 / 笔记） */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#F0F2F5] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-[#606266] tabular-nums">
            第 <strong className="text-brand-600">{index + 1}</strong> / {total} 题
          </span>
          {renderDifficultyAndStarBadges(question)}
          {question.chapterTitle && <Badge tone="neutral">{question.chapterTitle}</Badge>}
          {question.record &&
            question.record.answeredCount > 0 &&
            question.record.lastIsCorrect !== null && (
              <Badge tone={question.record.lastIsCorrect ? 'success' : 'danger'}>
                {question.record.lastIsCorrect ? '已答对' : '上次答错'}
              </Badge>
            )}
          {question.record?.inMistakeBook && (
            <Badge tone="danger">错题本 · 连对 {question.record.consecutiveCorrect} 次</Badge>
          )}
          {question.record?.isMastered && <Badge tone="success">已斩题</Badge>}
        </div>

        <div className="flex items-center gap-1">
          {onToggleFavorite && (
            <Button
              size="sm"
              variant={question.record?.isFavorited ? 'secondary' : 'ghost'}
              onClick={() => void onToggleFavorite()}
              title="收藏题目 (快捷键 S)"
              className={
                question.record?.isFavorited ? 'border-amber-300 bg-amber-50 text-amber-800' : ''
              }
              icon={<Bookmark className="h-3.5 w-3.5" />}
            >
              {question.record?.isFavorited ? '已收藏' : '收藏'}
            </Button>
          )}
          {onToggleMaster && (
            <Button
              size="sm"
              variant={question.record?.isMastered ? 'secondary' : 'ghost'}
              onClick={() => void onToggleMaster()}
              title="标记斩题（掌握后可过滤） (快捷键 K)"
              className={
                question.record?.isMastered ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : ''
              }
              icon={<Scissors className="h-3.5 w-3.5" />}
            >
              {question.record?.isMastered ? '已斩' : '斩题'}
            </Button>
          )}
          {onSaveNote && (
            <Button
              size="sm"
              variant={showNoteEditor || question.record?.note ? 'secondary' : 'ghost'}
              onClick={() => setShowNoteEditor((v) => !v)}
              className={
                showNoteEditor || question.record?.note
                  ? 'border-brand-200 bg-brand-50 text-brand-700'
                  : ''
              }
              icon={<StickyNote className="h-3.5 w-3.5" />}
            >
              笔记
            </Button>
          )}
        </div>
      </div>

      {/* 考试宝标志性：行内蓝底题型标签 + 题干文本 */}
      <div className={`mb-5 whitespace-pre-wrap font-medium text-[#303133] ${STEM_SIZE_CLASSES[fontSize]}`}>
        <span className="mr-2 inline-block -translate-y-0.5 rounded-[4px] bg-brand-600 px-2 py-0.5 align-middle text-xs font-semibold text-white">
          {QUESTION_TYPE_LABELS[question.type]}
        </span>
        <span className="align-middle">{question.stem}</span>
      </div>

      {/* 考试宝标志性：圆形单选 / 方角多选指示器 + A、选项正文 */}
      {renderedOptions.length > 0 && (
        <div className="space-y-2.5">
          {renderedOptions.map((opt) => {
            const isSelected = selectedKeys.includes(opt.key);
            const isCorrectOpt = isOptionCorrect(opt.key);

            let cardStyle = eyeCare
              ? 'border-[#DCE5CE] bg-white/80 text-[#303133] hover:border-brand-500 hover:bg-[#EBF5FF]/60'
              : 'border-[#E4E7ED] bg-white text-[#303133] hover:border-brand-400 hover:bg-[#F0F7FF]';
            let indicatorStyle = 'border-[#C0C4CC] bg-white text-[#606266]';

            if (showReveal) {
              if (isCorrectOpt) {
                cardStyle = 'border-emerald-500 bg-emerald-50/90 text-emerald-950';
                indicatorStyle = 'border-emerald-600 bg-emerald-600 text-white';
              } else if (isSelected && !isCorrectOpt) {
                cardStyle = 'border-rose-400 bg-rose-50/90 text-rose-950';
                indicatorStyle = 'border-rose-600 bg-rose-600 text-white';
              } else {
                cardStyle = eyeCare
                  ? 'border-[#DCE5CE] bg-white/50 text-[#909399]'
                  : 'border-[#EBEEF5] bg-[#FAFAFC] text-[#909399]';
              }
            } else if (isSelected) {
              cardStyle = 'border-brand-600 bg-brand-50/80 text-[#303133] ring-1 ring-brand-500';
              indicatorStyle = 'border-brand-600 bg-brand-600 text-white';
            }

            return (
              <button
                key={opt.key}
                type="button"
                disabled={showReveal || submitting}
                onClick={() => handleOptionClick(opt.key)}
                className={`flex min-h-[48px] w-full select-none items-start gap-3 rounded-lg border px-3.5 py-3 text-left transition active:scale-[0.99] sm:px-4 ${cardStyle}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-bold transition ${
                    isMulti ? 'rounded-[4px]' : 'rounded-full'
                  } ${indicatorStyle}`}
                >
                  {opt.displayKey}
                </span>
                <span className={`flex-1 ${OPT_SIZE_CLASSES[fontSize]}`}>
                  <span className="mr-1 font-semibold">{opt.displayKey}、</span>
                  {opt.content}
                </span>
                {showReveal && isCorrectOpt && (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                )}
                {showReveal && isSelected && !isCorrectOpt && (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                )}
              </button>
            );
          })}

          {isMulti && !showReveal && (
            <div className="border-t border-dashed border-[#DCDFE6] pt-4 text-center">
              <Button
                size="lg"
                disabled={selectedKeys.length === 0}
                loading={submitting}
                icon={!submitting ? <Send className="h-3.5 w-3.5" /> : undefined}
                onClick={() => void handleSubmit(selectedKeys.join(''))}
                className="w-full sm:w-auto sm:min-w-[180px]"
              >
                提交多选答案 ({selectedKeys.join('') || '未选'})
              </Button>
            </div>
          )}
        </div>
      )}

      {question.type === 'fill' && !reciteMode && (
        <div className="space-y-3">
          {fillValues.map((val, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-semibold text-[#606266]">
                第 {idx + 1} 空
              </span>
              <input
                type="text"
                disabled={showReveal}
                value={val}
                onChange={(e) => {
                  const next = [...fillValues];
                  next[idx] = e.target.value;
                  setFillValues(next);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !showReveal) {
                    void handleSubmit(fillValues.join('|'));
                  }
                }}
                placeholder={`请输入第 ${idx + 1} 空答案`}
                className={`${INPUT_CLS} flex-1`}
              />
            </div>
          ))}
          {!showReveal && (
            <div className="border-t border-dashed border-[#DCDFE6] pt-4 text-center">
              <Button
                size="lg"
                loading={submitting}
                disabled={fillValues.every((v) => !v.trim())}
                icon={!submitting ? <Send className="h-3.5 w-3.5" /> : undefined}
                onClick={() => void handleSubmit(fillValues.join('|'))}
                className="w-full sm:w-auto sm:min-w-[180px]"
              >
                提交填空答案
              </Button>
            </div>
          )}
        </div>
      )}

      {question.type === 'short' && !reciteMode && (
        <div className="space-y-3">
          <textarea
            rows={4}
            disabled={showReveal}
            value={shortValue}
            onChange={(e) => setShortValue(e.target.value)}
            placeholder="请输入你的作答思路或关键要点..."
            className={TEXTAREA_CLS}
          />
          {!showReveal && (
            <div className="border-t border-dashed border-[#DCDFE6] pt-4 text-center">
              <Button
                size="lg"
                loading={submitting}
                disabled={!shortValue.trim()}
                icon={!submitting ? <Send className="h-3.5 w-3.5" /> : undefined}
                onClick={() => void handleSubmit(shortValue)}
                className="w-full sm:w-auto sm:min-w-[180px]"
              >
                提交并核对参考答案
              </Button>
            </div>
          )}
        </div>
      )}

      {submitError && (
        <Alert tone="error" className="mt-4">
          {submitError}
        </Alert>
      )}

      {/* 答案与解析展开区 */}
      {showReveal && (
        <div
          className={`mt-6 space-y-4 rounded-lg border p-4 sm:p-5 ${
            eyeCare
              ? 'border-[#D9E5C9] bg-[#EEF4E5]'
              : 'border-[#E4E7ED] bg-[#F8FAFC]'
          }`}
        >
          {submittedResult ? (
            <Alert
              tone={submittedResult.isCorrect ? 'success' : 'error'}
              action={
                <div className="flex flex-wrap items-center gap-1.5">
                  {submittedResult.removedFromMistakeBook && (
                    <Badge tone="success">
                      已连对 {submittedResult.threshold} 次，自动移出错题本
                    </Badge>
                  )}
                  {!reciteMode && (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<RotateCcw className="h-3 w-3" />}
                      onClick={handleRedo}
                    >
                      重做本题
                    </Button>
                  )}
                </div>
              }
            >
              <span className="font-semibold">
                {submittedResult.isCorrect ? '回答正确！' : '回答错误，已自动收录至错题本'}
              </span>
            </Alert>
          ) : (
            historyRevealed &&
            question.record &&
            question.record.answeredCount > 0 &&
            question.record.lastIsCorrect !== null && (
              <Alert
                tone={question.record.lastIsCorrect ? 'success' : 'error'}
                action={
                  !reciteMode ? (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<RotateCcw className="h-3 w-3" />}
                      onClick={handleRedo}
                    >
                      重做本题
                    </Button>
                  ) : undefined
                }
              >
                <span className="font-semibold">
                  已作答记录：上次{question.record.lastIsCorrect ? '回答正确' : '回答错误'}
                  （累计作答 {question.record.answeredCount} 次）
                </span>
              </Alert>
            )
          )}

          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="rounded-[4px] bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
              参考答案
            </span>
            <span className="text-base font-bold text-emerald-700">
              {formatDisplayAnswer(standardAnswer)}
            </span>
          </div>

          <div>
            <div className="mb-1 text-xs font-bold text-[#606266]">试题解析</div>
            <p className={`whitespace-pre-wrap text-[#303133] ${OPT_SIZE_CLASSES[fontSize]}`}>
              {explanationText || '暂无文字解析，可点击下方「AI 深度讲题」自动生成深度剖析。'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-[#DCDFE6] pt-3">
            <Button
              size="sm"
              variant="ai"
              loading={aiLoading}
              icon={!aiLoading ? <Sparkles className="h-3.5 w-3.5" /> : undefined}
              onClick={() => void handleAskAiExplain(false)}
            >
              AI 深度讲题
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={similarLoading}
              icon={!similarLoading ? <RefreshCw className="h-3.5 w-3.5 text-indigo-600" /> : undefined}
              onClick={() => void handleGenerateSimilar()}
            >
              AI 举一反三（出变式题）
            </Button>
          </div>

          {aiError && <Alert tone="error">{aiError}</Alert>}

          {aiExplain && (
            <div className="space-y-2.5 rounded-lg border border-indigo-200 bg-indigo-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-900">
                  <Sparkles className="h-4 w-4" />
                  AI 深度剖析 · {aiExplain.keyPoint}
                </span>
                {canSaveAiToQuestion && (
                  <Button
                    size="sm"
                    variant="ai"
                    onClick={() => void handleAskAiExplain(true)}
                  >
                    {savedToQuestionToast ? '已写入本题解析' : '保存为本题解析'}
                  </Button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {aiExplain.analysis}
              </p>
              {aiExplain.mnemonic && (
                <div className="rounded-md border border-indigo-200 bg-white px-3 py-2 text-xs font-medium text-indigo-950">
                  记忆口诀：{aiExplain.mnemonic}
                </div>
              )}
            </div>
          )}

          {similarDraft && (
            <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-violet-900">
                  AI 举一反三 · 同考点变式题 ({QUESTION_TYPE_LABELS[similarDraft.type]})
                </span>
                {onImportSimilarToBank && (
                  <Button
                    size="sm"
                    variant="ai"
                    disabled={similarSaved}
                    icon={<Plus className="h-3.5 w-3.5" />}
                    onClick={async () => {
                      await onImportSimilarToBank(similarDraft);
                      setSimilarSaved(true);
                    }}
                  >
                    {similarSaved ? '已收入当前题库' : '收入当前题库'}
                  </Button>
                )}
              </div>

              <p className="text-sm font-medium text-slate-900">{similarDraft.stem}</p>

              {similarDraft.options.length > 0 && (
                <div className="space-y-1.5">
                  {similarDraft.options.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      onClick={() => {
                        setSimilarAnswer(opt.key);
                        setSimilarChecked(
                          opt.key.toUpperCase() === similarDraft.answer.toUpperCase()
                        );
                      }}
                      className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition ${
                        similarChecked !== null && opt.key === similarDraft.answer
                          ? 'border-emerald-500 bg-emerald-50 font-semibold text-emerald-900'
                          : similarAnswer === opt.key && similarChecked === false
                            ? 'border-rose-400 bg-rose-50 text-rose-900'
                            : 'border-violet-200 bg-white hover:bg-violet-50'
                      }`}
                    >
                      <span className="font-bold">{opt.key}.</span>
                      <span>{opt.content}</span>
                    </button>
                  ))}
                </div>
              )}

              {(similarChecked !== null || similarDraft.options.length === 0) && (
                <div className="rounded-md border border-violet-200 bg-white p-3 text-xs text-slate-700">
                  <div className="font-bold text-emerald-700">答案：{similarDraft.answer}</div>
                  {similarDraft.explanation && (
                    <div className="mt-1 leading-relaxed">{similarDraft.explanation}</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {showNoteEditor && onSaveNote && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold text-amber-900">我的备考笔记</span>
            <Button size="sm" loading={savingNote} onClick={() => void handleSaveNote()}>
              保存笔记
            </Button>
          </div>
          <textarea
            rows={2}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="记录易错细节、记忆技巧或补充资料..."
            className={TEXTAREA_CLS}
          />
        </div>
      )}
    </Card>
  );
};

interface QuestionPreviewCardProps {
  question: QuestionItem;
  index: number;
  total: number;
  reciteMode: boolean;
  shuffleOptions?: boolean;
  fontSize?: QuestionFontSize;
  eyeCare?: boolean;
  hasFavoriteAction?: boolean;
  hasMasterAction?: boolean;
  hasNoteAction?: boolean;
}

/**
 * 纯展示型题目预览卡片（用于三卡滑屏接力轨道中的上一题 / 下一题，无全局快捷键或状态副作用）。
 */
export const QuestionPreviewCard: React.FC<QuestionPreviewCardProps> = ({
  question,
  index,
  total,
  reciteMode,
  shuffleOptions = false,
  fontSize = 'md',
  eyeCare = false,
  hasFavoriteAction = true,
  hasMasterAction = true,
  hasNoteAction = true,
}) => {
  const renderedOptions = useMemo(
    () => getRenderedOptions(question, shuffleOptions),
    [question, shuffleOptions]
  );

  const blankSlotCount = useMemo(() => {
    if (question.type !== 'fill') return 1;
    const ansSlots = question.answer ? question.answer.split('|').length : 1;
    return Math.max(1, ansSlots);
  }, [question.type, question.answer]);

  const parsedPreview = useMemo(
    () => parseRecordedAnswer(question, blankSlotCount),
    [question, blankSlotCount]
  );
  const previewReveal = reciteMode || parsedPreview.hasHistory;

  const isMulti = question.type === 'multiple';
  const standardAnswer = question.answer;

  return (
    <Card
      padding="lg"
      className={eyeCare ? 'border-[#D9E5C9] bg-[#F7FAF2]' : 'border-[#E6E9EF] bg-white'}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#F0F2F5] pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-[#606266] tabular-nums">
            第 <strong className="text-brand-600">{index + 1}</strong> / {total} 题
          </span>
          {renderDifficultyAndStarBadges(question)}
          {question.chapterTitle && <Badge tone="neutral">{question.chapterTitle}</Badge>}
          {question.record &&
            question.record.answeredCount > 0 &&
            question.record.lastIsCorrect !== null && (
              <Badge tone={question.record.lastIsCorrect ? 'success' : 'danger'}>
                {question.record.lastIsCorrect ? '已答对' : '上次答错'}
              </Badge>
            )}
          {question.record?.inMistakeBook && (
            <Badge tone="danger">错题本 · 连对 {question.record.consecutiveCorrect} 次</Badge>
          )}
          {question.record?.isMastered && <Badge tone="success">已斩题</Badge>}
        </div>

        <div className="flex items-center gap-1">
          {hasFavoriteAction && (
            <Button
              size="sm"
              variant={question.record?.isFavorited ? 'secondary' : 'ghost'}
              tabIndex={-1}
              className={
                question.record?.isFavorited ? 'border-amber-300 bg-amber-50 text-amber-800' : ''
              }
              icon={<Bookmark className="h-3.5 w-3.5" />}
            >
              {question.record?.isFavorited ? '已收藏' : '收藏'}
            </Button>
          )}
          {hasMasterAction && (
            <Button
              size="sm"
              variant={question.record?.isMastered ? 'secondary' : 'ghost'}
              tabIndex={-1}
              className={
                question.record?.isMastered ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : ''
              }
              icon={<Scissors className="h-3.5 w-3.5" />}
            >
              {question.record?.isMastered ? '已斩' : '斩题'}
            </Button>
          )}
          {hasNoteAction && (
            <Button
              size="sm"
              variant={question.record?.note ? 'secondary' : 'ghost'}
              tabIndex={-1}
              className={
                question.record?.note ? 'border-brand-200 bg-brand-50 text-brand-700' : ''
              }
              icon={<StickyNote className="h-3.5 w-3.5" />}
            >
              笔记
            </Button>
          )}
        </div>
      </div>

      <div className={`mb-5 whitespace-pre-wrap font-medium text-[#1E293B] ${STEM_SIZE_CLASSES[fontSize]}`}>
        <span className="mr-2 inline-block -translate-y-0.5 rounded-[4px] bg-brand-600 px-2 py-0.5 align-middle text-xs font-semibold text-white">
          {QUESTION_TYPE_LABELS[question.type]}
        </span>
        <span className="align-middle">{question.stem}</span>
      </div>

      {renderedOptions.length > 0 && (
        <div className="space-y-2.5">
          {renderedOptions.map((opt) => {
            const isCorrectOpt = previewReveal && checkOptionCorrect(standardAnswer, opt.key);
            const isSelectedPreview =
              parsedPreview.hasHistory && parsedPreview.selectedKeys.includes(opt.key);
            let cardStyle = eyeCare
              ? 'border-[#DCE5CE] bg-white/80 text-[#303133]'
              : 'border-[#E4E7ED] bg-white text-[#303133]';
            let indicatorStyle = 'border-[#C0C4CC] bg-white text-[#606266]';

            if (previewReveal) {
              if (isCorrectOpt) {
                cardStyle = 'border-emerald-500 bg-emerald-50/90 text-emerald-950';
                indicatorStyle = 'border-emerald-600 bg-emerald-600 text-white';
              } else if (isSelectedPreview && !isCorrectOpt) {
                cardStyle = 'border-rose-400 bg-rose-50/90 text-rose-950';
                indicatorStyle = 'border-rose-600 bg-rose-600 text-white';
              } else {
                cardStyle = eyeCare
                  ? 'border-[#DCE5CE] bg-white/50 text-[#909399]'
                  : 'border-[#EBEEF5] bg-[#FAFAFC] text-[#909399]';
              }
            }

            return (
              <div
                key={opt.key}
                className={`flex min-h-[48px] w-full select-none items-start gap-3 rounded-lg border px-3.5 py-3 text-left sm:px-4 ${cardStyle}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border text-[11px] font-bold ${
                    isMulti ? 'rounded-[4px]' : 'rounded-full'
                  } ${indicatorStyle}`}
                >
                  {opt.displayKey}
                </span>
                <span className={`flex-1 ${OPT_SIZE_CLASSES[fontSize]}`}>
                  <span className="mr-1 font-semibold">{opt.displayKey}、</span>
                  {opt.content}
                </span>
                {isCorrectOpt && (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                )}
                {!isCorrectOpt && isSelectedPreview && (
                  <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
                )}
              </div>
            );
          })}

          {isMulti && !previewReveal && (
            <div className="border-t border-dashed border-[#DCDFE6] pt-4 text-center">
              <Button
                size="lg"
                disabled
                tabIndex={-1}
                icon={<Send className="h-3.5 w-3.5" />}
                className="w-full sm:w-auto sm:min-w-[180px]"
              >
                提交多选答案 (未选)
              </Button>
            </div>
          )}
        </div>
      )}

      {question.type === 'fill' && !previewReveal && (
        <div className="space-y-3">
          {Array.from({ length: blankSlotCount }).map((_, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-semibold text-[#606266]">
                第 {idx + 1} 空
              </span>
              <input
                type="text"
                readOnly
                tabIndex={-1}
                value=""
                placeholder={`请输入第 ${idx + 1} 空答案`}
                className={`${INPUT_CLS} flex-1`}
              />
            </div>
          ))}
          <div className="border-t border-dashed border-[#DCDFE6] pt-4 text-center">
            <Button
              size="lg"
              disabled
              tabIndex={-1}
              icon={<Send className="h-3.5 w-3.5" />}
              className="w-full sm:w-auto sm:min-w-[180px]"
            >
              提交填空答案
            </Button>
          </div>
        </div>
      )}

      {question.type === 'short' && !previewReveal && (
        <div className="space-y-3">
          <textarea
            rows={4}
            readOnly
            tabIndex={-1}
            value=""
            placeholder="请输入你的作答思路或关键要点..."
            className={TEXTAREA_CLS}
          />
          <div className="border-t border-dashed border-[#DCDFE6] pt-4 text-center">
            <Button
              size="lg"
              disabled
              tabIndex={-1}
              icon={<Send className="h-3.5 w-3.5" />}
              className="w-full sm:w-auto sm:min-w-[180px]"
            >
              提交并核对参考答案
            </Button>
          </div>
        </div>
      )}

      {previewReveal && (
        <div
          className={`mt-6 space-y-4 rounded-lg border p-4 sm:p-5 ${
            eyeCare ? 'border-[#D9E5C9] bg-[#EEF4E5]' : 'border-[#E4E7ED] bg-[#F8FAFC]'
          }`}
        >
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="rounded-[4px] bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
              参考答案
            </span>
            <span className="text-base font-bold text-emerald-700">
              {formatQuestionDisplayAnswer(question, standardAnswer)}
            </span>
          </div>
          <div>
            <div className="mb-1 text-xs font-bold text-[#606266]">试题解析</div>
            <p className={`whitespace-pre-wrap text-[#303133] ${OPT_SIZE_CLASSES[fontSize]}`}>
              {question.explanation || '暂无文字解析，可点击下方「AI 深度讲题」自动生成深度剖析。'}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};
