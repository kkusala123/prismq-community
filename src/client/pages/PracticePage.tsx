import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Grid,
  Shuffle,
  Scissors,
  Zap,
  X,
  Eye,
  Moon,
  Sun,
  SlidersHorizontal,
  Play,
} from 'lucide-react';
import {
  QUESTION_TYPE_LABELS,
  type ParsedQuestionDraft,
  type QuestionItem,
  type QuestionType,
} from '../../shared/types.js';
import { apiFetch, getAuthToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { QuestionCard, QuestionPreviewCard, type QuestionFontSize } from '../components/QuestionCard';
import { Badge, Button, Modal } from '../components/ui';

const TYPE_GROUP_ORDER: QuestionType[] = ['single', 'multiple', 'boolean', 'fill', 'short'];
const PRACTICE_PREFS_KEY = 'ksb_practice_prefs';
const SLIDE_GAP_PX = 16;

interface LocalPracticePrefs {
  fontSize?: QuestionFontSize;
  eyeCare?: boolean;
  autoNext?: boolean;
  autoNextDelayMs?: number;
  switchAnimationMs?: number;
}

function clampPref(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.round(Math.min(max, Math.max(min, num)));
}

function loadLocalPracticePrefs(): LocalPracticePrefs {
  try {
    const raw = localStorage.getItem(PRACTICE_PREFS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LocalPracticePrefs;
  } catch {
    return {};
  }
}

function saveLocalPracticePrefs(prefs: LocalPracticePrefs): void {
  try {
    localStorage.setItem(PRACTICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage errors
  }
}

const ANIMATION_SPEED_PRESETS = [
  { label: '关闭', ms: 0 },
  { label: '极速', ms: 150 },
  { label: '丝滑', ms: 260 },
  { label: '舒缓', ms: 420 },
];

const AUTO_NEXT_DELAY_PRESETS = [
  { label: '极快', ms: 250 },
  { label: '较快', ms: 450 },
  { label: '标准', ms: 650 },
  { label: '偏慢', ms: 1200 },
];

export const PracticePage: React.FC = () => {
  const { bankId = 'all' } = useParams<{ bankId: string }>();
  const [searchParams] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const { isDark, toggleDark } = useTheme();

  const mode = searchParams.get('mode') || 'sequential';
  const chapterId = searchParams.get('chapterId') || '';
  const type = searchParams.get('type') || '';
  const difficultyTier = searchParams.get('difficultyTier') || '';
  const minStar = searchParams.get('minStar') || '';

  const initialPrefs = useMemo(() => loadLocalPracticePrefs(), []);

  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [canEditBank, setCanEditBank] = useState(false);

  const [reciteMode, setReciteMode] = useState(searchParams.get('recite') === '1');
  const [shuffleOptions, setShuffleOptions] = useState(mode === 'random');
  const [excludeMastered, setExcludeMastered] = useState(mode === 'unmastered');
  const [onlyUnanswered, setOnlyUnanswered] = useState(
    mode === 'unanswered' || searchParams.get('onlyUnanswered') === '1'
  );
  const [autoNext, setAutoNext] = useState(
    user?.settings.autoNextOnCorrect ?? initialPrefs.autoNext ?? true
  );
  const [autoNextDelayMs, setAutoNextDelayMs] = useState(
    clampPref(user?.settings.autoNextDelayMs ?? initialPrefs.autoNextDelayMs, 150, 2500, 650)
  );
  const [switchAnimationMs, setSwitchAnimationMs] = useState(
    clampPref(user?.settings.switchAnimationMs ?? initialPrefs.switchAnimationMs, 0, 600, 260)
  );
  const [fontSize, setFontSize] = useState<QuestionFontSize>(initialPrefs.fontSize ?? 'md');
  const [eyeCare, setEyeCare] = useState(initialPrefs.eyeCare ?? false);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const [transitionDir, setTransitionDir] = useState<'next' | 'prev' | null>(null);
  const [transitionSeq, setTransitionSeq] = useState(0);
  const [trackOffsetX, setTrackOffsetX] = useState(0);
  const [trackAnimate, setTrackAnimate] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [overrideAdjacent, setOverrideAdjacent] = useState<{
    dir: 'prev' | 'next';
    index: number;
  } | null>(null);

  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;
  const autoNextTimerRef = useRef<number | null>(null);
  const slideTimerRef = useRef<number | null>(null);
  const pendingCommitRef = useRef<{ targetIndex: number } | null>(null);
  const settingsSyncTimerRef = useRef<number | null>(null);
  const progressSyncTimerRef = useRef<number | null>(null);
  const swipeStageRef = useRef<HTMLDivElement | null>(null);
  const touchStateRef = useRef<{
    x: number;
    y: number;
    startTime: number;
    lock: 'pending' | 'horizontal' | 'vertical';
  } | null>(null);

  const clearAutoNextTimer = () => {
    if (autoNextTimerRef.current !== null) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
  };

  const clearSlideTimer = () => {
    if (slideTimerRef.current !== null) {
      window.clearTimeout(slideTimerRef.current);
      slideTimerRef.current = null;
    }
  };

  const prefersReducedMotion = (): boolean =>
    typeof window !== 'undefined' &&
    Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  const commitPendingSlide = (): number | null => {
    const pending = pendingCommitRef.current;
    if (!pending) return null;
    pendingCommitRef.current = null;
    clearSlideTimer();
    currentIndexRef.current = pending.targetIndex;
    setTrackAnimate(false);
    setTrackOffsetX(0);
    setOverrideAdjacent(null);
    setCurrentIndex(pending.targetIndex);
    return pending.targetIndex;
  };

  useEffect(() => {
    if (!user) return;
    if (typeof user.settings.autoNextOnCorrect === 'boolean') {
      setAutoNext(user.settings.autoNextOnCorrect);
    }
    if (user.settings.autoNextDelayMs !== undefined) {
      setAutoNextDelayMs(clampPref(user.settings.autoNextDelayMs, 150, 2500, 650));
    }
    if (user.settings.switchAnimationMs !== undefined) {
      setSwitchAnimationMs(clampPref(user.settings.switchAnimationMs, 0, 600, 260));
    }
  }, [
    user?.id,
    user?.settings.autoNextOnCorrect,
    user?.settings.autoNextDelayMs,
    user?.settings.switchAnimationMs,
  ]);

  useEffect(() => {
    saveLocalPracticePrefs({
      fontSize,
      eyeCare,
      autoNext,
      autoNextDelayMs,
      switchAnimationMs,
    });
  }, [fontSize, eyeCare, autoNext, autoNextDelayMs, switchAnimationMs]);

  useEffect(() => {
    return () => {
      clearAutoNextTimer();
      clearSlideTimer();
      pendingCommitRef.current = null;
      if (settingsSyncTimerRef.current !== null) {
        window.clearTimeout(settingsSyncTimerRef.current);
      }
    };
  }, []);

  const scheduleServerSpeedSync = (patch: {
    autoNextOnCorrect?: boolean;
    autoNextDelayMs?: number;
    switchAnimationMs?: number;
  }) => {
    if (!user) return;
    if (settingsSyncTimerRef.current !== null) {
      window.clearTimeout(settingsSyncTimerRef.current);
    }
    settingsSyncTimerRef.current = window.setTimeout(() => {
      void apiFetch('/api/auth/settings', {
        method: 'PUT',
        json: patch,
      })
        .then(() => refreshUser())
        .catch(() => undefined);
    }, 450);
  };

  const navigateToQuestion = (targetIdx: number, explicitDir?: 'next' | 'prev') => {
    clearAutoNextTimer();
    const committed = commitPendingSlide();
    const prev = committed ?? currentIndexRef.current;
    const clamped = Math.max(0, Math.min(questions.length - 1, targetIdx));
    if (clamped === prev || questions.length === 0) return;

    const dir: 'next' | 'prev' = explicitDir ?? (clamped > prev ? 'next' : 'prev');
    const duration = prefersReducedMotion() ? 0 : switchAnimationMs;
    const stageWidth = swipeStageRef.current?.clientWidth || 0;

    if (window.scrollY > 80) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (duration <= 0 || stageWidth <= 0) {
      clearSlideTimer();
      pendingCommitRef.current = null;
      currentIndexRef.current = clamped;
      setTrackAnimate(false);
      setTrackOffsetX(0);
      setOverrideAdjacent(null);
      setCurrentIndex(clamped);
      return;
    }

    // 若跨越多个题号（例如答题卡跳转），将侧边接力卡片临时指向目标题目
    if (dir === 'next' && clamped !== prev + 1) {
      setOverrideAdjacent({ dir: 'next', index: clamped });
    } else if (dir === 'prev' && clamped !== prev - 1) {
      setOverrideAdjacent({ dir: 'prev', index: clamped });
    } else {
      setOverrideAdjacent(null);
    }

    const targetX = dir === 'next' ? -(stageWidth + SLIDE_GAP_PX) : stageWidth + SLIDE_GAP_PX;
    pendingCommitRef.current = { targetIndex: clamped };
    setTrackAnimate(true);
    setTrackOffsetX(targetX);

    clearSlideTimer();
    slideTimerRef.current = window.setTimeout(() => {
      commitPendingSlide();
    }, duration + 45);
  };

  const navigateBy = (delta: number) => {
    const baseIdx = commitPendingSlide() ?? currentIndexRef.current;
    navigateToQuestion(baseIdx + delta, delta >= 0 ? 'next' : 'prev');
  };

  const replayTransitionPreview = () => {
    setTransitionDir('next');
    setTransitionSeq((s) => s + 1);
  };

  const loadSession = async () => {
    clearAutoNextTimer();
    clearSlideTimer();
    pendingCommitRef.current = null;
    setTrackAnimate(false);
    setTrackOffsetX(0);
    setOverrideAdjacent(null);
    setLoading(true);
    try {
      const qs = new URLSearchParams({ bankId, mode });
      if (chapterId) qs.set('chapterId', chapterId);
      if (type) qs.set('type', type);
      if (difficultyTier) qs.set('difficultyTier', difficultyTier);
      if (minStar) qs.set('minStar', minStar);
      if (excludeMastered) qs.set('excludeMastered', 'true');
      if (onlyUnanswered) qs.set('onlyUnanswered', 'true');

      const res = await apiFetch<{
        questions: QuestionItem[];
        lastProgressIndex: number;
        nextUnansweredIndex?: number;
      }>(`/api/practice/session?${qs.toString()}`);

      setQuestions(res.questions);
      const startIdx =
        mode === 'sequential' && res.lastProgressIndex < res.questions.length
          ? res.lastProgressIndex
          : 0;
      currentIndexRef.current = startIdx;
      setCurrentIndex(startIdx);
      setTransitionDir(null);

      if (bankId && bankId !== 'all') {
        const bankDetail = await apiFetch<{ bank: { canEdit: boolean } }>(`/api/banks/${bankId}`);
        setCanEditBank(bankDetail.bank.canEdit);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSession();
  }, [bankId, mode, chapterId, type, difficultyTier, minStar, excludeMastered, onlyUnanswered]);

  const canSyncBankProgress =
    !loading &&
    questions.length > 0 &&
    bankId !== 'all' &&
    mode === 'sequential' &&
    !chapterId &&
    !type &&
    !difficultyTier &&
    !minStar &&
    !excludeMastered &&
    !onlyUnanswered;

  useEffect(() => {
    if (!canSyncBankProgress) return;
    if (progressSyncTimerRef.current !== null) {
      window.clearTimeout(progressSyncTimerRef.current);
    }
    progressSyncTimerRef.current = window.setTimeout(() => {
      void apiFetch('/api/practice/progress', {
        method: 'PUT',
        json: { bankId, currentIndex, mode },
      }).catch(() => undefined);
    }, 450);
    return () => {
      if (progressSyncTimerRef.current !== null) {
        window.clearTimeout(progressSyncTimerRef.current);
      }
    };
  }, [canSyncBankProgress, bankId, currentIndex, mode]);

  useEffect(() => {
    if (!canSyncBankProgress) return;
    const flushProgress = () => {
      const token = getAuthToken();
      if (!token) return;
      void fetch('/api/practice/progress', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ bankId, currentIndex: currentIndexRef.current, mode }),
        keepalive: true,
      }).catch(() => undefined);
    };
    window.addEventListener('pagehide', flushProgress);
    return () => {
      window.removeEventListener('pagehide', flushProgress);
      flushProgress();
    };
  }, [canSyncBankProgress, bankId, mode]);

  const currentQuestion = questions[currentIndex];

  const getAnswerCardCellClass = (q: QuestionItem, idx: number) => {
    const isCur = idx === currentIndex;
    const isCorrect = q.record?.lastIsCorrect === true;
    const isWrong = q.record?.lastIsCorrect === false;

    let cls = 'border-[#DCDFE6] bg-[#FAFAFC] text-[#606266] hover:border-brand-500 hover:bg-brand-50';
    if (isCorrect) {
      cls = 'border-emerald-400 bg-emerald-50 text-emerald-700 font-semibold';
    } else if (isWrong) {
      cls = 'border-rose-400 bg-rose-50 text-rose-700 font-semibold';
    }

    if (q.record?.isMastered) {
      cls += ' line-through opacity-75';
    }

    if (isCur) {
      if (!isCorrect && !isWrong) {
        cls = 'border-brand-600 bg-brand-600 text-white font-bold shadow-sm';
      } else {
        cls += ' ring-2 ring-brand-600 ring-offset-1 font-bold';
      }
    }

    return cls;
  };

  const sheetStats = useMemo(() => {
    const correct = questions.filter((q) => q.record?.lastIsCorrect === true).length;
    const wrong = questions.filter((q) => q.record?.lastIsCorrect === false).length;
    const done = correct + wrong;
    const todo = questions.length - done;
    const pct = questions.length > 0 ? Math.round((done / questions.length) * 100) : 0;
    return { correct, wrong, todo, done, pct };
  }, [questions]);

  // 考试宝风格按题型分组的答题卡索引
  const groupedSheetSections = useMemo(() => {
    const groups = new Map<QuestionType, Array<{ q: QuestionItem; idx: number }>>();
    questions.forEach((q, idx) => {
      const list = groups.get(q.type) || [];
      list.push({ q, idx });
      groups.set(q.type, list);
    });
    return TYPE_GROUP_ORDER.filter((t) => groups.has(t)).map((t) => ({
      type: t,
      label: QUESTION_TYPE_LABELS[t],
      items: groups.get(t)!,
    }));
  }, [questions]);

  // 键盘快捷键：左右切题、M 背题、S 收藏、K 斩题
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateBy(-1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateBy(1);
      } else if (e.key.toUpperCase() === 'M') {
        e.preventDefault();
        setReciteMode((v) => !v);
      } else if (e.key.toUpperCase() === 'S' && currentQuestion) {
        e.preventDefault();
        void handleToggle('favorite');
      } else if (e.key.toUpperCase() === 'K' && currentQuestion) {
        e.preventDefault();
        void handleToggle('master');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [questions.length, currentQuestion]);

  const handleSubmitAnswer = async (answer: string) => {
    const idx = currentIndexRef.current;
    const q = questions[idx];
    if (!q) {
      throw new Error('题目状态已变更，请刷新重试');
    }
    const res = await apiFetch<{
      isCorrect: boolean;
      standardAnswer: string;
      explanation: string;
      removedFromMistakeBook: boolean;
      threshold: number;
      record: QuestionItem['record'];
    }>('/api/practice/answer', {
      method: 'POST',
      json: {
        questionId: q.id,
        answer,
        currentIndex: idx,
        mode,
      },
    });

    setQuestions((prev) =>
      prev.map((item) => (item.id === q.id ? { ...item, record: res.record } : item))
    );

    if (res.isCorrect && autoNext && !reciteMode && idx < questions.length - 1) {
      clearAutoNextTimer();
      autoNextTimerRef.current = window.setTimeout(() => {
        autoNextTimerRef.current = null;
        if (currentIndexRef.current === idx && !reciteMode) {
          navigateBy(1);
        }
      }, autoNextDelayMs);
    }
    return res;
  };

  const firstUnansweredIndex = useMemo(
    () => questions.findIndex((q) => !q.record || q.record.answeredCount === 0),
    [questions]
  );

  const jumpToFirstUnanswered = (onDone?: () => void) => {
    if (firstUnansweredIndex >= 0) {
      navigateToQuestion(firstUnansweredIndex);
      onDone?.();
    }
  };

  const handleToggle = async (action: 'master' | 'favorite') => {
    if (!currentQuestion) return;
    const res = await apiFetch<{ isMastered: boolean; isFavorited: boolean }>(
      '/api/practice/toggle',
      {
        method: 'POST',
        json: { questionId: currentQuestion.id, action },
      }
    );
    setQuestions((prev) =>
      prev.map((item) =>
        item.id === currentQuestion.id
          ? {
              ...item,
              record: {
                answeredCount: item.record?.answeredCount ?? 0,
                correctCount: item.record?.correctCount ?? 0,
                wrongCount: item.record?.wrongCount ?? 0,
                consecutiveCorrect: item.record?.consecutiveCorrect ?? 0,
                inMistakeBook: item.record?.inMistakeBook ?? false,
                note: item.record?.note ?? '',
                lastAnswer: item.record?.lastAnswer ?? null,
                lastIsCorrect: item.record?.lastIsCorrect ?? null,
                isMastered: res.isMastered,
                isFavorited: res.isFavorited,
              },
            }
          : item
      )
    );
  };

  const handleSaveNote = async (note: string) => {
    if (!currentQuestion) return;
    await apiFetch('/api/practice/note', {
      method: 'PUT',
      json: { questionId: currentQuestion.id, note },
    });
    setQuestions((prev) =>
      prev.map((item) =>
        item.id === currentQuestion.id
          ? {
              ...item,
              record: {
                answeredCount: item.record?.answeredCount ?? 0,
                correctCount: item.record?.correctCount ?? 0,
                wrongCount: item.record?.wrongCount ?? 0,
                consecutiveCorrect: item.record?.consecutiveCorrect ?? 0,
                inMistakeBook: item.record?.inMistakeBook ?? false,
                isMastered: item.record?.isMastered ?? false,
                isFavorited: item.record?.isFavorited ?? false,
                lastAnswer: item.record?.lastAnswer ?? null,
                lastIsCorrect: item.record?.lastIsCorrect ?? null,
                note,
              },
            }
          : item
      )
    );
  };

  const handleImportSimilar = async (draft: ParsedQuestionDraft) => {
    if (!currentQuestion) return;
    await apiFetch(`/api/banks/${currentQuestion.bankId}/questions/batch`, {
      method: 'POST',
      json: { questions: [draft] },
    });
  };

  const shouldIgnoreSwipeTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return Boolean(target.closest('input, textarea, select, [data-no-swipe], pre'));
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (questions.length <= 1 || e.touches.length !== 1 || shouldIgnoreSwipeTarget(e.target)) {
      touchStateRef.current = null;
      return;
    }
    commitPendingSlide();
    clearSlideTimer();
    setTrackAnimate(false);
    setOverrideAdjacent(null);
    const t = e.touches[0];
    touchStateRef.current = {
      x: t.clientX,
      y: t.clientY,
      startTime: performance.now(),
      lock: 'pending',
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const state = touchStateRef.current;
    if (!state || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dx = t.clientX - state.x;
    const dy = t.clientY - state.y;

    if (state.lock === 'pending') {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.15) {
        state.lock = 'horizontal';
        setIsDragging(true);
        setTrackAnimate(false);
      } else {
        state.lock = 'vertical';
        return;
      }
    }

    if (state.lock !== 'horizontal') return;
    const atStart = currentIndexRef.current === 0 && dx > 0;
    const atEnd = currentIndexRef.current >= questions.length - 1 && dx < 0;
    setTrackOffsetX(atStart || atEnd ? dx * 0.24 : dx);
  };

  const finishTouch = (e: React.TouchEvent, cancelled: boolean) => {
    const state = touchStateRef.current;
    touchStateRef.current = null;
    setIsDragging(false);

    if (!state || state.lock !== 'horizontal' || cancelled || questions.length <= 1) {
      if (trackOffsetX !== 0) {
        setTrackAnimate(true);
        setTrackOffsetX(0);
      }
      return;
    }

    const endX = e.changedTouches[0]?.clientX ?? state.x;
    const dx = endX - state.x;
    const dt = Math.max(16, performance.now() - state.startTime);
    const vx = dx / dt;
    const stageWidth = swipeStageRef.current?.clientWidth || window.innerWidth || 375;
    const hitDistance = Math.abs(dx) > Math.min(80, stageWidth * 0.22);
    const hitVelocity = Math.abs(vx) > 0.45 && Math.abs(dx) > 28;

    if ((hitDistance || hitVelocity) && dx < 0 && currentIndexRef.current < questions.length - 1) {
      navigateToQuestion(currentIndexRef.current + 1, 'next');
      return;
    }
    if ((hitDistance || hitVelocity) && dx > 0 && currentIndexRef.current > 0) {
      navigateToQuestion(currentIndexRef.current - 1, 'prev');
      return;
    }

    // 未达到切换阈值：平滑回弹归位
    setTrackAnimate(true);
    setTrackOffsetX(0);
    clearSlideTimer();
    slideTimerRef.current = window.setTimeout(() => {
      setTrackAnimate(false);
    }, 240);
  };

  const renderGroupedAnswerGrid = (onSelectIdx?: () => void, colsClass = 'grid-cols-5') => (
    <div className="max-h-[58vh] space-y-3 overflow-y-auto pr-0.5">
      {groupedSheetSections.map((sec) => (
        <div key={sec.type}>
          <div className="mb-1 flex items-center justify-between px-1 text-xs font-semibold text-[#606266]">
            <span>{sec.label}</span>
            <span className="text-[11px] text-[#909399] tabular-nums">{sec.items.length} 题</span>
          </div>
          <div className={`grid ${colsClass} gap-2 p-1.5`}>
            {sec.items.map(({ q, idx }) => (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  navigateToQuestion(idx);
                  onSelectIdx?.();
                }}
                className={`relative flex h-9 items-center justify-center rounded-md border text-xs transition ${getAnswerCardCellClass(q, idx)}`}
              >
                {idx + 1}
                {q.record?.isFavorited && (
                  <span
                    title="已收藏"
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-amber-400"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F6F9] py-20 text-center text-sm text-[#606266]">
        正在加载题目队列...
      </div>
    );
  }

  const prevSlotIndex =
    overrideAdjacent?.dir === 'prev'
      ? overrideAdjacent.index
      : currentIndex > 0
        ? currentIndex - 1
        : null;
  const nextSlotIndex =
    overrideAdjacent?.dir === 'next'
      ? overrideAdjacent.index
      : currentIndex < questions.length - 1
        ? currentIndex + 1
        : null;
  const prevQuestionItem = prevSlotIndex !== null ? questions[prevSlotIndex] : null;
  const nextQuestionItem = nextSlotIndex !== null ? questions[nextSlotIndex] : null;
  const slideTransitionMs = isDragging ? 0 : switchAnimationMs > 0 ? switchAnimationMs : 220;

  return (
    <div className={`min-h-[100dvh] pb-24 lg:pb-12 transition-colors ${eyeCare ? 'bg-[#EDF3E4]' : 'bg-[#F7F8FA]'}`}>
      {/* 顶部沉浸式学习控制栏（手机端保持单行精简，完整调节项收纳至刷题设置抽屉） */}
      <header className="sticky top-0 z-20 border-b border-[#E4E7ED] bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-2 px-3 py-2 sm:px-6 sm:py-2.5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <Link
              to={bankId === 'all' ? '/mistakes' : `/banks/${bankId}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#DCDFE6] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#303133] transition hover:border-brand-400 hover:text-brand-600 sm:gap-1.5 sm:px-3"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              返回
            </Link>
            <span className="truncate text-sm font-bold text-[#303133]">
              <span className="sm:hidden">{reciteMode ? '背题' : '刷题'}</span>
              <span className="hidden sm:inline">{reciteMode ? '背题模式（答案直显）' : '在线刷题模式'}</span>
            </span>
            <Badge tone={reciteMode ? 'success' : 'brand'} className="shrink-0 tabular-nums">
              {questions.length > 0 ? `${currentIndex + 1} / ${questions.length}` : '0 题'}
            </Badge>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {/* 字号调节 */}
            <div className="hidden items-center overflow-hidden rounded-md border border-[#DCDFE6] bg-white md:inline-flex">
              {(['sm', 'md', 'lg'] as const).map((sz, i) => (
                <button
                  key={sz}
                  type="button"
                  onClick={() => setFontSize(sz)}
                  title={`字号：${sz === 'sm' ? '小' : sz === 'md' ? '中' : '大'}`}
                  className={`px-2 py-1 text-[11px] font-semibold transition ${
                    i > 0 ? 'border-l border-[#EBEEF5]' : ''
                  } ${
                    fontSize === sz
                      ? 'bg-brand-600 text-white'
                      : 'text-[#606266] hover:bg-[#F5F7FA]'
                  }`}
                >
                  {sz === 'sm' ? 'A-' : sz === 'md' ? 'A' : 'A+'}
                </button>
              ))}
            </div>

            {/* 护眼底色开关 */}
            <button
              type="button"
              onClick={() => setEyeCare((v) => !v)}
              className={`hidden items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition md:inline-flex ${
                eyeCare
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-[#DCDFE6] bg-white text-[#606266] hover:border-brand-400 hover:text-brand-600'
              }`}
            >
              <Eye className="h-3.5 w-3.5" />
              护眼
            </button>

            {/* 黑夜 / 日间模式切换 */}
            <button
              type="button"
              onClick={toggleDark}
              title={isDark ? '切换至浅色模式' : '切换至黑夜模式'}
              className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                isDark
                  ? 'border-amber-400/50 bg-amber-50 text-amber-600'
                  : 'border-[#DCDFE6] bg-white text-[#606266] hover:border-brand-400 hover:text-brand-600'
              }`}
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{isDark ? '浅色' : '黑夜'}</span>
            </button>

            <button
              type="button"
              onClick={() => setReciteMode((v) => !v)}
              title="快捷键 M"
              className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition md:inline-flex ${
                reciteMode
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-[#DCDFE6] bg-white text-[#303133] hover:border-brand-400 hover:text-brand-600'
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              {reciteMode ? '背题中' : '切背题'}
            </button>

            <button
              type="button"
              onClick={() => setShuffleOptions((v) => !v)}
              className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition lg:inline-flex ${
                shuffleOptions
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-[#DCDFE6] bg-white text-[#606266] hover:border-brand-400 hover:text-brand-600'
              }`}
            >
              <Shuffle className="h-3.5 w-3.5" />
              选项乱序
            </button>

            <button
              type="button"
              onClick={() => setExcludeMastered((v) => !v)}
              className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition lg:inline-flex ${
                excludeMastered
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-[#DCDFE6] bg-white text-[#606266] hover:border-brand-400 hover:text-brand-600'
              }`}
            >
              <Scissors className="h-3.5 w-3.5" />
              过滤已斩
            </button>

            <button
              type="button"
              onClick={() => setOnlyUnanswered((v) => !v)}
              className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition lg:inline-flex ${
                onlyUnanswered
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-[#DCDFE6] bg-white text-[#606266] hover:border-brand-400 hover:text-brand-600'
              }`}
            >
              仅看未做
            </button>

            <button
              type="button"
              onClick={() => {
                const next = !autoNext;
                setAutoNext(next);
                scheduleServerSpeedSync({ autoNextOnCorrect: next });
              }}
              className={`hidden items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition lg:inline-flex ${
                autoNext
                  ? 'border-brand-400 bg-brand-50 text-brand-700'
                  : 'border-[#DCDFE6] bg-white text-[#606266] hover:border-brand-400 hover:text-brand-600'
              }`}
            >
              <Zap className="h-3.5 w-3.5" />
              自动下一题 ({autoNextDelayMs}ms)
            </button>

            {/* 刷题与切题速度设置入口（全端可见） */}
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="inline-flex items-center gap-1 rounded-md border border-[#DCDFE6] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#303133] transition hover:border-brand-400 hover:text-brand-600"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-brand-600" />
              <span className="sm:hidden">设置</span>
              <span className="hidden sm:inline">刷题设置</span>
            </button>
          </div>
        </div>
      </header>

      {questions.length === 0 ? (
        <div className="mx-auto mt-16 max-w-md rounded-lg border border-dashed border-[#DCDFE6] bg-white p-8 text-center shadow-card">
          <p className="text-sm font-medium text-[#606266]">当前筛选模式下没有可练习的题目</p>
          <Link
            to={bankId === 'all' ? '/mistakes' : `/banks/${bankId}`}
            className="mt-4 inline-flex items-center justify-center rounded-md bg-brand-600 px-5 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
          >
            返回查看题库
          </Link>
        </div>
      ) : (
        <div className="mx-auto mt-4 grid max-w-[1200px] grid-cols-1 gap-5 px-3 sm:mt-5 sm:px-6 lg:grid-cols-4">
          {/* 左侧/主作答区（三卡接力滑屏：上一题 / 当前题 / 下一题无缝跟手切换） */}
          <div className="space-y-4 lg:col-span-3">
            <div className="-mx-1 overflow-hidden px-1 py-0.5">
              <div
                ref={swipeStageRef}
                className="ksb-swipe-stage relative"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={(e) => finishTouch(e, false)}
                onTouchCancel={(e) => finishTouch(e, true)}
              >
                <div
                  onTransitionEnd={(e) => {
                    if (e.target !== e.currentTarget || e.propertyName !== 'transform') return;
                    if (pendingCommitRef.current) {
                      commitPendingSlide();
                    } else {
                      setTrackAnimate(false);
                    }
                  }}
                  style={{
                    transform:
                      trackOffsetX !== 0 ? `translate3d(${trackOffsetX}px, 0, 0)` : 'translate3d(0, 0, 0)',
                    transition:
                      trackAnimate && slideTransitionMs > 0
                        ? `transform ${slideTransitionMs}ms cubic-bezier(0.22, 1, 0.36, 1)`
                        : 'none',
                    willChange: isDragging || trackAnimate ? 'transform' : undefined,
                  }}
                >
                  {/* 左侧接力卡片（上一题 / 向前跨题跳转目标） */}
                  {prevQuestionItem && prevSlotIndex !== null && (
                    <div
                      aria-hidden="true"
                      style={{ right: `calc(100% + ${SLIDE_GAP_PX}px)` }}
                      className="pointer-events-none absolute top-0 w-full select-none"
                    >
                      <QuestionPreviewCard
                        question={prevQuestionItem}
                        index={prevSlotIndex}
                        total={questions.length}
                        reciteMode={reciteMode}
                        shuffleOptions={shuffleOptions}
                        fontSize={fontSize}
                        eyeCare={eyeCare}
                      />
                    </div>
                  )}

                  {/* 中央当前活跃卡片 */}
                  <QuestionCard
                    question={currentQuestion}
                    index={currentIndex}
                    total={questions.length}
                    reciteMode={reciteMode}
                    shuffleOptions={shuffleOptions}
                    canSaveAiToQuestion={canEditBank}
                    fontSize={fontSize}
                    eyeCare={eyeCare}
                    onSubmitAnswer={handleSubmitAnswer}
                    onToggleMaster={() => handleToggle('master')}
                    onToggleFavorite={() => handleToggle('favorite')}
                    onSaveNote={handleSaveNote}
                    onImportSimilarToBank={canEditBank ? handleImportSimilar : undefined}
                  />

                  {/* 右侧接力卡片（下一题 / 向后跨题跳转目标） */}
                  {nextQuestionItem && nextSlotIndex !== null && (
                    <div
                      aria-hidden="true"
                      style={{ left: `calc(100% + ${SLIDE_GAP_PX}px)` }}
                      className="pointer-events-none absolute top-0 w-full select-none"
                    >
                      <QuestionPreviewCard
                        question={nextQuestionItem}
                        index={nextSlotIndex}
                        total={questions.length}
                        reciteMode={reciteMode}
                        shuffleOptions={shuffleOptions}
                        fontSize={fontSize}
                        eyeCare={eyeCare}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 桌面端上下题切题栏 */}
            <div className="hidden items-center justify-between gap-3 lg:flex">
              <Button
                variant="secondary"
                disabled={currentIndex === 0}
                onClick={() => navigateBy(-1)}
                icon={<ArrowLeft className="h-4 w-4" />}
              >
                上一题 (←)
              </Button>

              <span className="text-xs text-[#909399]">
                快捷键：A-D / 1-4 选答案 · ←/→ 切题 · M 切背题 · S 收藏 · K 斩题
              </span>

              <Button
                variant="primary"
                disabled={currentIndex >= questions.length - 1}
                onClick={() => navigateBy(1)}
              >
                下一题 (→)
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* 桌面右侧常驻答题卡（按题型分组 + 顶部作答进度条） */}
          <aside className="hidden rounded-lg border border-[#EBEEF5] bg-white p-4 shadow-card lg:sticky lg:top-[68px] lg:block lg:self-start">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <span className="text-sm font-bold text-[#303133]">答题卡</span>
              <div className="flex items-center gap-1.5">
                {firstUnansweredIndex >= 0 && (
                  <button
                    type="button"
                    onClick={() => jumpToFirstUnanswered()}
                    className="rounded-[4px] border border-brand-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-50"
                  >
                    跳至未做 #{firstUnansweredIndex + 1}
                  </button>
                )}
                <span className="rounded-[4px] bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 tabular-nums">
                  已做 {sheetStats.done} / {questions.length}
                </span>
              </div>
            </div>

            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-[#EBEEF5]">
              <div
                className="h-full rounded-full bg-brand-600 transition-all"
                style={{ width: `${sheetStats.pct}%` }}
              />
            </div>

            {renderGroupedAnswerGrid(undefined, 'grid-cols-5')}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#F0F2F5] pt-3 text-[11px] text-[#606266]">
              <span className="inline-flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-[2px] bg-brand-600" /> 当前
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-[2px] border border-emerald-400 bg-emerald-100" /> 对 {sheetStats.correct}
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-[2px] border border-rose-400 bg-rose-100" /> 错 {sheetStats.wrong}
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-[2px] border border-[#DCDFE6] bg-[#FAFAFC]" /> 未做 {sheetStats.todo}
              </span>
            </div>
          </aside>
        </div>
      )}

      {/* 移动端底部常驻精简切题栏（配合左右滑动手势） */}
      {questions.length > 0 && (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-2 border-t border-[#E4E7ED] bg-white/95 px-3 py-2 backdrop-blur-md lg:hidden">
          <Button
            variant="secondary"
            size="sm"
            disabled={currentIndex === 0}
            onClick={() => navigateBy(-1)}
            icon={<ArrowLeft className="h-3.5 w-3.5" />}
          >
            上一题
          </Button>

          <button
            type="button"
            onClick={() => setShowSheetModal(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#DCDFE6] bg-[#FAFAFC] px-3 text-xs font-semibold text-[#303133] tabular-nums"
          >
            <Grid className="h-3.5 w-3.5 text-brand-600" />
            {currentIndex + 1}/{questions.length}
          </button>

          <Button
            variant={reciteMode ? 'success' : 'secondary'}
            size="sm"
            onClick={() => setReciteMode((v) => !v)}
          >
            {reciteMode ? '背题中' : '背题'}
          </Button>

          <Button
            variant="primary"
            size="sm"
            disabled={currentIndex >= questions.length - 1}
            onClick={() => navigateBy(1)}
          >
            下一题
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* 刷题与切题速度设置抽屉（手机端底部抽屉 / 桌面居中弹窗） */}
      <Modal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        title="刷题与切题速度设置"
      >
        <div className="space-y-5">
          {/* 1. 切题动画速度 */}
          <div className="space-y-2.5 rounded-xl border border-[#EBEEF5] bg-[#FAFAFC] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-bold text-[#303133]">切题滑入动画速度</div>
                <p className="text-[11px] text-[#909399]">控制左右滑动与点击下一题的过渡时长</p>
              </div>
              <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700 tabular-nums">
                {switchAnimationMs === 0 ? '已关闭' : `${switchAnimationMs}ms`}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {ANIMATION_SPEED_PRESETS.map((preset) => (
                <button
                  key={preset.ms}
                  type="button"
                  onClick={() => {
                    setSwitchAnimationMs(preset.ms);
                    scheduleServerSpeedSync({ switchAnimationMs: preset.ms });
                    replayTransitionPreview();
                  }}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${
                    switchAnimationMs === preset.ms
                      ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                      : 'border-[#DCDFE6] bg-white text-[#606266] hover:border-brand-400'
                  }`}
                >
                  <div>{preset.label}</div>
                  <div className="text-[10px] opacity-80 tabular-nums">{preset.ms}ms</div>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <input
                type="range"
                min={0}
                max={600}
                step={20}
                value={switchAnimationMs}
                onChange={(e) => {
                  const val = clampPref(e.target.value, 0, 600, 260);
                  setSwitchAnimationMs(val);
                  scheduleServerSpeedSync({ switchAnimationMs: val });
                }}
                className="flex-1 accent-brand-600"
              />
              <Button
                variant="outline"
                size="sm"
                icon={<Play className="h-3 w-3" />}
                onClick={replayTransitionPreview}
              >
                试看
              </Button>
            </div>

            <div className="overflow-hidden rounded-lg border border-[#E4E7ED] bg-white p-2.5">
              <div
                key={`preview-${transitionSeq}`}
                style={{ '--ksb-switch-duration': `${switchAnimationMs}ms` } as React.CSSProperties}
                className={`flex items-center justify-between text-xs text-[#606266] ${
                  switchAnimationMs > 0 && transitionDir ? 'ksb-question-enter-next' : ''
                }`}
              >
                <span className="font-medium text-[#303133]">示例试题滑入效果预览</span>
                <span className="text-[11px] text-brand-600 tabular-nums">
                  {switchAnimationMs === 0 ? '无过渡动画' : `${switchAnimationMs}ms 滑入`}
                </span>
              </div>
            </div>
          </div>

          {/* 2. 答对自动切题速度 */}
          <div className="space-y-2.5 rounded-xl border border-[#EBEEF5] bg-[#FAFAFC] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-[#303133]">
                <input
                  type="checkbox"
                  checked={autoNext}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setAutoNext(next);
                    scheduleServerSpeedSync({ autoNextOnCorrect: next });
                  }}
                />
                答对后自动跳下一题
              </label>
              <span className="rounded bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700 tabular-nums">
                {autoNextDelayMs}ms
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {AUTO_NEXT_DELAY_PRESETS.map((preset) => (
                <button
                  key={preset.ms}
                  type="button"
                  disabled={!autoNext}
                  onClick={() => {
                    setAutoNextDelayMs(preset.ms);
                    scheduleServerSpeedSync({ autoNextDelayMs: preset.ms });
                  }}
                  className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition disabled:opacity-45 ${
                    autoNextDelayMs === preset.ms
                      ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                      : 'border-[#DCDFE6] bg-white text-[#606266] hover:border-brand-400'
                  }`}
                >
                  <div>{preset.label}</div>
                  <div className="text-[10px] opacity-80 tabular-nums">{preset.ms}ms</div>
                </button>
              ))}
            </div>

            <input
              type="range"
              min={150}
              max={2500}
              step={50}
              disabled={!autoNext}
              value={autoNextDelayMs}
              onChange={(e) => {
                const val = clampPref(e.target.value, 150, 2500, 650);
                setAutoNextDelayMs(val);
                scheduleServerSpeedSync({ autoNextDelayMs: val });
              }}
              className="w-full accent-brand-600 disabled:opacity-45"
            />
          </div>

          {/* 3. 字号与常用刷题开关 */}
          <div className="space-y-3 rounded-xl border border-[#EBEEF5] bg-[#FAFAFC] p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#303133]">题目字号大小</span>
              <div className="inline-flex overflow-hidden rounded-md border border-[#DCDFE6] bg-white">
                {(
                  [
                    { key: 'sm', label: 'A- 小' },
                    { key: 'md', label: 'A 中' },
                    { key: 'lg', label: 'A+ 大' },
                  ] as const
                ).map((item, i) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFontSize(item.key)}
                    className={`px-3 py-1.5 text-xs font-semibold transition ${
                      i > 0 ? 'border-l border-[#EBEEF5]' : ''
                    } ${
                      fontSize === item.key
                        ? 'bg-brand-600 text-white'
                        : 'text-[#606266] hover:bg-[#F5F7FA]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => setEyeCare((v) => !v)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  eyeCare
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                    : 'border-[#DCDFE6] bg-white text-[#606266]'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                护眼底色 {eyeCare ? '开' : '关'}
              </button>

              <button
                type="button"
                onClick={() => setShuffleOptions((v) => !v)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  shuffleOptions
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-[#DCDFE6] bg-white text-[#606266]'
                }`}
              >
                <Shuffle className="h-3.5 w-3.5" />
                选项乱序 {shuffleOptions ? '开' : '关'}
              </button>

              <button
                type="button"
                onClick={() => setExcludeMastered((v) => !v)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  excludeMastered
                    ? 'border-teal-500 bg-teal-50 text-teal-700'
                    : 'border-[#DCDFE6] bg-white text-[#606266]'
                }`}
              >
                <Scissors className="h-3.5 w-3.5" />
                过滤已斩 {excludeMastered ? '开' : '关'}
              </button>

              <button
                type="button"
                onClick={() => setOnlyUnanswered((v) => !v)}
                className={`flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                  onlyUnanswered
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-[#DCDFE6] bg-white text-[#606266]'
                }`}
              >
                仅看未做 {onlyUnanswered ? '开' : '关'}
              </button>
            </div>
          </div>
        </div>
      </Modal>

      {/* 移动端答题卡抽屉 */}
      {showSheetModal && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-900/50 lg:hidden">
          <div className="max-h-[78vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#303133]">答题卡</span>
                <span className="rounded-[4px] bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 tabular-nums">
                  {currentIndex + 1} / {questions.length}
                </span>
                {firstUnansweredIndex >= 0 && (
                  <button
                    type="button"
                    onClick={() => jumpToFirstUnanswered(() => setShowSheetModal(false))}
                    className="rounded-[4px] border border-brand-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-brand-600 transition hover:bg-brand-50"
                  >
                    跳至未做 #{firstUnansweredIndex + 1}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setShowSheetModal(false)}
                className="rounded-md p-1 text-[#606266] hover:bg-[#F5F7FA]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {renderGroupedAnswerGrid(() => setShowSheetModal(false), 'grid-cols-6')}

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#F0F2F5] pt-3 text-xs text-[#606266]">
              <span className="inline-flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-[2px] bg-brand-600" /> 当前
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-[2px] border border-emerald-400 bg-emerald-100" /> 对 {sheetStats.correct}
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-[2px] border border-rose-400 bg-rose-100" /> 错 {sheetStats.wrong}
              </span>
              <span className="inline-flex items-center gap-1">
                <i className="h-2.5 w-2.5 rounded-[2px] border border-[#DCDFE6] bg-[#FAFAFC]" /> 未做 {sheetStats.todo}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
