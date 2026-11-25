import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  ClipboardCheck,
  Copy,
  BarChart3,
  Play,
  Trash2,
  Check,
  Lock,
  Unlock,
  Sparkles,
} from 'lucide-react';
import {
  QUESTION_TYPE_LABELS,
  type BankStatsSummary,
  type ExamAssemblyMeta,
  type ExamAssemblyStrategy,
  type ExamSubmissionItem,
  type ExamSummary,
  type QuestionBankSummary,
  type QuestionType,
} from '../../shared/types.js';

const STRATEGY_OPTIONS: Array<{
  value: ExamAssemblyStrategy;
  label: string;
  desc: string;
}> = [
  { value: 'balanced', label: '难度均衡（3:5:2）', desc: '30% 简单 + 50% 中等 + 20% 偏难' },
  { value: 'easy_first', label: '基础递进（6:3:1）', desc: '60% 简单 + 30% 中等 + 10% 偏难' },
  { value: 'hard_focus', label: '攻坚拔高（1.5:3.5:5）', desc: '15% 简单 + 35% 中等 + 50% 偏难' },
  { value: 'high_star', label: '高星核心题优先', desc: '优先抽取 AI/人工高星级重点题' },
  { value: 'custom_ratio', label: '自定义难易比', desc: '自由设置简单 / 中等 / 偏难配比' },
  { value: 'random', label: '完全随机抽取', desc: '全库等概率随机抽取' },
];

const STRATEGY_BADGE_MAP: Record<ExamAssemblyStrategy, string> = {
  balanced: '难度均衡 3:5:2',
  easy_first: '基础递进 6:3:1',
  hard_focus: '攻坚拔高',
  high_star: '高星核心精选',
  custom_ratio: '自定义配比',
  random: '随机组卷',
};
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  INPUT_CLS,
  LABEL_CLS,
  Modal,
  PageHeader,
  SELECT_CLS,
} from '../components/ui';

