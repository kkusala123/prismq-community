import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Minus, Play, Plus, Shuffle, Sparkles } from 'lucide-react';
import {
  QUESTION_TYPE_LABELS,
  type BankStatsSummary,
  type ChapterItem,
  type ExamAssemblyStrategy,
  type QuestionBankSummary,
  type QuestionItem,
  type QuestionType,
} from '../../shared/types.js';
import { apiFetch } from '../lib/api';
import {
  Alert,
  Badge,
  Button,
  INPUT_CLS,
  LABEL_CLS,
  Modal,
  SELECT_CLS,
} from './ui';

const TYPE_ORDER: QuestionType[] = ['single', 'multiple', 'boolean', 'fill', 'short'];

const DEFAULT_SCORE_BY_TYPE: Record<QuestionType, number> = {
  single: 2,
  multiple: 4,
  boolean: 1,
  fill: 2,
  short: 5,
};

const STRATEGY_ITEMS: Array<{ value: ExamAssemblyStrategy; label: string }> = [
  { value: 'random', label: '全随机抽题' },
  { value: 'balanced', label: '难度均衡 3:5:2' },
  { value: 'easy_first', label: '基础巩固 6:3:1' },
  { value: 'hard_focus', label: '难题攻坚' },
  { value: 'high_star', label: '高星核心题' },
];

const DURATION_PRESETS = [15, 30, 45, 60, 120];

export interface SelfTestModalProps {
  open: boolean;
  onClose: () => void;
  initialBankId?: string;
  banks?: QuestionBankSummary[];
  lockedBank?: {
    id: string;
    title: string;
    chapters?: ChapterItem[];
    stats?: BankStatsSummary;
    questions?: QuestionItem[];
  };
}

