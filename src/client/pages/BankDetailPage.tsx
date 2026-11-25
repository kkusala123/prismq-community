import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Play,
  Shuffle,
  BookOpen,
  Scissors,
  AlertCircle,
  Download,
  Printer,
  FileUp,
  Plus,
  Edit3,
  Trash2,
  Globe,
  Lock,
  ClipboardCheck,
  Copy,
  Share2,
  UserPlus,
  UserMinus,
  KeyRound,
  RefreshCw,
  Check,
  ShieldCheck,
  LogOut,
  Sparkles,
  Star,
} from 'lucide-react';
import {
  DIFFICULTY_LABELS,
  DIFFICULTY_TIER_LABELS,
  QUESTION_TYPE_LABELS,
  sanitizeDisplayName,
  type BankShareSettings,
  type BankStatsSummary,
  type ChapterItem,
  type DifficultyTier,
  type QuestionItem,
  type QuestionOption,
  type QuestionType,
} from '../../shared/types.js';
import { apiFetch, downloadWithAuth } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PrintModal } from '../components/PrintModal';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLS,
  LABEL_CLS,
  Modal,
  PageHeader,
  SELECT_CLS,
  TEXTAREA_CLS,
} from '../components/ui';

async function copyTextSafe(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 回退至隐藏文本域复制（兼容内网 HTTP 环境）
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

interface BankDetailResponse {
  bank: {
    id: string;
    ownerId: string;
    ownerName: string;
    title: string;
    description: string;
    category: string;
    visibility: 'private' | 'public';
    cloneCount: number;
    canEdit: boolean;
    isSharedWithMe?: boolean;
    sharedUserCount?: number;
    shareEnabled?: boolean;
    shareCode?: string;
    hasSharePassword?: boolean;
    lastProgressIndex: number;
  };
  chapters: ChapterItem[];
  questions: QuestionItem[];
  stats?: BankStatsSummary;
}

export const BankDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [detail, setDetail] = useState<BankDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedChapter, setSelectedChapter] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedDifficultyTier, setSelectedDifficultyTier] = useState<DifficultyTier | ''>('');
  const [selectedMinStar, setSelectedMinStar] = useState<number>(0);
  const [keyword, setKeyword] = useState('');

  const [ratingLoading, setRatingLoading] = useState<string | null>(null);
  const [ratingProgress, setRatingProgress] = useState<{
    mode: 'unrated' | 'all';
    done: number;
    total: number;
  } | null>(null);
  const rateStopRef = useRef(false);
  const [ratingBanner, setRatingBanner] = useState<{
    tone: 'success' | 'error' | 'info';
    message: string;
  } | null>(null);

  const [newChapterName, setNewChapterName] = useState('');
  const [showPrint, setShowPrint] = useState(false);

  const [editingQ, setEditingQ] = useState<Partial<QuestionItem> | null>(null);
  const [savingQ, setSavingQ] = useState(false);

  // 私密分享弹窗状态
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareSettings, setShareSettings] = useState<BankShareSettings | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareSaving, setShareSaving] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const [sharePasswordInput, setSharePasswordInput] = useState('');
  const [inviteAccount, setInviteAccount] = useState('');
  const [inviting, setInviting] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState<'link' | 'code' | null>(null);

  const loadDetail = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (selectedChapter) qs.set('chapterId', selectedChapter);
      if (selectedType) qs.set('type', selectedType);
      if (selectedDifficultyTier) qs.set('difficultyTier', selectedDifficultyTier);
      if (selectedMinStar > 0) qs.set('minStar', String(selectedMinStar));
      if (keyword.trim()) qs.set('q', keyword.trim());
      const res = await apiFetch<BankDetailResponse>(`/api/banks/${id}?${qs.toString()}`);
      setDetail(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDetail();
  }, [id, selectedChapter, selectedType, selectedDifficultyTier, selectedMinStar]);

  const handleAiRateBank = async (opts: { onlyUnrated?: boolean; questionIds?: string[] }) => {
    if (!detail) return;
    const isSingle = Boolean(opts.questionIds?.length);
    const modeTag: 'unrated' | 'all' = opts.onlyUnrated === false ? 'all' : 'unrated';
    const tag = isSingle ? opts.questionIds![0] : modeTag;

    rateStopRef.current = false;
    setRatingLoading(tag);
    setRatingBanner(null);

    if (isSingle) {
      try {
        const res = await apiFetch<{
          ratedCount: number;
          remainingUnrated: number;
          modelUsed: string;
        }>('/api/ai/rate-bank', {
          method: 'POST',
          json: {
            bankId: detail.bank.id,
            onlyUnrated: false,
            questionIds: opts.questionIds,
          },
        });
        setRatingBanner({
          tone: 'success',
          message: `DeepSeek (${res.modelUsed}) 已完成单题智能评级。`,
        });
        void loadDetail();
      } catch (err) {
        setRatingBanner({
          tone: 'error',
          message: err instanceof Error ? err.message : 'DeepSeek 单题评级失败',
        });
      } finally {
        setRatingLoading(null);
      }
      return;
    }

    const totalTarget =
      modeTag === 'unrated'
        ? Math.max(unratedCount, 0)
        : detail.stats?.totalCount || detail.questions.length;
    const batchLimit = 20;
    let totalRated = 0;
    let offset = 0;
    let lastModel = '';
    let lastRemaining = 0;

    setRatingProgress({ mode: modeTag, done: 0, total: totalTarget });

    try {
      for (let round = 0; round < 50; round += 1) {
        if (rateStopRef.current) break;

        const res = await apiFetch<{
          ratedCount: number;
          processedCount?: number;
          remainingUnrated: number;
          modelUsed: string;
        }>('/api/ai/rate-bank', {
          method: 'POST',
          json: {
            bankId: detail.bank.id,
            onlyUnrated: modeTag === 'unrated',
            limit: batchLimit,
            ...(modeTag === 'all' ? { offset } : {}),
          },
        });

        totalRated += res.ratedCount;
        lastModel = res.modelUsed || lastModel;
        lastRemaining = res.remainingUnrated;

        setRatingProgress({
          mode: modeTag,
          done: modeTag === 'unrated' ? totalRated : Math.min(totalTarget, offset + (res.processedCount ?? res.ratedCount)),
          total: totalTarget,
        });

        void loadDetail();

        const scanned = res.processedCount ?? res.ratedCount;
        if (rateStopRef.current) break;
        if (res.ratedCount === 0 && scanned === 0) break;
        if (modeTag === 'unrated') {
          if (res.remainingUnrated === 0 || res.ratedCount === 0) break;
        } else {
          offset += scanned;
          if (scanned < batchLimit || offset >= totalTarget) break;
        }
      }

      if (rateStopRef.current) {
        setRatingBanner({
          tone: 'info',
          message: `已暂停评级（已成功保存 ${totalRated} 题，下次点击可从断点继续补评）。`,
        });
      } else if (totalRated === 0 && modeTag === 'unrated') {
        setRatingBanner({
          tone: 'info',
          message: '当前题库全部题目均已完成星级与难度评级。',
        });
      } else {
        setRatingBanner({
          tone: 'success',
          message: `DeepSeek${lastModel ? ` (${lastModel})` : ''} 已完成 ${totalRated} 题评级并全部保存${
            lastRemaining > 0 ? `，当前还剩 ${lastRemaining} 题未评` : '，题库已全部完成评级'
          }。`,
        });
      }
    } catch (err) {
      void loadDetail();
      const errMsg = err instanceof Error ? err.message : 'DeepSeek 智能评级失败';
      setRatingBanner({
        tone: 'error',
        message:
          totalRated > 0
            ? `已完成并保存 ${totalRated} 题，本轮中断：${errMsg}`
            : errMsg,
      });
    } finally {
      setRatingLoading(null);
      setRatingProgress(null);
    }
  };

  const handleToggleVisibility = async () => {
    if (!detail) return;
    const nextVis = detail.bank.visibility === 'public' ? 'private' : 'public';
    await apiFetch(`/api/banks/${detail.bank.id}`, {
      method: 'PUT',
      json: { visibility: nextVis },
    });
    void loadDetail();
  };

  const handleClone = async () => {
    if (!detail) return;
    const res = await apiFetch<{ id: string }>(`/api/banks/${detail.bank.id}/clone`, {
      method: 'POST',
    });
    navigate(`/banks/${res.id}`);
  };

  const openShareModal = async () => {
    if (!detail) return;
    setShowShareModal(true);
    setShareLoading(true);
    setShareError('');
    setShareNotice('');
    setSharePasswordInput('');
    try {
      const res = await apiFetch<BankShareSettings>(`/api/banks/${detail.bank.id}/shares`);
      setShareSettings(res);
    } catch (err) {
      setShareError(err instanceof Error ? err.message : '加载私密分享设置失败');
    } finally {
      setShareLoading(false);
    }
  };

  const handleUpdateShareSettings = async (patch: {
    shareEnabled?: boolean;
    resetCode?: boolean;
    sharePassword?: string;
    clearPassword?: boolean;
  }) => {
    if (!detail) return;
    setShareSaving(true);
    setShareError('');
    setShareNotice('');
    try {
      const res = await apiFetch<BankShareSettings>(
        `/api/banks/${detail.bank.id}/share-settings`,
        {
          method: 'PUT',
          json: patch,
        }
      );
      setShareSettings(res);
      if (patch.sharePassword !== undefined || patch.clearPassword) {
        setSharePasswordInput('');
      }
      setShareNotice(
        patch.resetCode
          ? '已生成新的私密分享码（旧分享码即时失效）。'
          : patch.clearPassword
            ? '已清除访问口令。'
            : patch.sharePassword !== undefined
              ? '私密访问口令已保存。'
              : res.shareEnabled
                ? '已开启私密分享链接（题库仍保持私有，不会出现在公共广场）。'
                : '已关闭私密分享链接（已定向授权的用户仍受列表单独控制）。'
      );
      void loadDetail();
    } catch (err) {
      setShareError(err instanceof Error ? err.message : '更新私密分享设置失败');
    } finally {
      setShareSaving(false);
    }
  };

  const handleAddShareMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !inviteAccount.trim()) return;
    setInviting(true);
    setShareError('');
    setShareNotice('');
    try {
      const res = await apiFetch<{ members: BankShareSettings['members'] }>(
        `/api/banks/${detail.bank.id}/shares`,
        {
          method: 'POST',
          json: { account: inviteAccount.trim() },
        }
      );
      setShareSettings((prev) => (prev ? { ...prev, members: res.members } : prev));
      setInviteAccount('');
      setShareNotice('已授权该用户访问当前私有题库。');
      void loadDetail();
    } catch (err) {
      setShareError(err instanceof Error ? err.message : '添加分享成员失败');
    } finally {
      setInviting(false);
    }
  };

  const handleRemoveShareMember = async (targetUserId: string) => {
    if (!detail) return;
    setShareError('');
    setShareNotice('');
    try {
      const res = await apiFetch<{ ok: boolean; members: BankShareSettings['members'] }>(
        `/api/banks/${detail.bank.id}/shares/${targetUserId}`,
        { method: 'DELETE' }
      );
      setShareSettings((prev) => (prev ? { ...prev, members: res.members } : prev));
      setShareNotice('已撤销该用户的访问权限。');
      void loadDetail();
    } catch (err) {
      setShareError(err instanceof Error ? err.message : '移除授权失败');
    }
  };

  const handleLeaveSharedBank = async () => {
    if (!detail || !user) return;
    if (!window.confirm(`确定退出私密分享题库「${detail.bank.title}」吗？退出后需重新获取分享才可查看。`)) {
      return;
    }
    await apiFetch(`/api/banks/${detail.bank.id}/shares/${user.id}`, { method: 'DELETE' });
    navigate('/banks?scope=shared');
  };

  const handleAddChapter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !newChapterName.trim()) return;
    await apiFetch(`/api/banks/${detail.bank.id}/chapters`, {
      method: 'POST',
      json: { title: newChapterName.trim() },
    });
    setNewChapterName('');
    void loadDetail();
  };

  const handleDeleteChapter = async (chapterId: string) => {
    if (!detail) return;
    if (!window.confirm('删除章节不会删除题目（题目会归为未分章），确认删除？')) return;
    await apiFetch(`/api/banks/${detail.bank.id}/chapters/${chapterId}`, { method: 'DELETE' });
    if (selectedChapter === chapterId) setSelectedChapter('');
    void loadDetail();
  };

  const openNewQuestionModal = () => {
    setEditingQ({
      type: 'single',
      stem: '',
      chapterId: selectedChapter && selectedChapter !== 'none' ? selectedChapter : null,
      options: [
        { key: 'A', content: '' },
        { key: 'B', content: '' },
        { key: 'C', content: '' },
        { key: 'D', content: '' },
      ],
      answer: 'A',
      explanation: '',
      difficulty: 2,
      starRating: 0,
      tags: [],
    });
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!detail || !editingQ?.stem?.trim()) return;
    setSavingQ(true);
    try {
      const payload = {
        type: editingQ.type || 'single',
        stem: editingQ.stem,
        chapterId: editingQ.chapterId || null,
        options: editingQ.options || [],
        answer: editingQ.answer || '',
        explanation: editingQ.explanation || '',
        difficulty: editingQ.difficulty || 2,
        starRating: editingQ.starRating ?? 0,
        tags: editingQ.tags || [],
      };
      if (editingQ.id) {
        await apiFetch(`/api/banks/${detail.bank.id}/questions/${editingQ.id}`, {
          method: 'PUT',
          json: payload,
        });
      } else {
        await apiFetch(`/api/banks/${detail.bank.id}/questions`, {
          method: 'POST',
          json: payload,
        });
      }
      setEditingQ(null);
      void loadDetail();
    } finally {
      setSavingQ(false);
    }
  };

  const handleDeleteQuestion = async (qid: string) => {
    if (!detail) return;
    if (!window.confirm('确定删除这道题目吗？')) return;
    await apiFetch(`/api/banks/${detail.bank.id}/questions/${qid}`, { method: 'DELETE' });
    void loadDetail();
  };

  if (loading && !detail) {
    return <div className="py-16 text-center text-sm text-slate-500">正在加载题库详情...</div>;
  }

  if (!detail) {
    return <div className="py-16 text-center text-sm text-rose-600">未找到该题库或无权查看</div>;
  }

  const { bank, chapters, questions, stats } = detail;
  const unratedCount = stats ? Math.max(0, stats.totalCount - stats.ratedCount) : 0;

  const buildFilteredPracticeUrl = () => {
    const qs = new URLSearchParams();
    qs.set('mode', selectedType ? 'type' : 'sequential');
    if (selectedChapter) qs.set('chapterId', selectedChapter);
    if (selectedType) qs.set('type', selectedType);
    if (selectedDifficultyTier) qs.set('difficultyTier', selectedDifficultyTier);
    if (selectedMinStar > 0) qs.set('minStar', String(selectedMinStar));
    return `/practice/${bank.id}?${qs.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        backTo="/banks"
        backLabel="返回题库中心"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span>{bank.title}</span>
            <Badge tone="brand">{bank.category}</Badge>
            <Badge tone={bank.visibility === 'public' ? 'success' : 'neutral'}>
              {bank.visibility === 'public' ? (
                <>
                  <Globe className="h-3 w-3" /> 公开共享
                </>
              ) : (
                <>
                  <Lock className="h-3 w-3" /> 个人私有
                </>
              )}
            </Badge>
            {bank.visibility === 'private' && bank.isSharedWithMe && (
              <Badge tone="ai">
                <Share2 className="h-3 w-3" /> 好友私密分享
              </Badge>
            )}
            {bank.visibility === 'private' &&
              bank.canEdit &&
              (Boolean(bank.shareEnabled) || (bank.sharedUserCount ?? 0) > 0) && (
                <Badge tone="ai">
                  <Share2 className="h-3 w-3" /> 已私密分享
                  {(bank.sharedUserCount ?? 0) > 0 ? ` (${bank.sharedUserCount}人)` : ''}
                </Badge>
              )}
          </span>
        }
        description={`${bank.description || '暂无题库描述'} · 创建者：${sanitizeDisplayName(bank.ownerName, '匿名')}`}
        actions={
          <>
            {bank.canEdit ? (
              <>
                <Button
                  variant="secondary"
                  icon={<Share2 className="h-3.5 w-3.5 text-indigo-600" />}
                  onClick={() => void openShareModal()}
                >
                  私密分享
                  {(bank.sharedUserCount ?? 0) > 0 ? ` (${bank.sharedUserCount})` : ''}
                </Button>
                <Button variant="secondary" onClick={() => void handleToggleVisibility()}>
                  {bank.visibility === 'public' ? '转为私有' : '公开到广场'}
                </Button>
                <Button
                  icon={<FileUp className="h-3.5 w-3.5" />}
                  onClick={() => navigate(`/import?bankId=${bank.id}&tab=standard-doc`)}
                >
                  Excel / Word 导题
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  icon={<Copy className="h-3.5 w-3.5" />}
                  onClick={() => void handleClone()}
                >
                  克隆为私有题库
                </Button>
                {bank.isSharedWithMe && (
                  <Button
                    variant="ghost"
                    icon={<LogOut className="h-3.5 w-3.5 text-rose-600" />}
                    onClick={() => void handleLeaveSharedBank()}
                    className="text-rose-600"
                  >
                    退出分享
                  </Button>
                )}
              </>
            )}
            <Button
              variant="secondary"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() =>
                void downloadWithAuth(`/api/banks/${bank.id}/export`, `${bank.title}.xlsx`)
              }
            >
              导出 Excel
            </Button>
            <Button
              variant="secondary"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() =>
                void downloadWithAuth(`/api/banks/${bank.id}/export-word`, `${bank.title}.docx`)
              }
            >
              导出 Word
            </Button>
            <Button
              variant="secondary"
              icon={<Printer className="h-3.5 w-3.5" />}
              onClick={() => setShowPrint(true)}
            >
              打印讲义
            </Button>
          </>
        }
      />

      {/* 刷题/背题/模考模式启动区（考试宝六大金刚模式卡片） */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <button
          type="button"
          onClick={() => navigate(`/practice/${bank.id}?mode=sequential`)}
          className="group flex flex-col items-start justify-between rounded-xl border border-brand-600 bg-brand-600 p-4 text-left text-white shadow-card transition hover:-translate-y-0.5 hover:bg-brand-700 hover:shadow-card-hover"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/15">
            <Play className="h-5 w-5" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-bold">顺序刷题</div>
            <div className="mt-0.5 text-[11px] text-white/85 tabular-nums">
              {bank.lastProgressIndex > 0 ? `续第 ${bank.lastProgressIndex + 1} 题` : '按序逐题攻克'}
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate(`/practice/${bank.id}?mode=random`)}
          className="group flex flex-col items-start justify-between rounded-lg border border-[#EBEEF5] bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card-hover"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Shuffle className="h-4.5 w-4.5" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-bold text-[#303133] group-hover:text-brand-600">随机乱序</div>
            <div className="mt-0.5 text-[11px] text-[#909399]">打乱题序选项练</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate(`/practice/${bank.id}?mode=sequential&recite=1`)}
          className="group flex flex-col items-start justify-between rounded-lg border border-[#EBEEF5] bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card-hover"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <BookOpen className="h-4.5 w-4.5" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-bold text-[#303133] group-hover:text-brand-600">背题模式</div>
            <div className="mt-0.5 text-[11px] text-[#909399]">答案解析直接展开</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate(`/practice/${bank.id}?mode=unmastered`)}
          className="group flex flex-col items-start justify-between rounded-lg border border-[#EBEEF5] bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card-hover"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
            <Scissors className="h-4.5 w-4.5" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-bold text-[#303133] group-hover:text-brand-600">仅刷未斩</div>
            <div className="mt-0.5 text-[11px] text-[#909399]">自动跳过已掌握题</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate(`/practice/${bank.id}?mode=mistakes`)}
          className="group flex flex-col items-start justify-between rounded-lg border border-[#EBEEF5] bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card-hover"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <AlertCircle className="h-4.5 w-4.5" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-bold text-[#303133] group-hover:text-brand-600">本库错题</div>
            <div className="mt-0.5 text-[11px] text-[#909399]">本库错题专项突破</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate(`/exams?createFromBank=${bank.id}`)}
          className="group flex flex-col items-start justify-between rounded-lg border border-[#EBEEF5] bg-white p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card-hover"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <ClipboardCheck className="h-4.5 w-4.5" />
          </div>
          <div className="mt-3">
            <div className="text-sm font-bold text-[#303133] group-hover:text-brand-600">组卷模考</div>
            <div className="mt-0.5 text-[11px] text-[#909399]">限时模考自动评分</div>
          </div>
        </button>
      </div>

      {/* 题型分类标签条 + DeepSeek 难度/星级评估面板 */}
      {stats && (
        <Card padding="sm" className="space-y-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                <Sparkles className="h-4 w-4 text-indigo-600" />
                DeepSeek 智能评级与题型分布
              </span>
              <Badge tone="neutral" className="tabular-nums">
                已评 {stats.ratedCount} / {stats.totalCount} 题
              </Badge>
              <Badge tone="brand" className="tabular-nums">
                均难度 {stats.avgDifficulty}
              </Badge>
              <Badge tone="warning" className="gap-0.5 tabular-nums">
                <Star className="h-3 w-3 fill-current" />
                均星级 {stats.avgStarRating > 0 ? stats.avgStarRating : '待评'}
              </Badge>
              <span className="hidden text-[11px] text-slate-500 tabular-nums sm:inline">
                简 {stats.difficultyCounts.easy} · 中 {stats.difficultyCounts.medium} · 难{' '}
                {stats.difficultyCounts.hard}
              </span>
            </div>

            {bank.canEdit && stats.totalCount > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {ratingProgress && (
                  <>
                    <span className="text-xs font-semibold text-indigo-700 tabular-nums">
                      分批处理中：{ratingProgress.done} / {ratingProgress.total} 题
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        rateStopRef.current = true;
                      }}
                    >
                      停止
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ai"
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                  loading={ratingLoading === 'unrated'}
                  disabled={ratingLoading !== null || unratedCount === 0}
                  onClick={() => void handleAiRateBank({ onlyUnrated: true })}
                >
                  {unratedCount > 0 ? `DS 评未评题 (${unratedCount})` : '已全部评级'}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={ratingLoading === 'all'}
                  disabled={ratingLoading !== null}
                  onClick={() => void handleAiRateBank({ onlyUnrated: false })}
                >
                  全库重评
                </Button>
              </div>
            )}
          </div>

          {ratingProgress && ratingProgress.total > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
              <div
                style={{
                  width: `${Math.min(100, Math.round((ratingProgress.done / ratingProgress.total) * 100))}%`,
                }}
                className="h-full rounded-full bg-indigo-600 transition-all duration-300"
              />
            </div>
          )}

          {ratingBanner && <Alert tone={ratingBanner.tone}>{ratingBanner.message}</Alert>}

          {/* 题型分类快捷标签栏 */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSelectedType('')}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition tabular-nums ${
                selectedType === ''
                  ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                  : 'border-[#E6E9EF] bg-slate-50 text-slate-700 hover:border-brand-300 hover:bg-brand-50/50'
              }`}
            >
              全部 ({stats.totalCount})
            </button>
            {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((qt) => {
              const count = stats.typeCounts[qt] || 0;
              const active = selectedType === qt;
              return (
                <button
                  key={qt}
                  type="button"
                  onClick={() => setSelectedType(active ? '' : qt)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition tabular-nums ${
                    active
                      ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                      : count > 0
                        ? 'border-[#E6E9EF] bg-white text-slate-700 hover:border-brand-300 hover:text-brand-600'
                        : 'border-[#E6E9EF] bg-slate-50/60 text-slate-400 hover:border-slate-300'
                  }`}
                >
                  {QUESTION_TYPE_LABELS[qt]} ({count})
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* 章节导航 + 题目列表 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <Card padding="sm" className="lg:col-span-1 lg:self-start">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900">章节目录</h2>
            <span className="text-xs font-medium text-slate-500 tabular-nums">
              {chapters.length} 章
            </span>
          </div>

          <div className="space-y-1">
            <button
              type="button"
              onClick={() => setSelectedChapter('')}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold transition ${
                selectedChapter === ''
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <span>全部题目</span>
              <span className="tabular-nums">{questions.length}</span>
            </button>

            {chapters.map((ch) => (
              <div
                key={ch.id}
                className={`group flex items-center justify-between rounded-lg px-3 py-2 text-xs transition ${
                  selectedChapter === ch.id
                    ? 'bg-brand-50 font-semibold text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setSelectedChapter(ch.id)}
                  className="min-w-0 flex-1 truncate text-left"
                >
                  {ch.title}
                </button>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 tabular-nums">{ch.questionCount}</span>
                  <Link
                    to={`/practice/${bank.id}?mode=chapter&chapterId=${ch.id}`}
                    title="专刷本章"
                    className="rounded p-0.5 text-brand-600 hover:bg-brand-100"
                  >
                    <Play className="h-3 w-3" />
                  </Link>
                  {bank.canEdit && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteChapter(ch.id)}
                      className="hidden rounded p-0.5 text-slate-400 hover:text-rose-600 group-hover:inline-block"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {bank.canEdit && (
            <form onSubmit={handleAddChapter} className="mt-4 flex gap-1.5 border-t border-slate-100 pt-3">
              <input
                type="text"
                value={newChapterName}
                onChange={(e) => setNewChapterName(e.target.value)}
                placeholder="新章节名称..."
                className={`${INPUT_CLS} h-8 min-w-0 flex-1 text-xs`}
              />
              <Button type="submit" size="sm" variant="secondary">
                添加
              </Button>
            </form>
          )}
        </Card>

        <div className="space-y-3.5 lg:col-span-3">
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedDifficultyTier}
                onChange={(e) => setSelectedDifficultyTier(e.target.value as DifficultyTier | '')}
                aria-label="按难度分档筛选"
                className={`${SELECT_CLS} h-8 text-xs`}
              >
                <option value="">全部难度</option>
                {(Object.keys(DIFFICULTY_TIER_LABELS) as DifficultyTier[]).map((tier) => (
                  <option key={tier} value={tier}>
                    {DIFFICULTY_TIER_LABELS[tier]}
                  </option>
                ))}
              </select>

              <select
                value={selectedMinStar}
                onChange={(e) => setSelectedMinStar(Number(e.target.value))}
                aria-label="按最低星级筛选"
                className={`${SELECT_CLS} h-8 text-xs`}
              >
                <option value={0}>全部星级</option>
                <option value={3}>3★ 及以上</option>
                <option value={4}>4★ 及以上</option>
                <option value={5}>5★ 核心精选</option>
              </select>

              {(selectedType || selectedDifficultyTier || selectedMinStar > 0 || selectedChapter) && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Play className="h-3 w-3" />}
                    onClick={() => navigate(buildFilteredPracticeUrl())}
                  >
                    按当前筛选刷题
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedType('');
                      setSelectedDifficultyTier('');
                      setSelectedMinStar(0);
                      setSelectedChapter('');
                    }}
                    className="text-xs font-medium text-slate-500 hover:text-brand-600"
                  >
                    清空筛选
                  </button>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void loadDetail();
                }}
                className="flex gap-1.5"
              >
                <input
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="库内搜题..."
                  className={`${INPUT_CLS} h-8 w-40 text-xs sm:w-48`}
                />
                <Button type="submit" size="sm" variant="secondary">
                  查询
                </Button>
              </form>
              {bank.canEdit && (
                <Button
                  size="sm"
                  icon={<Plus className="h-3.5 w-3.5" />}
                  onClick={openNewQuestionModal}
                >
                  新增一题
                </Button>
              )}
            </div>
          </Card>

          {questions.length === 0 ? (
            <EmptyState
              icon={<BookOpen className="h-8 w-8" />}
              title="当前筛选范围暂无题目"
              description="可点击右上角「批量导题」快速导入整套试卷，或点击「新增一题」录入"
            />
          ) : (
            <div className="space-y-3">
              {questions.map((q, idx) => (
                <Card key={q.id} padding="sm" className="sm:p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 tabular-nums">#{idx + 1}</span>
                      <Badge tone="brand">{QUESTION_TYPE_LABELS[q.type]}</Badge>
                      <Badge
                        tone={q.difficulty >= 4 ? 'danger' : q.difficulty <= 2 ? 'success' : 'neutral'}
                      >
                        {DIFFICULTY_LABELS[q.difficulty] || `难度${q.difficulty}`}
                      </Badge>
                      {(q.starRating ?? 0) > 0 && (
                        <Badge tone="warning" className="gap-0.5 tabular-nums">
                          <Star className="h-3 w-3 fill-current" />
                          {q.starRating}星
                        </Badge>
                      )}
                      {q.chapterTitle && <Badge tone="neutral">{q.chapterTitle}</Badge>}
                      {q.record?.inMistakeBook && <Badge tone="danger">错题本</Badge>}
                      {q.record && q.record.answeredCount > 0 && q.record.lastIsCorrect === true && (
                        <Badge tone="success">已答对</Badge>
                      )}
                      {q.record &&
                        q.record.answeredCount > 0 &&
                        q.record.lastIsCorrect === false &&
                        !q.record.inMistakeBook && <Badge tone="danger">已答错</Badge>}
                    </div>
                    {bank.canEdit && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleAiRateBank({ questionIds: [q.id] })}
                          disabled={ratingLoading !== null}
                          className="rounded-lg p-1.5 text-indigo-600 hover:bg-indigo-50 disabled:opacity-40"
                          title="DeepSeek 智能评级此题"
                        >
                          <Sparkles className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingQ(q)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-brand-600"
                          title="编辑题目"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteQuestion(q.id)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                          title="删除题目"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="mt-2.5 whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-900">
                    {q.stem}
                  </p>

                  {q.options.length > 0 && (
                    <div className="mt-2.5 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
                      {q.options.map((opt) => (
                        <div
                          key={opt.key}
                          className={`rounded-lg px-3 py-1.5 ${
                            q.answer.includes(opt.key)
                              ? 'border border-emerald-200 bg-emerald-50 font-semibold text-emerald-800'
                              : 'border border-slate-200 bg-slate-50 text-slate-700'
                          }`}
                        >
                          {opt.key}. {opt.content}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-baseline gap-3 border-t border-slate-100 pt-2.5 text-xs">
                    <span className="font-bold text-emerald-700">
                      答案：
                      {q.type === 'boolean'
                        ? q.answer === 'A'
                          ? '正确'
                          : '错误'
                        : q.answer}
                    </span>
                    {q.explanation && (
                      <span className="text-slate-600">解析：{q.explanation}</span>
                    )}
                    {q.ratingReason && (
                      <span className="text-indigo-700">AI 评级理由：{q.ratingReason}</span>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <PrintModal
        open={showPrint}
        onClose={() => setShowPrint(false)}
        title={bank.title}
        subtitle={`${bank.category} · 创建者：${bank.ownerName}`}
        questions={questions}
      />

      <Modal
        open={Boolean(editingQ)}
        onClose={() => setEditingQ(null)}
        title={editingQ?.id ? '编辑试题' : '新增试题'}
        maxWidthClass="max-w-2xl"
      >
        {editingQ && (
          <form onSubmit={handleSaveQuestion} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={LABEL_CLS}>题型</label>
                <select
                  value={editingQ.type || 'single'}
                  onChange={(e) => {
                    const nextType = e.target.value as QuestionType;
                    const nextOpts: QuestionOption[] =
                      nextType === 'boolean'
                        ? [
                            { key: 'A', content: '正确' },
                            { key: 'B', content: '错误' },
                          ]
                        : nextType === 'fill' || nextType === 'short'
                          ? []
                          : editingQ.options && editingQ.options.length >= 2
                            ? editingQ.options
                            : [
                                { key: 'A', content: '' },
                                { key: 'B', content: '' },
                                { key: 'C', content: '' },
                                { key: 'D', content: '' },
                              ];
                    setEditingQ({ ...editingQ, type: nextType, options: nextOpts });
                  }}
                  className={`${SELECT_CLS} w-full`}
                >
                  {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>所属章节</label>
                <select
                  value={editingQ.chapterId || ''}
                  onChange={(e) =>
                    setEditingQ({ ...editingQ, chapterId: e.target.value || null })
                  }
                  className={`${SELECT_CLS} w-full`}
                >
                  <option value="">不划分章节</option>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>题干内容</label>
              <textarea
                required
                rows={3}
                value={editingQ.stem || ''}
                onChange={(e) => setEditingQ({ ...editingQ, stem: e.target.value })}
                className={TEXTAREA_CLS}
              />
            </div>

            {(editingQ.type === 'single' || editingQ.type === 'multiple') && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className={LABEL_CLS}>选项列表</label>
                  <button
                    type="button"
                    onClick={() => {
                      const opts = editingQ.options || [];
                      if (opts.length >= 8) return;
                      setEditingQ({
                        ...editingQ,
                        options: [
                          ...opts,
                          { key: String.fromCharCode(65 + opts.length), content: '' },
                        ],
                      });
                    }}
                    className="text-xs font-semibold text-brand-600 hover:underline"
                  >
                    + 增加选项
                  </button>
                </div>
                {(editingQ.options || []).map((opt, idx) => (
                  <div key={opt.key} className="flex items-center gap-2">
                    <span className="w-6 text-center text-xs font-bold text-slate-600">
                      {opt.key}
                    </span>
                    <input
                      type="text"
                      value={opt.content}
                      onChange={(e) => {
                        const next = [...(editingQ.options || [])];
                        next[idx] = { ...opt, content: e.target.value };
                        setEditingQ({ ...editingQ, options: next });
                      }}
                      className={INPUT_CLS}
                    />
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className={LABEL_CLS}>
                标准答案（单选填 A，多选填 ABD，判断填 A=正确 / B=错误，多空用 | 隔开）
              </label>
              <input
                type="text"
                required
                value={editingQ.answer || ''}
                onChange={(e) => setEditingQ({ ...editingQ, answer: e.target.value })}
                className={INPUT_CLS}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>难度评级 (1~5)</label>
                <select
                  value={editingQ.difficulty ?? 2}
                  onChange={(e) =>
                    setEditingQ({ ...editingQ, difficulty: Number(e.target.value) })
                  }
                  className={`${SELECT_CLS} w-full`}
                >
                  {[1, 2, 3, 4, 5].map((lv) => (
                    <option key={lv} value={lv}>
                      {lv} 级 · {DIFFICULTY_LABELS[lv]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>星级评分 (0~5)</label>
                <select
                  value={editingQ.starRating ?? 0}
                  onChange={(e) =>
                    setEditingQ({ ...editingQ, starRating: Number(e.target.value) })
                  }
                  className={`${SELECT_CLS} w-full`}
                >
                  <option value={0}>0 · 未评级</option>
                  <option value={1}>1★ · 边缘了解</option>
                  <option value={2}>2★ · 基础常识</option>
                  <option value={3}>3★ · 常规考点</option>
                  <option value={4}>4★ · 高频重点</option>
                  <option value={5}>5★ · 核心压轴</option>
                </select>
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>试题解析</label>
              <textarea
                rows={3}
                value={editingQ.explanation || ''}
                onChange={(e) => setEditingQ({ ...editingQ, explanation: e.target.value })}
                className={TEXTAREA_CLS}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditingQ(null)}>
                取消
              </Button>
              <Button type="submit" loading={savingQ}>
                保存题目
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* 私密分享管理弹窗 */}
      <Modal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        title={`私密分享 · ${bank.title}`}
        maxWidthClass="max-w-xl"
      >
        <div className="space-y-5">
          <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50/70 p-3 text-xs leading-relaxed text-indigo-950">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" />
            <span>
              <strong>保持私有性质：</strong>
              私密分享不会把题库发布到「公共题库广场」。未获授权或未通过分享口令的其他用户完全不可见；被分享者可刷题/搜题/克隆副本，但无权修改原题库或再次对外查看分享码。
            </span>
          </div>

          {shareError && <Alert tone="error">{shareError}</Alert>}
          {shareNotice && <Alert tone="success">{shareNotice}</Alert>}

          {shareLoading || !shareSettings ? (
            <div className="py-8 text-center text-xs text-slate-500">正在加载分享设置...</div>
          ) : (
            <>
              {/* 1. 私密分享链接与口令 */}
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900">方式一：私密分享链接 / 分享码</div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      开启后，持有分享码（及可选口令）的登录成员可加入该题库
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={shareSettings.shareEnabled ? 'secondary' : 'primary'}
                    loading={shareSaving}
                    onClick={() =>
                      void handleUpdateShareSettings({ shareEnabled: !shareSettings.shareEnabled })
                    }
                  >
                    {shareSettings.shareEnabled ? '关闭分享链接' : '开启分享链接'}
                  </Button>
                </div>

                {shareSettings.shareEnabled && shareSettings.shareCode && (
                  <div className="space-y-3 border-t border-slate-200 pt-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="flex-1 truncate rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-800">
                        {`${window.location.origin}/banks/share/${shareSettings.shareCode}`}
                      </code>
                      <Button
                        size="sm"
                        variant="outline"
                        icon={copiedFlag === 'link' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        onClick={async () => {
                          const ok = await copyTextSafe(
                            `${window.location.origin}/banks/share/${shareSettings.shareCode}`
                          );
                          if (ok) {
                            setCopiedFlag('link');
                            setTimeout(() => setCopiedFlag(null), 1800);
                          }
                        }}
                      >
                        {copiedFlag === 'link' ? '已复制链接' : '复制链接'}
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-slate-600">分享码：</span>
                        <span className="rounded bg-brand-50 px-2 py-0.5 font-mono text-sm font-bold tracking-wider text-brand-700">
                          {shareSettings.shareCode}
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const ok = await copyTextSafe(shareSettings.shareCode);
                            if (ok) {
                              setCopiedFlag('code');
                              setTimeout(() => setCopiedFlag(null), 1800);
                            }
                          }}
                        >
                          {copiedFlag === 'code' ? '已复制' : '复制码'}
                        </Button>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={shareSaving}
                        icon={<RefreshCw className="h-3.5 w-3.5" />}
                        onClick={() => void handleUpdateShareSettings({ resetCode: true })}
                      >
                        重置分享码
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-2.5">
                      <KeyRound className="h-4 w-4 shrink-0 text-slate-500" />
                      <input
                        type="text"
                        value={sharePasswordInput}
                        onChange={(e) => setSharePasswordInput(e.target.value)}
                        placeholder={
                          shareSettings.hasSharePassword
                            ? '已设置访问口令（输入新口令即可替换）'
                            : '可选：设置私密访问口令（留空表示无需口令）'
                        }
                        className={`${INPUT_CLS} h-8 flex-1 text-xs`}
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={shareSaving || !sharePasswordInput.trim()}
                        onClick={() =>
                          void handleUpdateShareSettings({
                            sharePassword: sharePasswordInput.trim(),
                          })
                        }
                      >
                        保存口令
                      </Button>
                      {shareSettings.hasSharePassword && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={shareSaving}
                          onClick={() => void handleUpdateShareSettings({ clearPassword: true })}
                          className="text-rose-600"
                        >
                          清除口令
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* 2. 定向账号授权 */}
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
                <div>
                  <div className="text-sm font-bold text-slate-900">方式二：定向分享给指定成员</div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    输入对方注册用户名或邮箱即可精确授权，无需打开分享链接开关
                  </p>
                </div>

                <form onSubmit={handleAddShareMember} className="flex gap-2">
                  <input
                    type="text"
                    value={inviteAccount}
                    onChange={(e) => setInviteAccount(e.target.value)}
                    placeholder="输入对方用户名或邮箱..."
                    className={`${INPUT_CLS} flex-1`}
                  />
                  <Button
                    type="submit"
                    loading={inviting}
                    icon={!inviting ? <UserPlus className="h-3.5 w-3.5" /> : undefined}
                  >
                    授权访问
                  </Button>
                </form>

                <div className="border-t border-slate-100 pt-3">
                  <div className="mb-2 text-xs font-semibold text-slate-600">
                    已获授权的成员 ({shareSettings.members.length})
                  </div>
                  {shareSettings.members.length === 0 ? (
                    <p className="py-3 text-center text-xs text-slate-400">
                      暂未向其他成员共享此私有题库
                    </p>
                  ) : (
                    <div className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
                      {shareSettings.members.map((m) => (
                        <div
                          key={m.userId}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                              <span className="truncate">{m.nickname}</span>
                              <span className="text-slate-400">@{m.username}</span>
                              <Badge tone={m.via === 'direct' ? 'brand' : 'ai'}>
                                {m.via === 'direct' ? '定向授权' : '分享码加入'}
                              </Badge>
                            </div>
                            <div className="truncate text-[11px] text-slate-400">{m.email}</div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<UserMinus className="h-3.5 w-3.5 text-rose-600" />}
                            onClick={() => void handleRemoveShareMember(m.userId)}
                            className="shrink-0 text-rose-600"
                          >
                            撤销
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};
