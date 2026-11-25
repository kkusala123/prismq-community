import React, { useEffect, useState } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  FileUp,
  AlertCircle,
  Search,
  ClipboardCheck,
  Settings,
  LogOut,
  Download,
  Smartphone,
  GraduationCap,
  Moon,
  Sun,
  ShieldCheck,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { Badge, Button } from './ui';

const DESKTOP_NAV = [
  { to: '/', label: '首页', end: true },
  { to: '/banks', label: '题库中心' },
  { to: '/import', label: '上传题库' },
  { to: '/exams', label: '在线考试' },
  { to: '/mistakes', label: '错题与收藏' },
  { to: '/search', label: '搜索试题' },
  { to: '/settings', label: '系统设置' },
];

const MOBILE_TABS = [
  { to: '/', label: '首页', icon: LayoutDashboard },
  { to: '/banks', label: '题库', icon: BookOpen },
  { to: '/import', label: '导题', icon: FileUp },
  { to: '/mistakes', label: '错题', icon: AlertCircle },
  { to: '/exams', label: '考试', icon: ClipboardCheck },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout, canInstallPwa, isStandalonePwa, installPwa } = useAuth();
  const { isDark, toggleDark } = useTheme();
  const navigate = useNavigate();
  const [searchScope, setSearchScope] = useState<'question' | 'bank'>('question');
  const [quickQuery, setQuickQuery] = useState('');
  const [pwaHint, setPwaHint] = useState('');
  const [activeAiJobs, setActiveAiJobs] = useState(0);

  useEffect(() => {
    if (!user) {
      setActiveAiJobs(0);
      return;
    }
    let cancelled = false;
    const pollCount = () => {
      void apiFetch<{ activeCount?: number }>('/api/ai/jobs?limit=5')
        .then((res) => {
          if (!cancelled) setActiveAiJobs(Number(res.activeCount ?? 0));
        })
        .catch(() => undefined);
    };

    pollCount();
    const onJobsUpdated = () => pollCount();
    window.addEventListener('ksb:ai-jobs-updated', onJobsUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener('ksb:ai-jobs-updated', onJobsUpdated);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user || activeAiJobs <= 0) return;
    const timer = window.setInterval(() => {
      void apiFetch<{ activeCount?: number }>('/api/ai/jobs?limit=5')
        .then((res) => setActiveAiJobs(Number(res.activeCount ?? 0)))
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [user?.id, activeAiJobs > 0]);

  const handleQuickSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = quickQuery.trim();
    if (searchScope === 'bank') {
      navigate(q ? `/banks?q=${encodeURIComponent(q)}` : '/banks');
      return;
    }
    if (!q) {
      navigate('/search');
      return;
    }
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  const handleInstallClick = async () => {
    const res = await installPwa();
    if (res === 'ios-guide') {
      setPwaHint('请点击 Safari 底部「分享」按钮 -> 选择「添加到主屏幕」，即可全屏使用。');
    } else if (res === 'unsupported') {
      setPwaHint('可使用 Chrome / Edge 地址栏右侧「安装应用」按钮或浏览器菜单「添加到主屏幕」。');
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#F7F8FA] text-[#1E293B]">
      {/* 考试宝风格纯白双行顶部导航壳层 */}
      <header className="no-print sticky top-0 z-30 border-b border-[#E4E7ED] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
        {/* 第一行：Logo + 融合搜索框 + 账号与快捷按钮 */}
        <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-2 px-3 py-2 sm:gap-4 sm:px-6 sm:py-2.5">
          {/* Brand Logo */}
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
              <GraduationCap className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-base font-extrabold tracking-tight text-[#303133] sm:text-lg">
                  棱题
                </span>
                <span className="rounded-[4px] bg-brand-50 px-1.5 py-0.5 text-[10px] font-bold text-brand-600">
                  PrismQ
                </span>
              </div>
              <div className="hidden text-[11px] text-[#909399] sm:block">
                极简 AI 刷题与动态均衡组卷平台
              </div>
            </div>
          </Link>

          {/* 中央融合搜索栏（仿考试宝：上方“试题/题库”切换 + 蓝框 + 实心蓝搜索按钮） */}
          <form
            onSubmit={handleQuickSearch}
            className="hidden flex-1 max-w-xl flex-col md:flex"
          >
            <div className="flex items-center gap-1 pl-0.5">
              <button
                type="button"
                onClick={() => setSearchScope('question')}
                className={`rounded-t-[4px] px-3 py-0.5 text-xs font-semibold transition ${
                  searchScope === 'question'
                    ? 'bg-brand-600 text-white'
                    : 'text-[#606266] hover:text-brand-600'
                }`}
              >
                试题
              </button>
              <button
                type="button"
                onClick={() => setSearchScope('bank')}
                className={`rounded-t-[4px] px-3 py-0.5 text-xs font-semibold transition ${
                  searchScope === 'bank'
                    ? 'bg-brand-600 text-white'
                    : 'text-[#606266] hover:text-brand-600'
                }`}
              >
                题库
              </button>
            </div>
            <div className="flex h-9 overflow-hidden rounded-lg border border-[#D8DEE8] bg-[#F7F8FA] transition focus-within:border-brand-600 focus-within:bg-white">
              <div className="relative flex flex-1 items-center">
                <Search className="pointer-events-none ml-2.5 h-3.5 w-3.5 shrink-0 text-[#909399]" />
                <input
                  type="text"
                  value={quickQuery}
                  onChange={(e) => setQuickQuery(e.target.value)}
                  placeholder={
                    searchScope === 'question'
                      ? '输入题干关键词、选项或知识点秒查答案解析...'
                      : '输入题库名称、分类关键词快速筛选题库...'
                  }
                  className="h-full w-full bg-transparent px-2.5 text-xs text-[#1E293B] placeholder:text-[#909399] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="shrink-0 bg-brand-600 px-5 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                搜索
              </button>
            </div>
          </form>

          {/* 右侧：PWA 安装 + 上传捷径 + 用户徽章 */}
          <div className="flex shrink-0 items-center gap-2">
            {activeAiJobs > 0 && (
              <Link
                to="/import?tab=ai-jobs"
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-200 md:hidden"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-600" />
                <span>AI {activeAiJobs}</span>
              </Link>
            )}
            <NavLink
              to="/search"
              className="rounded-md p-2 text-[#606266] hover:bg-[#F5F7FA] md:hidden"
              aria-label="搜题"
            >
              <Search className="h-5 w-5" />
            </NavLink>
            {user?.role === 'admin' && (
              <NavLink
                to="/admin"
                className="rounded-md p-2 text-brand-600 hover:bg-brand-50 md:hidden"
                aria-label="系统管理"
                title="系统管理"
              >
                <ShieldCheck className="h-5 w-5" />
              </NavLink>
            )}
            <NavLink
              to="/settings"
              className="rounded-md p-2 text-[#606266] hover:bg-[#F5F7FA] md:hidden"
              aria-label="设置"
            >
              <Settings className="h-5 w-5" />
            </NavLink>

            <button
              type="button"
              onClick={toggleDark}
              title={isDark ? '切换至浅色模式' : '切换至黑夜模式'}
              aria-label={isDark ? '切换至浅色模式' : '切换至黑夜模式'}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#E4E7ED] bg-[#F9FAFC] text-[#606266] transition hover:border-brand-400 hover:bg-[#F5F7FA] hover:text-brand-600"
            >
              {isDark ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>

            {!isStandalonePwa && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleInstallClick()}
                icon={<Smartphone className="h-3.5 w-3.5 md:hidden" />}
                className="hidden sm:inline-flex"
              >
                <Download className="hidden h-3.5 w-3.5 md:inline" />
                {canInstallPwa ? '安装桌面端' : '添加到桌面'}
              </Button>
            )}

            <div className="flex items-center gap-1.5 rounded-md border border-[#E4E7ED] bg-[#F9FAFC] px-2 py-1 sm:gap-2 sm:px-2.5 sm:py-1.5">
              <div className="hidden text-right sm:block">
                <div className="max-w-[96px] truncate text-xs font-bold text-[#303133]">
                  {user?.nickname || user?.username}
                </div>
              </div>
              <span className="hidden sm:inline-flex">
                <Badge tone={user?.role === 'admin' ? 'brand' : 'neutral'}>
                  {user?.role === 'admin' ? '管理员' : '成员'}
                </Badge>
              </span>
              <button
                type="button"
                onClick={logout}
                title="退出登录"
                aria-label="退出登录"
                className="rounded p-1 text-[#606266] transition hover:bg-slate-200/70 hover:text-rose-600"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* 第二行：桌面水平主导航条 */}
        <div className="hidden border-t border-[#F0F2F5] bg-white md:block">
          <div className="mx-auto flex max-w-[1200px] items-center justify-between px-4 sm:px-6">
            <nav className="flex items-center gap-1">
              {DESKTOP_NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `relative px-4 py-2.5 text-sm transition ${
                      isActive
                        ? 'font-bold text-brand-600 after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t-full after:bg-brand-600'
                        : 'font-medium text-[#303133] hover:text-brand-600'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
              {user?.role === 'admin' && (
                <NavLink
                  to="/admin"
                  className={({ isActive }) =>
                    `relative px-4 py-2.5 text-sm transition ${
                      isActive
                        ? 'font-bold text-brand-600 after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t-full after:bg-brand-600'
                        : 'font-medium text-[#303133] hover:text-brand-600'
                    }`
                  }
                >
                  系统管理
                </NavLink>
              )}
              {activeAiJobs > 0 && (
                <Link
                  to="/import?tab=ai-jobs"
                  className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200 transition hover:bg-indigo-100"
                >
                  <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-600" />
                  <span>转换中 {activeAiJobs}</span>
                </Link>
              )}
            </nav>

            <div className="flex items-center gap-2 text-xs text-[#909399]">
              <span>支持 Excel / Word 免 AI 标准直导 & AI 智能清洗</span>
            </div>
          </div>
        </div>

        {pwaHint && (
          <div className="border-t border-brand-200 bg-brand-50 px-4 py-2 text-center text-xs text-brand-900">
            <span>{pwaHint}</span>
            <button
              type="button"
              onClick={() => setPwaHint('')}
              className="ml-3 font-semibold underline"
            >
              知道了
            </button>
          </div>
        )}
      </header>

      {/* 主内容居中大画布 */}
      <main className="mx-auto max-w-[1200px] px-3 py-3.5 pb-24 sm:px-6 sm:py-5 md:pb-10">{children}</main>

      {/* 移动端底部安全区导航栏 */}
      <nav className="no-print pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-[#E4E7ED] bg-white/95 backdrop-blur-md md:hidden">
        <div className="grid grid-cols-5">
          {MOBILE_TABS.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex min-h-[54px] flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] font-semibold transition active:scale-95 ${
                    isActive ? 'text-brand-600' : 'text-[#606266]'
                  }`
                }
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
