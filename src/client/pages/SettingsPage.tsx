import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  Shield,
  Sliders,
  KeyRound,
  Trash2,
  RefreshCw,
  Lock,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme, type ThemeMode } from '../lib/theme';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  INPUT_CLS,
  LABEL_CLS,
  PageHeader,
} from '../components/ui';

export const SettingsPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { theme, setTheme, isDark } = useTheme();
  const isAdmin = user?.role === 'admin';

  // 个人学习与个人 AI 配置
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [removeAfterCorrectCount, setRemoveAfterCorrectCount] = useState(
    user?.settings.removeAfterCorrectCount ?? 3
  );
  const [autoNextOnCorrect, setAutoNextOnCorrect] = useState(
    user?.settings.autoNextOnCorrect ?? true
  );
  const [autoNextDelayMs, setAutoNextDelayMs] = useState(
    user?.settings.autoNextDelayMs ?? 650
  );
  const [switchAnimationMs, setSwitchAnimationMs] = useState(
    user?.settings.switchAnimationMs ?? 260
  );
  const [personalBaseUrl, setPersonalBaseUrl] = useState(
    user?.settings.aiConfig?.baseUrl || 'https://api.deepseek.com/v1'
  );
  const [personalModel, setPersonalModel] = useState(
    user?.settings.aiConfig?.model || 'deepseek-chat'
  );
  const [personalApiKey, setPersonalApiKey] = useState(user?.settings.aiConfig?.apiKey || '');
  const [savingPersonal, setSavingPersonal] = useState(false);
  const [personalNotice, setPersonalNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  // 系统全局 AI 配置（严格仅管理员渲染并请求）
  const [sysBaseUrl, setSysBaseUrl] = useState('https://api.deepseek.com/v1');
  const [sysModel, setSysModel] = useState('deepseek-chat');
  const [sysApiKey, setSysApiKey] = useState('');
  const [allowMemberUseSystemKey, setAllowMemberUseSystemKey] = useState(true);
  const [savingSys, setSavingSys] = useState(false);
  const [sysNotice, setSysNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  // 修改密码
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdNotice, setPwdNotice] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  // 测试连接与拉取模型
  const [testingScope, setTestingScope] = useState<'personal' | 'system' | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([
    'deepseek-chat',
    'deepseek-reasoner',
  ]);

  useEffect(() => {
    if (isAdmin) {
      void apiFetch<{
        aiConfig: {
          baseUrl: string;
          model: string;
          apiKey: string;
          allowMemberUseSystemKey: boolean;
        };
      }>('/api/auth/admin/ai-config').then((res) => {
        setSysBaseUrl(res.aiConfig.baseUrl || 'https://api.deepseek.com/v1');
        setSysModel(res.aiConfig.model || 'deepseek-chat');
        setSysApiKey(res.aiConfig.apiKey || '');
        setAllowMemberUseSystemKey(res.aiConfig.allowMemberUseSystemKey);
      });
    }
  }, [isAdmin]);

  const handleSavePersonal = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPersonal(true);
    setPersonalNotice(null);
    try {
      await apiFetch('/api/auth/settings', {
        method: 'PUT',
        json: {
          nickname,
          removeAfterCorrectCount,
          autoNextOnCorrect,
          autoNextDelayMs,
          switchAnimationMs,
          aiConfig: {
            baseUrl: personalBaseUrl,
            model: personalModel,
            apiKey: personalApiKey,
          },
        },
      });
      try {
        const rawLocal = localStorage.getItem('ksb_practice_prefs');
        const parsedLocal = rawLocal ? (JSON.parse(rawLocal) as Record<string, unknown>) : {};
        localStorage.setItem(
          'ksb_practice_prefs',
          JSON.stringify({
            ...parsedLocal,
            autoNext: autoNextOnCorrect,
            autoNextDelayMs,
            switchAnimationMs,
          })
        );
      } catch {
        // ignore storage errors
      }
      await refreshUser();
      setPersonalNotice({ tone: 'success', text: '个人学习偏好与接口设置已保存。' });
    } catch (err) {
      setPersonalNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '保存设置失败',
      });
    } finally {
      setSavingPersonal(false);
    }
  };

  const handleClearPersonalKey = async () => {
    await apiFetch('/api/auth/settings', {
      method: 'PUT',
      json: { clearPersonalAiKey: true },
    });
    setPersonalApiKey('');
    await refreshUser();
    setPersonalNotice({ tone: 'success', text: '已清除个人 API Key。' });
  };

  const handleSaveSystemAi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;
    setSavingSys(true);
    setSysNotice(null);
    try {
      await apiFetch('/api/auth/admin/ai-config', {
        method: 'PUT',
        json: {
          baseUrl: sysBaseUrl,
          model: sysModel,
          apiKey: sysApiKey,
          allowMemberUseSystemKey,
        },
      });
      await refreshUser();
      setSysNotice({ tone: 'success', text: '系统全局 AI 服务配置已更新并持久化。' });
    } catch (err) {
      setSysNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '更新系统配置失败',
      });
    } finally {
      setSavingSys(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPwd(true);
    setPwdNotice(null);
    try {
      await apiFetch('/api/auth/password', {
        method: 'PUT',
        json: { oldPassword, newPassword },
      });
      setOldPassword('');
      setNewPassword('');
      setPwdNotice({ tone: 'success', text: '登录密码已修改成功。' });
    } catch (err) {
      setPwdNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : '修改密码失败',
      });
    } finally {
      setSavingPwd(false);
    }
  };

  const handleTestConnection = async (scope: 'personal' | 'system') => {
    setTestingScope(scope);
    setTestResult(null);
    try {
      const payload =
        scope === 'personal'
          ? { scope: 'personal', baseUrl: personalBaseUrl, apiKey: personalApiKey, model: personalModel }
          : { scope: 'system', baseUrl: sysBaseUrl, apiKey: sysApiKey, model: sysModel };
      const res = await apiFetch<{
        ok: boolean;
        latencyMs: number;
        reply: string;
        endpoint: string;
      }>('/api/ai/test', {
        method: 'POST',
        json: payload,
      });
      setTestResult({
        ok: true,
        text: `连接成功：${res.endpoint}（耗时 ${res.latencyMs}ms，返回：${res.reply}）`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        text: err instanceof Error ? err.message : '连接测试失败',
      });
    } finally {
      setTestingScope(null);
    }
  };

  const handleFetchModels = async (scope: 'personal' | 'system') => {
    setFetchingModels(true);
    setTestResult(null);
    try {
      const payload =
        scope === 'personal'
          ? { scope: 'personal', baseUrl: personalBaseUrl, apiKey: personalApiKey }
          : { scope: 'system', baseUrl: sysBaseUrl, apiKey: sysApiKey };
      const res = await apiFetch<{ models: Array<{ id: string }> }>('/api/ai/models', {
        method: 'POST',
        json: payload,
      });
      const ids = Array.from(new Set(res.models.map((m) => m.id)));
      if (ids.length > 0) setAvailableModels(ids);
      setTestResult({
        ok: true,
        text: `已拉取 ${ids.length} 个可用模型（如 ${ids.slice(0, 5).join(', ')}），可在模型栏下拉选择。`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        text: err instanceof Error ? err.message : '拉取模型列表失败',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="系统设置"
        description="管理外观主题、个人学习偏好、密码安全与自定义 AI 接口配置"
      />

      {/* 外观与黑夜模式设置 */}
      <Card>
        <CardHeader
          icon={
            isDark ? (
              <Moon className="h-4 w-4 text-amber-400" />
            ) : (
              <Sun className="h-4 w-4 text-brand-600" />
            )
          }
          title="外观与黑夜模式"
          subtitle="主题偏好保存在本地浏览器中，刷新或重新打开后自动生效"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(
            [
              {
                key: 'light' as ThemeMode,
                label: '浅色模式',
                desc: '清晰明亮，适合白天与常规光线',
                icon: Sun,
              },
              {
                key: 'dark' as ThemeMode,
                label: '黑夜模式',
                desc: '深海护眼灰蓝，降低夜间用眼疲劳',
                icon: Moon,
              },
              {
                key: 'system' as ThemeMode,
                label: '跟随系统',
                desc: '随操作系统浅色 / 深色自动切换',
                icon: Monitor,
              },
            ]
          ).map((item) => {
            const Icon = item.icon;
            const active = theme === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setTheme(item.key)}
                className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                  active
                    ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-600/15'
                    : 'border-slate-200 bg-slate-50/70 hover:border-brand-300'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    active
                      ? 'bg-brand-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div
                    className={`text-xs font-bold ${
                      active ? 'text-brand-700' : 'text-slate-800'
                    }`}
                  >
                    {item.label}
                  </div>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                    {item.desc}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* 个人设置与个人 AI 覆盖 */}
      <Card>
        <CardHeader
          icon={<Sliders className="h-4 w-4 text-brand-600" />}
          title="个人学习偏好与自定义 AI 接口"
          subtitle="自定义错题自动移出规则与个人专属 API Key"
        />

        <form onSubmit={handleSavePersonal} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>显示昵称</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>错题连续答对几次后自动移出错题本</label>
              <input
                type="number"
                min={1}
                max={20}
                value={removeAfterCorrectCount}
                onChange={(e) => setRemoveAfterCorrectCount(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={autoNextOnCorrect}
              onChange={(e) => setAutoNextOnCorrect(e.target.checked)}
            />
            刷题答对后自动延迟跳转到下一题
          </label>

          <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>切题滑入动画速度</span>
                <span className="font-bold text-brand-600 tabular-nums">
                  {switchAnimationMs === 0 ? '关闭' : `${switchAnimationMs}ms`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={600}
                step={20}
                value={switchAnimationMs}
                onChange={(e) => setSwitchAnimationMs(Number(e.target.value))}
                className="w-full accent-brand-600"
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  { label: '关闭', ms: 0 },
                  { label: '极速', ms: 150 },
                  { label: '丝滑', ms: 260 },
                  { label: '舒缓', ms: 420 },
                ].map((p) => (
                  <button
                    key={p.ms}
                    type="button"
                    onClick={() => setSwitchAnimationMs(p.ms)}
                    className={`rounded border px-2 py-0.5 text-[11px] font-semibold transition ${
                      switchAnimationMs === p.ms
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {p.label} {p.ms}ms
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>答对自动切题延迟</span>
                <span className="font-bold text-brand-600 tabular-nums">{autoNextDelayMs}ms</span>
              </div>
              <input
                type="range"
                min={150}
                max={2500}
                step={50}
                disabled={!autoNextOnCorrect}
                value={autoNextDelayMs}
                onChange={(e) => setAutoNextDelayMs(Number(e.target.value))}
                className="w-full accent-brand-600 disabled:opacity-45"
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  { label: '极快', ms: 250 },
                  { label: '较快', ms: 450 },
                  { label: '标准', ms: 650 },
                  { label: '偏慢', ms: 1200 },
                ].map((p) => (
                  <button
                    key={p.ms}
                    type="button"
                    disabled={!autoNextOnCorrect}
                    onClick={() => setAutoNextDelayMs(p.ms)}
                    className={`rounded border px-2 py-0.5 text-[11px] font-semibold transition disabled:opacity-45 ${
                      autoNextDelayMs === p.ms
                        ? 'border-brand-600 bg-brand-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600'
                    }`}
                  >
                    {p.label} {p.ms}ms
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <KeyRound className="h-4 w-4 text-indigo-600" />
                个人 AI API 配置（可选）
              </span>
              {user?.hasPersonalAiKey && (
                <button
                  type="button"
                  onClick={() => void handleClearPersonalKey()}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  清除个人 Key
                </button>
              )}
            </div>

            {!isAdmin && user?.systemAiAvailable && !user?.hasPersonalAiKey && (
              <p className="text-xs text-slate-600">
                当前系统已内置基础 AI 能力可直接使用；如果您需要使用自己的接口额度或指定模型，可在下方填写个人配置进行覆盖。
              </p>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>API Base URL</label>
                <input
                  type="text"
                  value={personalBaseUrl}
                  onChange={(e) => setPersonalBaseUrl(e.target.value)}
                  placeholder="https://api.deepseek.com/v1"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>模型名称</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={personalModel}
                    onChange={(e) => setPersonalModel(e.target.value)}
                    list="personal-ai-models"
                    className={`${INPUT_CLS} min-w-0 flex-1`}
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    loading={fetchingModels}
                    onClick={() => void handleFetchModels('personal')}
                    icon={!fetchingModels ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
                    className="shrink-0"
                  >
                    拉取模型
                  </Button>
                </div>
                <datalist id="personal-ai-models">
                  {availableModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>个人 API Key（sk-...）</label>
              <input
                type="password"
                value={personalApiKey}
                onChange={(e) => setPersonalApiKey(e.target.value)}
                placeholder="请输入您个人的 API Key（不会对其他成员展示）"
                className={INPUT_CLS}
              />
            </div>

            <div className="pt-1">
              <Button
                variant="secondary"
                size="sm"
                loading={testingScope === 'personal'}
                onClick={() => void handleTestConnection('personal')}
                icon={testingScope !== 'personal' ? <Sparkles className="h-3.5 w-3.5" /> : undefined}
              >
                测试个人配置连通性
              </Button>
            </div>
          </div>

          {personalNotice && (
            <Alert tone={personalNotice.tone}>{personalNotice.text}</Alert>
          )}

          <Button type="submit" loading={savingPersonal}>
            保存个人设置
          </Button>
        </form>
      </Card>

      {testResult && (
        <Alert tone={testResult.ok ? 'success' : 'error'}>{testResult.text}</Alert>
      )}

      {/* 仅管理员可见：全局 AI 服务配置 */}
      {isAdmin && (
        <Card>
          <CardHeader
            icon={<Shield className="h-4 w-4 text-amber-600" />}
            title="管理员专享 · 全局 AI 服务配置"
            subtitle="此配置仅管理员可见与修改，普通成员无法查看全局接口地址、密钥或模型名"
          />

          <form onSubmit={handleSaveSystemAi} className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS}>全局 Base URL</label>
                <input
                  type="text"
                  value={sysBaseUrl}
                  onChange={(e) => setSysBaseUrl(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>全局默认模型</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={sysModel}
                    onChange={(e) => setSysModel(e.target.value)}
                    list="system-ai-models"
                    className={`${INPUT_CLS} min-w-0 flex-1`}
                  />
                  <Button
                    variant="secondary"
                    size="md"
                    loading={fetchingModels}
                    onClick={() => void handleFetchModels('system')}
                    icon={!fetchingModels ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
                    className="shrink-0"
                  >
                    拉取模型
                  </Button>
                </div>
                <datalist id="system-ai-models">
                  {availableModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
            </div>

            <div>
              <label className={LABEL_CLS}>全局 API Key</label>
              <input
                type="password"
                value={sysApiKey}
                onChange={(e) => setSysApiKey(e.target.value)}
                placeholder="输入 sk-... 密钥"
                className={INPUT_CLS}
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
              <input
                type="checkbox"
                checked={allowMemberUseSystemKey}
                onChange={(e) => setAllowMemberUseSystemKey(e.target.checked)}
              />
              允许普通成员在未填个人 Key 时使用系统内置 AI 能力（不暴露上游地址与真实模型名）
            </label>

            {sysNotice && <Alert tone={sysNotice.tone}>{sysNotice.text}</Alert>}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={savingSys}>
                保存全局 AI 配置
              </Button>
              <Button
                variant="secondary"
                loading={testingScope === 'system'}
                onClick={() => void handleTestConnection('system')}
                icon={testingScope !== 'system' ? <Sparkles className="h-3.5 w-3.5" /> : undefined}
              >
                测试全局接口连通性
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* 账户密码安全 */}
      <Card>
        <CardHeader
          icon={<Lock className="h-4 w-4 text-slate-600" />}
          title="账户安全 · 修改登录密码"
        />
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>原密码</label>
              <input
                type="password"
                required
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>新密码（至少 6 位）</label>
              <input
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={INPUT_CLS}
              />
            </div>
          </div>
          {pwdNotice && <Alert tone={pwdNotice.tone}>{pwdNotice.text}</Alert>}
          <Button type="submit" variant="secondary" loading={savingPwd}>
            更新密码
          </Button>
        </form>
      </Card>
    </div>
  );
};
