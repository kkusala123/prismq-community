import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Sparkles,
  FileUp,
  Search,
  ClipboardCheck,
  Play,
  Copy,
  ArrowRight,
  KeyRound,
  ChevronRight,
  AlertCircle,
  UploadCloud,
  Wand2,
} from 'lucide-react';
import { sanitizeDisplayName } from '../../shared/types.js';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, CardHeader, EmptyState } from '../components/ui';

interface DashboardData {
  stats: {
    myBanksCount: number;
    totalAnswered: number;
    totalCorrect: number;
    accuracy: number;
    mistakeCount: number;
    masteredCount: number;
    favoriteCount: number;
  };
  recentBanks: Array<{
    id: string;
    title: string;
    category: string;
    visibility: string;
    lastQuestionIndex: number;
    lastMode: string;
    questionCount: number;
    practicedCount: number;
  }>;
  publicBanks: Array<{
    id: string;
    title: string;
    description: string;
    category: string;
    cloneCount: number;
    ownerName: string;
    questionCount: number;
  }>;
  activeExams: Array<{
    id: string;
    title: string;
    shareCode: string;
    durationMinutes: number;
    examType: string;
  }>;
}

const QUICK_FEATURE_BAR = [
  {
    to: '/import?tab=standard-doc',
    title: '上传题库',
    desc: 'Excel / Word 模板秒导',
    icon: UploadCloud,
    iconBg: 'bg-[#F2F4F8] text-[#334155] group-hover:bg-brand-50 group-hover:text-brand-600',
  },
  {
    to: '/import?tab=ai-studio',
    title: 'AI 智能洗题',
    desc: '杂乱文档自动规范化',
    icon: Wand2,
    iconBg: 'bg-[#F2F4F8] text-[#334155] group-hover:bg-brand-50 group-hover:text-brand-600',
  },
  {
    to: '/exams',
    title: '发起考试',
    desc: '智能组卷与防作弊判分',
    icon: ClipboardCheck,
    iconBg: 'bg-[#F2F4F8] text-[#334155] group-hover:bg-brand-50 group-hover:text-brand-600',
  },
  {
    to: '/search',
    title: '搜索试题',
    desc: '精准搜题，答案解析秒出',
    icon: Search,
    iconBg: 'bg-[#F2F4F8] text-[#334155] group-hover:bg-brand-50 group-hover:text-brand-600',
  },
  {
    to: '/mistakes',
    title: '错题重练',
    desc: '高频错题与收藏专项巩固',
    icon: AlertCircle,
    iconBg: 'bg-[#F2F4F8] text-[#334155] group-hover:bg-brand-50 group-hover:text-brand-600',
  },
];

