import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Lock, Share2, BookOpen, ShieldCheck, ArrowRight, KeyRound } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { Alert, Badge, Button, Card, INPUT_CLS, LABEL_CLS } from '../components/ui';

interface SharedBankPreview {
  id: string;
  title: string;
  description: string;
  category: string;
  ownerName: string;
  visibility: 'private' | 'public';
  questionCount: number;
  requiresPassword: boolean;
  alreadyAccessible: boolean;
}

export const BankShareJoinPage: React.FC = () => {
  const { code = '' } = useParams<{ code: string }>();
  const navigate = useNavigate();

  const [preview, setPreview] = useState<SharedBankPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const normalized = code.trim().toUpperCase();
    if (!normalized) {
      setError('分享码为空或无效');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    apiFetch<{ bank: SharedBankPreview }>(`/api/banks/share/${encodeURIComponent(normalized)}`)
      .then((res) => setPreview(res.bank))
      .catch((err) => {
        setError(err instanceof Error ? err.message : '未找到该私密分享题库或分享已关闭');
      })
      .finally(() => setLoading(false));
  }, [code]);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview) return;
    if (preview.alreadyAccessible) {
      navigate(`/banks/${preview.id}`);
      return;
    }
    setJoining(true);
    setError('');
    try {
      const res = await apiFetch<{ bankId: string }>('/api/banks/share/join', {
        method: 'POST',
        json: {
          shareCode: code.trim().toUpperCase(),
          password: password.trim(),
        },
      });
      navigate(`/banks/${res.bankId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入私密分享失败');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg py-10">
      <Card padding="lg" className="space-y-5">
        {loading ? (
          <div className="py-10 text-center text-sm text-slate-500">
            正在核验私密题库分享码...
          </div>
        ) : !preview ? (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
              <Lock className="h-6 w-6" />
            </div>
            <h1 className="text-lg font-bold text-slate-900">无法访问该分享题库</h1>
            <Alert tone="error">{error || '分享链接已失效或创建者关闭了分享'}</Alert>
            <div className="pt-2">
              <Link
                to="/banks"
                className="inline-flex h-9 items-center rounded-md bg-brand-600 px-4 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                返回题库中心
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleJoin} className="space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{preview.category || '题库'}</Badge>
                  <Badge tone="neutral">
                    <Lock className="h-3 w-3" />
                    {preview.visibility === 'private' ? '私有题库 · 私密分享' : '公开共享'}
                  </Badge>
                </div>
                <h1 className="text-xl font-bold text-slate-900">{preview.title}</h1>
                <p className="text-xs text-slate-500">
                  分享自：<strong className="text-slate-700">{preview.ownerName}</strong> · 共{' '}
                  <strong className="text-slate-700">{preview.questionCount}</strong> 道题
                </p>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                <Share2 className="h-5 w-5" />
              </div>
            </div>

            {preview.description && (
              <p className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs leading-relaxed text-slate-600">
                {preview.description}
              </p>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50/70 p-3 text-xs text-brand-900">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <span>
                加入后可在您的「好友分享给我」中刷题、背题、查错题或克隆私人副本；原题库仍保持私有，不会出现在公共广场。
              </span>
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            {!preview.alreadyAccessible && preview.requiresPassword && (
              <div>
                <label className={LABEL_CLS}>
                  <span className="inline-flex items-center gap-1">
                    <KeyRound className="h-3.5 w-3.5 text-brand-600" />
                    请输入访问口令
                  </span>
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入创建者设置的私密访问口令"
                  className={INPUT_CLS}
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Link
                to="/banks?scope=shared"
                className="text-xs font-medium text-slate-500 hover:text-brand-600"
              >
                查看好友分享列表
              </Link>
              <Button
                type="submit"
                size="lg"
                loading={joining}
                icon={preview.alreadyAccessible ? <BookOpen className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
              >
                {preview.alreadyAccessible ? '您已有权限，立即查看' : '接受分享并查看题库'}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
};