function distributePresetCounts(
  target: number,
  avail: Record<QuestionType, number>
): Record<QuestionType, number> {
  const result: Record<QuestionType, number> = {
    single: 0,
    multiple: 0,
    boolean: 0,
    fill: 0,
    short: 0,
  };
  const totalAvail = TYPE_ORDER.reduce((sum, t) => sum + (avail[t] || 0), 0);
  if (totalAvail <= 0 || target <= 0) return result;
  const clampedTarget = Math.min(target, totalAvail);

  const weights: Record<QuestionType, number> = {
    single: 0.45,
    boolean: 0.25,
    multiple: 0.2,
    fill: 0.08,
    short: 0.02,
  };
  const activeTypes = TYPE_ORDER.filter((t) => (avail[t] || 0) > 0);
  const activeWeightSum = activeTypes.reduce((sum, t) => sum + weights[t], 0) || 1;

  let assigned = 0;
  for (const t of activeTypes) {
    const share = Math.round((clampedTarget * weights[t]) / activeWeightSum);
    const take = Math.min(avail[t], share);
    result[t] = take;
    assigned += take;
  }

  let rem = clampedTarget - assigned;
  while (rem > 0) {
    let progressed = false;
    for (const t of activeTypes) {
      if (rem <= 0) break;
      if (result[t] < avail[t]) {
        result[t] += 1;
        rem -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return result;
}

export const SelfTestModal: React.FC<SelfTestModalProps> = ({
  open,
  onClose,
  initialBankId = '',
  banks: propBanks,
  lockedBank,
}) => {
  const navigate = useNavigate();
  const [bankList, setBankList] = useState<QuestionBankSummary[]>(propBanks || []);
  const [selectedBankId, setSelectedBankId] = useState(
    lockedBank?.id || initialBankId || propBanks?.[0]?.id || ''
  );
  const [chapters, setChapters] = useState<ChapterItem[]>(lockedBank?.chapters || []);
  const [loadedQuestions, setLoadedQuestions] = useState<QuestionItem[]>(
    lockedBank?.questions || []
  );
  const [bankTitle, setBankTitle] = useState(lockedBank?.title || '');
  const [bankStats, setBankStats] = useState<BankStatsSummary | null>(lockedBank?.stats || null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [selectedChapters, setSelectedChapters] = useState<string[]>([]);
  const [counts, setCounts] = useState<Record<QuestionType, number>>({
    single: 10,
    multiple: 0,
    boolean: 5,
    fill: 0,
    short: 0,
  });
  const [useCustomScores, setUseCustomScores] = useState(false);
  const [questionScores, setQuestionScores] = useState<Record<QuestionType, number>>({
    ...DEFAULT_SCORE_BY_TYPE,
  });
  const [strategy, setStrategy] = useState<ExamAssemblyStrategy>('random');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [customTitle, setCustomTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrorMsg('');
    if (lockedBank) {
      setSelectedBankId(lockedBank.id);
      setBankTitle(lockedBank.title);
      setChapters(lockedBank.chapters || []);
      setLoadedQuestions(lockedBank.questions || []);
      setBankStats(lockedBank.stats || null);
      setSelectedChapters([]);
      return;
    }
    if (initialBankId) {
      setSelectedBankId(initialBankId);
    }
    if (propBanks && propBanks.length > 0) {
      setBankList(propBanks);
      if (!selectedBankId && !initialBankId) {
        setSelectedBankId(propBanks[0].id);
      }
      return;
    }
    void apiFetch<{ banks: QuestionBankSummary[] }>('/api/banks?scope=all')
      .then((res) => {
        setBankList(res.banks || []);
        if (!selectedBankId && !initialBankId && res.banks?.length) {
          setSelectedBankId(res.banks[0].id);
        }
      })
      .catch(() => {});
  }, [open, lockedBank, initialBankId, propBanks]);

  useEffect(() => {
    if (!open || lockedBank || !selectedBankId) return;
    let cancelled = false;
    setDetailLoading(true);
    setSelectedChapters([]);
    void apiFetch<{
      bank: { title: string };
      chapters: ChapterItem[];
      questions: QuestionItem[];
      stats?: BankStatsSummary;
    }>(`/api/banks/${selectedBankId}`)
      .then((res) => {
        if (cancelled) return;
        setBankTitle(res.bank?.title || '');
        setChapters(res.chapters || []);
        setLoadedQuestions(res.questions || []);
        setBankStats(res.stats || null);
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : '加载题库题目失败');
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, lockedBank, selectedBankId]);

  const availableCounts = useMemo<Record<QuestionType, number>>(() => {
    const out: Record<QuestionType, number> = {
      single: 0,
      multiple: 0,
      boolean: 0,
      fill: 0,
      short: 0,
    };
    if (selectedChapters.length === 0 && bankStats?.typeCounts) {
      for (const t of TYPE_ORDER) {
        out[t] = Number(bankStats.typeCounts[t] || 0);
      }
      return out;
    }
    const chapterSet = new Set(selectedChapters);
    for (const q of loadedQuestions) {
      if (chapterSet.size > 0 && (!q.chapterId || !chapterSet.has(q.chapterId))) continue;
      out[q.type] = (out[q.type] || 0) + 1;
    }
    return out;
  }, [bankStats, loadedQuestions, selectedChapters]);

  // 切换题库或章节后自动夹紧已选题数到当前可用上限，若全部为 0 则给一个合理默认预设
  useEffect(() => {
    if (!open) return;
    const totalAvail = TYPE_ORDER.reduce((sum, t) => sum + availableCounts[t], 0);
    if (totalAvail <= 0) {
      setCounts({ single: 0, multiple: 0, boolean: 0, fill: 0, short: 0 });
      return;
    }
    setCounts((prev) => {
      const clamped: Record<QuestionType, number> = {
        single: Math.min(prev.single, availableCounts.single),
        multiple: Math.min(prev.multiple, availableCounts.multiple),
        boolean: Math.min(prev.boolean, availableCounts.boolean),
        fill: Math.min(prev.fill, availableCounts.fill),
        short: Math.min(prev.short, availableCounts.short),
      };
      const curSum = TYPE_ORDER.reduce((s, t) => s + clamped[t], 0);
      return curSum > 0 ? clamped : distributePresetCounts(Math.min(20, totalAvail), availableCounts);
    });
  }, [open, availableCounts]);

  const totalPicked = TYPE_ORDER.reduce((sum, t) => sum + (counts[t] || 0), 0);
  const totalAvailAll = TYPE_ORDER.reduce((sum, t) => sum + (availableCounts[t] || 0), 0);

  const estimatedTotalScore = useMemo(() => {
    if (!useCustomScores) return 100;
    const sum = TYPE_ORDER.reduce(
      (acc, t) => acc + (counts[t] || 0) * Math.max(0.5, Number(questionScores[t]) || 1),
      0
    );
    return Number(sum.toFixed(1));
  }, [useCustomScores, counts, questionScores]);

  const updateTypeCount = (t: QuestionType, next: number) => {
    const max = availableCounts[t] || 0;
    const safe = Math.max(0, Math.min(max, Math.round(Number(next) || 0)));
    setCounts((prev) => ({ ...prev, [t]: safe }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBankId) {
      setErrorMsg('请先选择来源题库');
      return;
    }
    if (totalPicked <= 0) {
      setErrorMsg('请至少选择 1 道题目再生成自测试卷');
      return;
    }
    setErrorMsg('');
    setSubmitting(true);
    try {
      const nonZeroCounts: Partial<Record<QuestionType, number>> = {};
      for (const t of TYPE_ORDER) {
        if (counts[t] > 0) nonZeroCounts[t] = counts[t];
      }
      const res = await apiFetch<{ shareCode: string }>('/api/exams', {
        method: 'POST',
        json: {
          bankId: selectedBankId,
          title: customTitle.trim() || `${bankTitle || '题库'} 自由自测卷`,
          description: `自选题型组成：${TYPE_ORDER.filter((t) => counts[t] > 0)
            .map((t) => `${QUESTION_TYPE_LABELS[t]} ${counts[t]} 道`)
            .join('、')}`,
          examType: 'mock',
          counts: nonZeroCounts,
          totalQuestions: totalPicked,
          ...(selectedChapters.length > 0 ? { chapterIds: selectedChapters } : {}),
          strategy,
          durationMinutes,
          shuffleQuestions,
          shuffleOptions,
          strictAntiCheat: false,
          autoSubmitOnCheat: false,
          blockEmulator: false,
          maxTabSwitches: 99,
          maxAttempts: 99,
          ...(useCustomScores ? { questionScores } : {}),
        },
      });
      onClose();
      navigate(`/exam/join/${res.shareCode}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '生成自测试卷失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="自由自测组卷" size="xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        {errorMsg && <Alert tone="error">{errorMsg}</Alert>}

        {/* 题库选择 + 卷名 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS}>来源题库</label>
            {lockedBank ? (
              <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800">
                {lockedBank.title}（共 {totalAvailAll} 题）
              </div>
            ) : (
              <select
                value={selectedBankId}
                onChange={(e) => setSelectedBankId(e.target.value)}
                className={SELECT_CLS}
              >
                {bankList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title}（{b.questionCount} 题）
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className={LABEL_CLS}>自测卷标题（可选）</label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              placeholder={`${bankTitle || '我的题库'} 自由自测卷`}
              className={INPUT_CLS}
            />
          </div>
        </div>

        {/* 可选章节限定 */}
        {chapters.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">
                限定章节范围（不选则全库抽题）
              </label>
              {selectedChapters.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedChapters([])}
                  className="text-[11px] font-medium text-brand-600 hover:underline"
                >
                  重置为全部章节
                </button>
              )}
            </div>
            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/70 p-2">
              {chapters.map((ch) => {
                const active = selectedChapters.includes(ch.id);
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() =>
                      setSelectedChapters((prev) =>
                        prev.includes(ch.id) ? prev.filter((x) => x !== ch.id) : [...prev, ch.id]
                      )
                    }
                    className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                      active
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300'
                    }`}
                  >
                    {active && <Check className="h-3 w-3" />}
                    <span>{ch.title}</span>
                    <span className="opacity-75">({ch.questionCount})</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 按题型自选题量 */}
        <div className="space-y-2.5 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-brand-600" />
              <span className="text-xs font-bold text-slate-800">
                按题型自选出题数量（共可选 {totalAvailAll} 题）
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {[10, 20, 30].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={totalAvailAll <= 0}
                  onClick={() => setCounts(distributePresetCounts(preset, availableCounts))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-600 disabled:opacity-40"
                >
                  {preset} 题
                </button>
              ))}
              <button
                type="button"
                onClick={() =>
                  setCounts({ single: 0, multiple: 0, boolean: 0, fill: 0, short: 0 })
                }
                className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 transition hover:border-rose-300 hover:text-rose-600"
              >
                清零
              </button>
            </div>
          </div>

          {detailLoading ? (
            <div className="py-6 text-center text-xs text-slate-500">正在读取题库题型库存...</div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {TYPE_ORDER.map((t) => {
                const avail = availableCounts[t] || 0;
                const val = counts[t] || 0;
                return (
                  <div
                    key={t}
                    className={`flex flex-col justify-between rounded-lg border p-2.5 transition ${
                      val > 0
                        ? 'border-brand-400 bg-white shadow-sm'
                        : 'border-slate-200 bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex flex-wrap items-baseline gap-x-1.5">
                        <span className="text-xs font-bold text-slate-800 whitespace-nowrap">
                          {QUESTION_TYPE_LABELS[t]}
                        </span>
                        <span className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                          可用 {avail} 题
                        </span>
                      </div>
                      {avail > 0 && (
                        <button
                          type="button"
                          onClick={() => updateTypeCount(t, avail)}
                          className="shrink-0 whitespace-nowrap text-[10px] font-semibold text-brand-600 hover:underline"
                        >
                          全选
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={val <= 0}
                          onClick={() => updateTypeCount(t, val - 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number"
                          min={0}
                          max={avail}
                          disabled={avail <= 0}
                          value={val}
                          onChange={(e) => updateTypeCount(t, Number(e.target.value))}
                          className="h-7 w-14 rounded-md border border-slate-300 bg-white text-center text-xs font-bold text-slate-900 tabular-nums focus:border-brand-500 focus:outline-none disabled:bg-slate-100"
                        />
                        <button
                          type="button"
                          disabled={val >= avail}
                          onClick={() => updateTypeCount(t, val + 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {useCustomScores && (
                        <div className="flex items-center gap-1 text-[11px] text-slate-600">
                          <input
                            type="number"
                            min={0.5}
                            max={100}
                            step={0.5}
                            value={questionScores[t]}
                            onChange={(e) =>
                              setQuestionScores((prev) => ({
                                ...prev,
                                [t]: Math.max(0.5, Number(e.target.value) || 1),
                              }))
                            }
                            className="h-7 w-12 rounded-md border border-slate-300 bg-white px-1 text-center text-[11px] tabular-nums"
                          />
                          <span>分/题</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <label className="flex items-center gap-1.5 text-slate-600">
              <input
                type="checkbox"
                checked={useCustomScores}
                onChange={(e) => setUseCustomScores(e.target.checked)}
              />
              自定义各类题每题分值（默认按 100 分均分）
            </label>
            <div className="font-semibold text-brand-700 tabular-nums">
              已选 {totalPicked} 题 · 满分 {estimatedTotalScore} 分
            </div>
          </div>
        </div>

        {/* 抽题策略与时间设置 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS}>抽题倾向策略</label>
            <select
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as ExamAssemblyStrategy)}
              className={SELECT_CLS}
            >
              {STRATEGY_ITEMS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>限时设置（分钟）</label>
            <div className="flex flex-wrap items-center gap-1.5">
              {DURATION_PRESETS.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDurationMinutes(mins)}
                  className={`h-8 rounded-md border px-2.5 text-xs font-medium transition ${
                    durationMinutes === mins
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'
                  }`}
                >
                  {mins}m
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={300}
                value={durationMinutes}
                onChange={(e) =>
                  setDurationMinutes(Math.min(300, Math.max(1, Number(e.target.value) || 30)))
                }
                className="h-8 w-16 rounded-md border border-slate-300 px-2 text-center text-xs font-semibold tabular-nums"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={shuffleQuestions}
                onChange={(e) => setShuffleQuestions(e.target.checked)}
              />
              <Shuffle className="h-3.5 w-3.5" /> 题目顺序随机
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={shuffleOptions}
                onChange={(e) => setShuffleOptions(e.target.checked)}
              />
              选项顺序随机
            </label>
          </div>
          <Badge tone="success">自由自测 · 不限制切屏，交卷即出解析</Badge>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            loading={submitting}
            disabled={totalPicked <= 0}
            icon={<Play className="h-3.5 w-3.5" />}
          >
            生成试卷（{totalPicked} 题）并开始自测
          </Button>
        </div>
      </form>
    </Modal>
  );
};