export const DashboardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [cloningId, setCloningId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<DashboardData>('/api/practice/dashboard')
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const handleClone = async (bankId: string) => {
    setCloningId(bankId);
    try {
      const res = await apiFetch<{ id: string }>(`/api/banks/${bankId}/clone`, { method: 'POST' });
      navigate(`/banks/${res.id}`);
    } finally {
      setCloningId(null);
    }
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    navigate(`/exam/join/${code}`);
  };

  if (loading) {
    return <div className="py-20 text-center text-sm text-[#606266]">正在加载学习概览...</div>;
  }

  const stats = data?.stats;
  const recentTop = data?.recentBanks?.[0];

  return (
    <div className="space-y-5">
      {/* 顶部两栏考试宝门户 Hero 区：左栏快捷题库导航 + 右栏淡蓝渐变学习总览 */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
        {/* 左侧快捷题库分类卡 */}
        <Card padding="sm" className="flex flex-col justify-between lg:w-[272px] lg:shrink-0">
          <div>
            <div className="mb-2.5 flex items-center justify-between border-b border-[#F0F2F5] pb-2">
              <span className="text-sm font-bold text-[#303133]">我的快捷题库</span>
              <Link to="/banks" className="text-xs font-medium text-brand-600 hover:underline">
                管理
              </Link>
            </div>

            {data?.recentBanks && data.recentBanks.length > 0 ? (
              <div className="space-y-1">
                {data.recentBanks.slice(0, 5).map((b) => (
                  <Link
                    key={b.id}
                    to={`/banks/${b.id}`}
                    className="group flex items-center justify-between rounded-md px-2.5 py-2 transition hover:bg-brand-50/70"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" />
                        <span className="truncate text-xs font-semibold text-[#303133] group-hover:text-brand-600">
                          {b.title}
                        </span>
                      </div>
                      <div className="mt-0.5 pl-3 text-[11px] text-[#909399] tabular-nums">
                        {b.category} · {b.practicedCount}/{b.questionCount} 题
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#C0C4CC] group-hover:text-brand-600" />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-xs text-[#909399]">
                还没有创建或练习过题库
              </div>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/banks')}
            className="mt-3 w-full"
          >
            全部题库中心
          </Button>
        </Card>

        {/* 右侧极简学习总览面板 */}
        <div className="flex flex-1 flex-col justify-between rounded-xl border border-[#E6E9EF] bg-white p-5 shadow-card sm:p-6">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-extrabold tracking-tight text-[#1E293B] sm:text-2xl">
                    欢迎回来，{sanitizeDisplayName(user?.nickname, sanitizeDisplayName(user?.username, '同学'))}
                  </h1>
                  <Badge tone="brand">
                    {user?.role === 'admin' ? '管理员工作台' : '个人学习空间'}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-[#606266]">
                  已斩题 <strong className="text-[#1E293B] tabular-nums">{stats?.masteredCount ?? 0}</strong> 道 · 收藏{' '}
                  <strong className="text-[#1E293B] tabular-nums">{stats?.favoriteCount ?? 0}</strong> 道 · 错题连续答对{' '}
                  <strong className="text-[#1E293B] tabular-nums">{user?.settings.removeAfterCorrectCount ?? 3}</strong> 次自动移出
                </p>
              </div>

              {user?.role === 'admin' && !user?.systemAiAvailable && !user?.hasPersonalAiKey && (
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<KeyRound className="h-3.5 w-3.5 text-amber-600" />}
                  onClick={() => navigate('/settings')}
                >
                  配置全局 AI 服务
                </Button>
              )}
            </div>

            {/* 4 项学习指标条 */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Link
                to="/banks"
                className="rounded-xl border border-[#EBEEF4] bg-[#F7F8FA] px-3.5 py-3 transition hover:border-brand-300 hover:bg-brand-50/40"
              >
                <div className="text-[11px] font-medium text-[#606266]">我的题库</div>
                <div className="mt-1 text-xl font-bold text-[#1E293B] tabular-nums">
                  {stats?.myBanksCount ?? 0}
                </div>
              </Link>
              <div className="rounded-xl border border-[#EBEEF4] bg-[#F7F8FA] px-3.5 py-3">
                <div className="text-[11px] font-medium text-[#606266]">累计作答</div>
                <div className="mt-1 text-xl font-bold text-brand-600 tabular-nums">
                  {stats?.totalAnswered ?? 0}
                </div>
              </div>
              <div className="rounded-xl border border-[#EBEEF4] bg-[#F7F8FA] px-3.5 py-3">
                <div className="text-[11px] font-medium text-[#606266]">综合正确率</div>
                <div className="mt-1 text-xl font-bold text-emerald-600 tabular-nums">
                  {stats?.accuracy ?? 0}%
                </div>
              </div>
              <Link
                to="/mistakes"
                className="rounded-xl border border-[#EBEEF4] bg-[#F7F8FA] px-3.5 py-3 transition hover:border-rose-300 hover:bg-rose-50/40"
              >
                <div className="text-[11px] font-medium text-[#606266]">待消灭错题</div>
                <div className="mt-1 text-xl font-bold text-rose-600 tabular-nums">
                  {stats?.mistakeCount ?? 0}
                </div>
              </Link>
            </div>
          </div>

          {/* 底部主行动按钮 + 8 位考场分享码快速入场 */}
          <div className="mt-5 flex flex-col gap-3 border-t border-[#EBEEF4] pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {recentTop ? (
                <Button
                  size="lg"
                  icon={<Play className="h-4 w-4" />}
                  onClick={() => navigate(`/practice/${recentTop.id}?mode=sequential`)}
                >
                  继续刷题（续第 {recentTop.lastQuestionIndex + 1} 题）
                </Button>
              ) : (
                <Button
                  size="lg"
                  icon={<FileUp className="h-4 w-4" />}
                  onClick={() => navigate('/import?tab=standard-doc')}
                >
                  上传 Excel / Word 题库
                </Button>
              )}
              <Button
                size="lg"
                variant="outline"
                icon={<FileUp className="h-4 w-4" />}
                onClick={() => navigate('/import?tab=standard-doc')}
              >
                导题工作台
              </Button>
            </div>

            <form onSubmit={handleJoinByCode} className="flex w-full items-center gap-1.5 sm:w-auto">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="输入 8 位考场分享码"
                className="h-10 min-w-0 flex-1 rounded-lg border border-[#D8DEE8] bg-[#F7F8FA] px-3 text-base uppercase text-[#1E293B] placeholder:text-[#909399] focus:border-brand-600 focus:bg-white focus:outline-none sm:h-9 sm:w-44 sm:flex-none sm:text-xs"
              />
              <Button type="submit" size="md" className="shrink-0">
                进考场
              </Button>
            </form>
          </div>
        </div>
      </div>

      {/* 中部 5 格极简横向快捷功能条 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        {QUICK_FEATURE_BAR.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.title}
              to={item.to}
              className="group flex items-center gap-2.5 rounded-xl border border-[#E6E9EF] bg-white px-3 py-3 shadow-card transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-card-hover sm:gap-3 sm:px-4 sm:py-3.5"
            >
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition group-hover:scale-105 sm:h-11 sm:w-11 ${item.iconBg}`}
              >
                <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-[#303133] group-hover:text-brand-600">
                  {item.title}
                </div>
                <div className="mt-0.5 truncate text-[11px] text-[#909399]">{item.desc}</div>
              </div>
            </Link>
          );
        })}
      </div>

      {/* 下方双栏：最近在练 & 公共题库广场 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="最近刷题进度"
            icon={<BookOpen className="h-4 w-4" />}
            action={
              <Link to="/banks" className="text-xs font-semibold text-brand-600 hover:underline">
                全部题库 →
              </Link>
            }
          />
          {data?.recentBanks && data.recentBanks.length > 0 ? (
            <div className="divide-y divide-[#F0F2F5]">
              {data.recentBanks.map((b) => {
                const pct =
                  b.questionCount > 0 ? Math.round((b.practicedCount / b.questionCount) * 100) : 0;
                return (
                  <div
                    key={b.id}
                    className="flex flex-col justify-between gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded-[4px] bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          题库
                        </span>
                        <Link
                          to={`/banks/${b.id}`}
                          className="truncate text-sm font-bold text-[#303133] hover:text-brand-600"
                        >
                          {b.title}
                        </Link>
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-xs text-[#606266] tabular-nums">
                        <span>
                          已练 {b.practicedCount} / {b.questionCount} 题 ({pct}%)
                        </span>
                        <span className="text-[#909399]">断点：第 {b.lastQuestionIndex + 1} 题</span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#EBEEF5]">
                        <div
                          className="h-full rounded-full bg-brand-600 transition-all"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/banks/${b.id}`)}
                      >
                        查看详情
                      </Button>
                      <Button
                        size="sm"
                        icon={<Play className="h-3 w-3" />}
                        onClick={() => navigate(`/practice/${b.id}?mode=sequential`)}
                      >
                        开始刷题
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<BookOpen className="h-8 w-8" />}
              title="暂无刷题记录"
              description="先创建一个题库或通过标准 Excel / Word 模板导入试题，即可开始高效刷题与背题"
              action={
                <Button size="sm" onClick={() => navigate('/import?tab=standard-doc')}>
                  立即上传题库
                </Button>
              }
            />
          )}
        </Card>

        <Card>
          <CardHeader
            title="公共共享题库"
            icon={<Sparkles className="h-4 w-4" />}
            action={
              <Link
                to="/banks?scope=public"
                className="text-xs font-semibold text-brand-600 hover:underline"
              >
                浏览全部 →
              </Link>
            }
          />
          {data?.publicBanks && data.publicBanks.length > 0 ? (
            <div className="divide-y divide-[#F0F2F5]">
              {data.publicBanks.map((pb) => (
                <div
                  key={pb.id}
                  className="flex flex-col justify-between gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded-[4px] bg-brand-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                        共享
                      </span>
                      <Link
                        to={`/banks/${pb.id}`}
                        className="truncate text-sm font-bold text-[#303133] hover:text-brand-600"
                      >
                        {pb.title}
                      </Link>
                      <Badge tone="brand">{pb.category}</Badge>
                    </div>
                    <p className="mt-1 line-clamp-1 text-xs text-[#606266]">
                      {pb.description || `由 ${sanitizeDisplayName(pb.ownerName, '匿名')} 分享`}
                    </p>
                    <div className="mt-1 text-[11px] text-[#909399] tabular-nums">
                      {pb.questionCount} 题 · 克隆 {pb.cloneCount} 次 · 作者 {sanitizeDisplayName(pb.ownerName, '匿名')}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={cloningId === pb.id}
                      icon={cloningId !== pb.id ? <Copy className="h-3 w-3" /> : undefined}
                      onClick={() => void handleClone(pb.id)}
                    >
                      克隆
                    </Button>
                    <Button
                      size="sm"
                      icon={<ArrowRight className="h-3 w-3" />}
                      onClick={() => navigate(`/practice/${pb.id}?mode=sequential`)}
                    >
                      刷题
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Sparkles className="h-8 w-8" />}
              title="暂无公共共享题库"
              description="将任意自建题库设为「公开共享」后，团队成员即可在此发现并克隆使用"
            />
          )}
        </Card>
      </div>
    </div>
  );
};
