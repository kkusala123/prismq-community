import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Sparkles,
  FileUp,
  ShieldCheck,
  ArrowRight,
  UserCheck,
  Moon,
  Sun,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme } from '../lib/theme';
import { PrismQLogo } from '../components/PrismQLogo';
import { Alert, Button, INPUT_CLS, LABEL_CLS } from '../components/ui';

export const AuthPage: React.FC = () => {
  const { login, register } = useAuth();
  const { isDark, toggleDark } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [checkingSetup, setCheckingSetup] = useState(true);

  const [account, setAccount] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<{ needsSetup: boolean; allowRegistration?: boolean }>('/api/auth/bootstrap-status')
      .then((res) => {
        if (res.needsSetup) {
          setNeedsSetup(true);
          setAllowRegistration(true);
          setTab('register');
        } else {
          const canReg = res.allowRegistration !== false;
          setAllowRegistration(canReg);
          if (!canReg) setTab('login');
        }
      })
      .catch(() => undefined)
      .finally(() => setCheckingSetup(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (tab === 'login') {
        await login(account, password);
      } else {
        await register({ username, email, password, nickname });
      }
      const rawRedirect = searchParams.get('redirect') || '';
      const safeTarget =
        rawRedirect.startsWith('/') && !rawRedirect.startsWith('//') ? rawRedirect : '/';
      navigate(safeTarget);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请检查输入');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-[100dvh] items-center justify-center bg-[#F7F8FA] px-4 py-10">
      <button
        type="button"
        onClick={toggleDark}
        title={isDark ? '切换至浅色模式' : '切换至黑夜模式'}
        aria-label={isDark ? '切换至浅色模式' : '切换至黑夜模式'}
        className="fixed right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-card transition hover:border-brand-400 hover:text-brand-600"
      >
        {isDark ? (
          <Sun className="h-3.5 w-3.5 text-amber-400" />
        ) : (
          <Moon className="h-3.5 w-3.5" />
        )}
        <span>{isDark ? '浅色模式' : '黑夜模式'}</span>
      </button>
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-[#E6E9EF] bg-white shadow-card-hover lg:grid-cols-2">
        {/* 左侧极简深墨黑品牌面板 */}
        <div className="flex flex-col justify-between bg-[#0F172A] p-8 text-white sm:p-10">
          <div>
            <div className="inline-flex items-center gap-2.5 rounded-xl bg-white/10 px-3.5 py-2 backdrop-blur-sm">
              <PrismQLogo className="h-6 w-6 shrink-0" />
              <span className="text-base font-bold tracking-tight">棱题 · PrismQ</span>
            </div>
            <h1 className="mt-6 text-2xl font-bold leading-snug sm:text-3xl">
              私有部署智能题库与在线测评平台
            </h1>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">
              标准化题库清洗校验、全模式高效刷题背题、智能错题消融与多角色组织在线考场，安全托管于你的专属 PostgreSQL 服务器。
            </p>
          </div>

          <div className="mt-8 space-y-3.5 text-sm text-slate-300">
            <div className="flex items-start gap-3">
              <FileUp className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              <span>支持 Word / PDF / Excel / TXT / GIFT / Aiken 标准化导题与实时校验纠错</span>
            </div>
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              <span>AI 驱动杂乱试卷结构化清洗、按主题出题、深度讲题与举一反三</span>
            </div>
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-300" />
              <span>支持口令控制、防切屏监测、自动阅卷、排行榜与错题自动回流复盘</span>
            </div>
          </div>
        </div>

        {/* 右侧表单区 */}
        <div className="p-8 sm:p-10">
          {needsSetup && !checkingSetup && (
            <Alert tone="info" className="mb-5">
              <div className="flex items-center gap-1.5 font-semibold">
                <UserCheck className="h-4 w-4 shrink-0" />
                <span>系统首次初始化：请创建首位管理员账号</span>
              </div>
              <p className="mt-0.5 text-[11px] opacity-90">
                系统当前无任何用户，您注册的第一个账号将自动成为系统管理员（admin）。
              </p>
            </Alert>
          )}

          {!needsSetup && allowRegistration && (
            <div className="mb-6 flex rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setError('');
                }}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                  tab === 'login' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                账号登录
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab('register');
                  setError('');
                }}
                className={`flex-1 rounded-lg py-2 text-xs font-semibold transition ${
                  tab === 'register' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                注册新账号
              </button>
            </div>
          )}

          {!needsSetup && !allowRegistration && !checkingSetup && (
            <Alert tone="info" className="mb-5">
              系统管理员已关闭公开自助注册，请使用已分配账号登录，或联系管理员开通新账号。
            </Alert>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {tab === 'login' ? (
              <div>
                <label className={LABEL_CLS}>用户名或邮箱</label>
                <input
                  type="text"
                  required
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  placeholder="请输入用户名或邮箱"
                  className={INPUT_CLS}
                />
              </div>
            ) : (
              <>
                <div>
                  <label className={LABEL_CLS}>用户名（3~32 位字母、数字、下划线或短横线）</label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder={needsSetup ? '例如：admin' : '请输入用户名'}
                    className={INPUT_CLS}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className={LABEL_CLS}>邮箱地址</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@example.com"
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className={LABEL_CLS}>显示昵称</label>
                    <input
                      type="text"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      placeholder="可选，默认同用户名"
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <label className={LABEL_CLS}>登录密码（至少 6 位）</label>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
                className={INPUT_CLS}
              />
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            <Button
              type="submit"
              size="lg"
              loading={submitting}
              className="w-full"
              icon={!submitting ? <ArrowRight className="h-4 w-4" /> : undefined}
            >
              {tab === 'login'
                ? '立即登录'
                : needsSetup
                  ? '创建系统管理员账号'
                  : '注册并登录'}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
};