export const ExamsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialBankId = searchParams.get('createFromBank') || '';

  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [submissions, setSubmissions] = useState<ExamSubmissionItem[]>([]);
  const [banks, setBanks] = useState<QuestionBankSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedCode, setCopiedCode] = useState('');

  const [showCreate, setShowCreate] = useState(Boolean(initialBankId));
  const [bankId, setBankId] = useState(initialBankId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [examType, setExamType] = useState<'mock' | 'published'>('published');
  const [totalQuestions, setTotalQuestions] = useState(20);
  const [useCustomCounts, setUseCustomCounts] = useState(false);
  const [counts, setCounts] = useState({ single: 10, multiple: 4, boolean: 4, fill: 2, short: 0 });
  const [strategy, setStrategy] = useState<ExamAssemblyStrategy>('balanced');
  const [difficultyRatio, setDifficultyRatio] = useState({ easy: 30, medium: 50, hard: 20 });
  const [minStarRating, setMinStarRating] = useState(0);
  const [selectedBankStats, setSelectedBankStats] = useState<BankStatsSummary | null>(null);
  const [assemblyPreview, setAssemblyPreview] = useState<{
    totalPicked: number;
    typeBreakdown: Record<QuestionType, number>;
    meta: ExamAssemblyMeta;
    warnings: string[];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [totalScore, setTotalScore] = useState(100);
  const [passScorePercent, setPassScorePercent] = useState(60);
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [maxTabSwitches, setMaxTabSwitches] = useState(5);
  const [maxAttempts, setMaxAttempts] = useState(3);
  const [allowGuest, setAllowGuest] = useState(true);
  const [accessPassword, setAccessPassword] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [joinInput, setJoinInput] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [examRes, bankRes] = await Promise.all([
        apiFetch<{ exams: ExamSummary[]; submissions: ExamSubmissionItem[] }>('/api/exams'),
        apiFetch<{ banks: QuestionBankSummary[] }>('/api/banks?scope=all'),
      ]);
      setExams(examRes.exams);
      setSubmissions(examRes.submissions);
      setBanks(bankRes.banks);
      if (!bankId && bankRes.banks.length > 0) {
        setBankId(bankRes.banks[0].id);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!showCreate || !bankId) return;
    let cancelled = false;
    setAssemblyPreview(null);
    void apiFetch<{ stats?: BankStatsSummary }>(`/api/banks/${bankId}`)
      .then((res) => {
        if (!cancelled) setSelectedBankStats(res.stats ?? null);
      })
      .catch(() => {
        if (!cancelled) setSelectedBankStats(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showCreate, bankId]);

  const handlePreviewAssembly = async () => {
    if (!bankId) return;
    setCreateError('');
    setPreviewLoading(true);
    try {
      const res = await apiFetch<{
        projected: {
          totalPicked: number;
          typeBreakdown: Record<QuestionType, number>;
          meta: ExamAssemblyMeta;
        };
        warnings: string[];
      }>('/api/exams/preview-assembly', {
        method: 'POST',
        json: {
          bankId,
          totalQuestions,
          ...(useCustomCounts ? { counts } : {}),
          strategy,
          ...(strategy === 'custom_ratio' ? { difficultyRatio } : {}),
          minStarRating,
        },
      });
      setAssemblyPreview({
        totalPicked: res.projected.totalPicked,
        typeBreakdown: res.projected.typeBreakdown,
        meta: res.projected.meta,
        warnings: res.warnings || [],
      });
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '组卷预演失败');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleCopyShareLink = async (shareCode: string) => {
    const url = `${window.location.origin}/exam/join/${shareCode}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedCode(shareCode);
      setTimeout(() => setCopiedCode(''), 2000);
    } catch {
      window.prompt('复制考场直达链接分享给考生：', url);
    }
  };

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);
    try {
      const res = await apiFetch<{ id: string; shareCode: string }>('/api/exams', {
        method: 'POST',
        json: {
          bankId,
          title: title.trim() || '在线综合测评',
          description: description.trim(),
          examType,
          totalQuestions,
          ...(useCustomCounts ? { counts } : {}),
          strategy,
          ...(strategy === 'custom_ratio' ? { difficultyRatio } : {}),
          minStarRating,
          durationMinutes,
          totalScore,
          passScorePercent,
          shuffleQuestions,
          shuffleOptions,
          maxTabSwitches,
          maxAttempts,
          allowGuest,
          accessPassword: accessPassword.trim(),
        },
      });
      setShowCreate(false);
      setTitle('');
      if (examType === 'mock') {
        navigate(`/exam/join/${res.shareCode}`);
      } else {
        void loadAll();
      }
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建考试失败');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleStatus = async (exam: ExamSummary) => {
    const next = exam.status === 'active' ? 'closed' : 'active';
    await apiFetch(`/api/exams/${exam.id}/status`, { method: 'PUT', json: { status: next } });
    void loadAll();
  };

  const handleDeleteExam = async (exam: ExamSummary) => {
    if (!window.confirm(`确认删除试卷「${exam.title}」及其全部作答记录吗？`)) return;
    await apiFetch(`/api/exams/${exam.id}`, { method: 'DELETE' });
    void loadAll();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="在线考试与模拟组卷中心"
        description="一键生成个人全真模拟考卷，或发布支持分享码、口令验证、防切屏监控与排行看板的组织考场"
        actions={
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (joinInput.trim()) navigate(`/exam/join/${joinInput.trim().toUpperCase()}`);
              }}
              className="flex gap-1.5"
            >
              <input
                type="text"
                value={joinInput}
                onChange={(e) => setJoinInput(e.target.value)}
                placeholder="输入分享码参试..."
                className={`${INPUT_CLS} w-36 uppercase`}
              />
              <Button type="submit" variant="secondary">
                进入考场
              </Button>
            </form>
            <Button icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowCreate(true)}>
              组卷 / 发布考试
            </Button>
          </>
        }
      />

      <section className="space-y-3">
        <h2 className="text-sm font-bold text-slate-800 sm:text-base">试卷与组织考场列表</h2>
        {loading ? (
          <div className="py-12 text-center text-sm text-slate-500">加载考场列表...</div>
        ) : exams.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="h-9 w-9" />}
            title="暂无考试记录"
            description="点击右上角「组卷 / 发布考试」从您的题库中抽取试题创建第一场考试"
            action={<Button onClick={() => setShowCreate(true)}>立即创建考试</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {exams.map((ex) => {
              const isCreator = ex.creatorId === user?.id || user?.role === 'admin';
              return (
                <Card key={ex.id} className="flex flex-col justify-between">
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={ex.examType === 'published' ? 'ai' : 'neutral'}>
                          {ex.examType === 'published' ? '组织发布考试' : '个人模拟考'}
                        </Badge>
                        <Badge tone={ex.status === 'active' ? 'success' : 'danger'}>
                          {ex.status === 'active' ? '进行中' : '已关闭'}
                        </Badge>
                        {ex.assemblyMeta?.strategy && (
                          <Badge tone="brand">
                            {STRATEGY_BADGE_MAP[ex.assemblyMeta.strategy] || '智能组卷'}
                          </Badge>
                        )}
                        {ex.hasPassword && (
                          <Badge tone="warning">
                            <Lock className="h-3 w-3" /> 设口令
                          </Badge>
                        )}
                      </div>
                      <span className="font-mono text-xs font-bold text-brand-700">
                        码: {ex.shareCode}
                      </span>
                    </div>

                    <h3 className="mt-2.5 text-base font-bold text-slate-900">{ex.title}</h3>
                    {ex.description && (
                      <p className="mt-1 text-xs text-slate-600">{ex.description}</p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                      <span>题量 {ex.questionCount} 题</span>
                      <span>时长 {ex.durationMinutes} 分钟</span>
                      <span>
                        总分 {ex.totalScore} / 及格 {ex.passScore}
                      </span>
                      {ex.assemblyMeta?.actualDistribution && (
                        <span>
                          难度 易{ex.assemblyMeta.actualDistribution.easy}/中
                          {ex.assemblyMeta.actualDistribution.medium}/难
                          {ex.assemblyMeta.actualDistribution.hard} · 均难{' '}
                          {ex.assemblyMeta.actualDistribution.avgDifficulty}
                          {ex.assemblyMeta.actualDistribution.avgStarRating > 0
                            ? ` · 均${ex.assemblyMeta.actualDistribution.avgStarRating}★`
                            : ''}
                        </span>
                      )}
                      {ex.submissionCount !== undefined && ex.submissionCount > 0 && (
                        <span className="font-semibold text-slate-800">
                          已交卷 {ex.submissionCount} 人 · 均分 {ex.avgScore} · 及格率 {ex.passRate}%
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3.5">
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        size="sm"
                        icon={<Play className="h-3 w-3" />}
                        onClick={() => navigate(`/exam/join/${ex.shareCode}`)}
                      >
                        开始作答
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={
                          copiedCode === ex.shareCode ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )
                        }
                        onClick={() => void handleCopyShareLink(ex.shareCode)}
                      >
                        {copiedCode === ex.shareCode ? '已复制链接' : '分享链接'}
                      </Button>
                      {isCreator && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<BarChart3 className="h-3 w-3 text-indigo-600" />}
                          onClick={() => navigate(`/exams/${ex.id}/analytics`)}
                        >
                          排行与统计
                        </Button>
                      )}
                    </div>

                    {isCreator && (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleToggleStatus(ex)}
                          title={ex.status === 'active' ? '关闭考场' : '重新开启考场'}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          {ex.status === 'active' ? (
                            <Lock className="h-4 w-4" />
                          ) : (
                            <Unlock className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteExam(ex)}
                          className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <Card>
        <CardHeader
          icon={<ClipboardCheck className="h-4 w-4 text-brand-600" />}
          title="我的历史交卷记录"
        />
        {submissions.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-500">暂无交卷记录</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="py-2.5 pr-4 font-semibold">试卷名称</th>
                  <th className="py-2.5 pr-4 font-semibold">得分</th>
                  <th className="py-2.5 pr-4 font-semibold">结果</th>
                  <th className="py-2.5 pr-4 font-semibold">正确题数</th>
                  <th className="py-2.5 pr-4 font-semibold">切屏次数</th>
                  <th className="py-2.5 pr-4 font-semibold">交卷时间</th>
                  <th className="py-2.5 font-semibold">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums">
                {submissions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4 font-semibold text-slate-900">{sub.examTitle}</td>
                    <td className="py-3 pr-4 font-bold text-brand-700">
                      {sub.score} / {sub.totalScore}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone={sub.isPassed ? 'success' : 'danger'}>
                        {sub.isPassed ? '及格' : '未及格'}
                      </Badge>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">
                      {sub.correctCount} / {sub.totalQuestions}
                    </td>
                    <td className="py-3 pr-4 text-slate-700">{sub.tabSwitchCount} 次</td>
                    <td className="py-3 pr-4 text-slate-500">
                      {new Date(sub.submittedAt).toLocaleString()}
                    </td>
                    <td className="py-3">
                      <Link
                        to={`/exam/report/${sub.id}`}
                        className="font-semibold text-brand-600 hover:underline"
                      >
                        查看成绩单
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="快速组卷 / 发布在线考试"
        maxWidthClass="max-w-2xl"
      >
        <form onSubmit={handleCreateExam} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>考试类型</label>
              <select
                value={examType}
                onChange={(e) => setExamType(e.target.value as 'mock' | 'published')}
                className={`${SELECT_CLS} w-full`}
              >
                <option value="published">组织在线考试（生成分享链接供他人作答）</option>
                <option value="mock">个人全真模拟考（创建后立刻开考）</option>
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>抽题来源题库</label>
              <select
                required
                value={bankId}
                onChange={(e) => setBankId(e.target.value)}
                className={`${SELECT_CLS} w-full`}
              >
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} ({b.questionCount} 题)
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={LABEL_CLS}>试卷标题</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：2026 运维安全岗前考核"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <label className={LABEL_CLS}>考场说明（可选）</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例如：限时 45 分钟，请勿切屏"
              className={INPUT_CLS}
            />
          </div>

          <div className="space-y-3.5 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800">抽题题量与智能组卷策略</span>
              <label className="flex items-center gap-1.5 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={useCustomCounts}
                  onChange={(e) => {
                    setUseCustomCounts(e.target.checked);
                    setAssemblyPreview(null);
                  }}
                />
                按各题型分别指定抽题数
              </label>
            </div>

            {selectedBankStats && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 tabular-nums">
                <span className="font-semibold text-slate-800">
                  库内 {selectedBankStats.totalCount} 题
                </span>
                <span>· 已评 {selectedBankStats.ratedCount} 题</span>
                <span>
                  · 简 {selectedBankStats.difficultyCounts.easy} / 中{' '}
                  {selectedBankStats.difficultyCounts.medium} / 难{' '}
                  {selectedBankStats.difficultyCounts.hard}
                </span>
                <span>
                  · 单{selectedBankStats.typeCounts.single}/多{selectedBankStats.typeCounts.multiple}/判
                  {selectedBankStats.typeCounts.boolean}/填{selectedBankStats.typeCounts.fill}/简
                  {selectedBankStats.typeCounts.short}
                </span>
              </div>
            )}

            {!useCustomCounts ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-600">目标抽取总题数：</span>
                <input
                  type="number"
                  min={1}
                  max={200}
                  value={totalQuestions}
                  onChange={(e) => {
                    setTotalQuestions(Number(e.target.value));
                    setAssemblyPreview(null);
                  }}
                  className={`${INPUT_CLS} w-24`}
                />
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {(['single', 'multiple', 'boolean', 'fill', 'short'] as const).map((t) => (
                  <div key={t}>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-600">
                      {t === 'single'
                        ? '单选'
                        : t === 'multiple'
                          ? '多选'
                          : t === 'boolean'
                            ? '判断'
                            : t === 'fill'
                              ? '填空'
                              : '简答'}
                      {selectedBankStats ? ` (${selectedBankStats.typeCounts[t]})` : ''}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={counts[t]}
                      onChange={(e) => {
                        setCounts((prev) => ({ ...prev, [t]: Number(e.target.value) }));
                        setAssemblyPreview(null);
                      }}
                      className={`${INPUT_CLS} h-8 px-2 text-xs`}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* 动态与难度均衡组卷策略 */}
            <div className="space-y-2 border-t border-slate-200 pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">难度均衡与动态配比策略</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-600">最低星级：</span>
                  <select
                    value={minStarRating}
                    onChange={(e) => {
                      setMinStarRating(Number(e.target.value));
                      setAssemblyPreview(null);
                    }}
                    className={`${SELECT_CLS} h-7 px-2 text-xs`}
                  >
                    <option value={0}>不限星级</option>
                    <option value={3}>≥ 3★</option>
                    <option value={4}>≥ 4★</option>
                    <option value={5}>仅 5★ 核心题</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {STRATEGY_OPTIONS.map((opt) => {
                  const active = strategy === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setStrategy(opt.value);
                        setAssemblyPreview(null);
                      }}
                      className={`rounded-lg border p-2 text-left transition ${
                        active
                          ? 'border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600/20'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'
                      }`}
                    >
                      <div className="text-xs font-bold">{opt.label}</div>
                      <div className="mt-0.5 text-[10px] leading-tight text-slate-500">
                        {opt.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {strategy === 'custom_ratio' && (
                <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-emerald-700">
                      简单 (1~2) 占比
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={difficultyRatio.easy}
                      onChange={(e) => {
                        setDifficultyRatio((prev) => ({
                          ...prev,
                          easy: Math.max(0, Number(e.target.value)),
                        }));
                        setAssemblyPreview(null);
                      }}
                      className={`${INPUT_CLS} h-8 px-2 text-xs`}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-brand-700">
                      中等 (3) 占比
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={difficultyRatio.medium}
                      onChange={(e) => {
                        setDifficultyRatio((prev) => ({
                          ...prev,
                          medium: Math.max(0, Number(e.target.value)),
                        }));
                        setAssemblyPreview(null);
                      }}
                      className={`${INPUT_CLS} h-8 px-2 text-xs`}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-rose-700">
                      偏难 (4~5) 占比
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={difficultyRatio.hard}
                      onChange={(e) => {
                        setDifficultyRatio((prev) => ({
                          ...prev,
                          hard: Math.max(0, Number(e.target.value)),
                        }));
                        setAssemblyPreview(null);
                      }}
                      className={`${INPUT_CLS} h-8 px-2 text-xs`}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  icon={<Sparkles className="h-3.5 w-3.5 text-indigo-600" />}
                  loading={previewLoading}
                  disabled={!bankId}
                  onClick={() => void handlePreviewAssembly()}
                >
                  预览智能组卷配比
                </Button>
                {assemblyPreview && (
                  <span className="text-[11px] font-semibold text-slate-600 tabular-nums">
                    预计实抽 {assemblyPreview.totalPicked} 题 · 均难度{' '}
                    {assemblyPreview.meta.actualDistribution.avgDifficulty}
                    {assemblyPreview.meta.actualDistribution.avgStarRating > 0
                      ? ` · 均星级 ${assemblyPreview.meta.actualDistribution.avgStarRating}★`
                      : ''}
                  </span>
                )}
              </div>

              {assemblyPreview && (
                <div className="space-y-2 rounded-lg border border-indigo-200 bg-white p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2 tabular-nums">
                    <Badge tone="success">
                      简单 {assemblyPreview.meta.actualDistribution.easy} 题
                    </Badge>
                    <Badge tone="brand">
                      中等 {assemblyPreview.meta.actualDistribution.medium} 题
                    </Badge>
                    <Badge tone="danger">
                      偏难 {assemblyPreview.meta.actualDistribution.hard} 题
                    </Badge>
                    <span className="text-[11px] text-slate-500">
                      {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[])
                        .filter((t) => (assemblyPreview.typeBreakdown[t] || 0) > 0)
                        .map((t) => `${QUESTION_TYPE_LABELS[t]}${assemblyPreview.typeBreakdown[t]}`)
                        .join(' / ')}
                    </span>
                  </div>
                  {assemblyPreview.warnings.length > 0 && (
                    <div className="space-y-0.5 text-[11px] text-amber-700">
                      {assemblyPreview.warnings.map((w, i) => (
                        <div key={i}>• {w}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className={LABEL_CLS}>时长（分钟）</label>
              <input
                type="number"
                min={5}
                max={300}
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>试卷总分</label>
              <input
                type="number"
                min={10}
                max={500}
                value={totalScore}
                onChange={(e) => setTotalScore(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>及格百分比 (%)</label>
              <input
                type="number"
                min={1}
                max={100}
                value={passScorePercent}
                onChange={(e) => setPassScorePercent(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>防切屏上限 (0不限)</label>
              <input
                type="number"
                min={0}
                max={50}
                value={maxTabSwitches}
                onChange={(e) => setMaxTabSwitches(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>入场口令（留空则免口令）</label>
              <input
                type="text"
                value={accessPassword}
                onChange={(e) => setAccessPassword(e.target.value)}
                placeholder="可选考试密码"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>每人最多作答次数</label>
              <input
                type="number"
                min={1}
                max={99}
                value={maxAttempts}
                onChange={(e) => setMaxAttempts(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-slate-700">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={shuffleQuestions}
                onChange={(e) => setShuffleQuestions(e.target.checked)}
              />
              随机打乱试题顺序
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={shuffleOptions}
                onChange={(e) => setShuffleOptions(e.target.checked)}
              />
              随机打乱选项顺序
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={allowGuest}
                onChange={(e) => setAllowGuest(e.target.checked)}
              />
              允许免登录填写姓名/工号参试
            </label>
          </div>

          {createError && <Alert tone="error">{createError}</Alert>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button type="submit" loading={creating}>
              {examType === 'mock' ? '生成并立即开考' : '发布考试'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
