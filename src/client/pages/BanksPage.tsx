import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  BookOpen,
  Globe,
  Lock,
  Copy,
  Trash2,
  Play,
  Search,
  FileUp,
  Share2,
  KeyRound,
  LogOut,
} from 'lucide-react';
import type { QuestionBankSummary } from '../../shared/types.js';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
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
  Tabs,
} from '../components/ui';

export const BanksPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const rawScope = searchParams.get('scope');
  const scope: 'mine' | 'shared' | 'public' =
    rawScope === 'public' ? 'public' : rawScope === 'shared' ? 'shared' : 'mine';
  const urlQuery = searchParams.get('q') || '';

  const [banks, setBanks] = useState<QuestionBankSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(urlQuery);
  const [selectedCategory, setSelectedCategory] = useState('全部');
  const [showCreate, setShowCreate] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('计算机与运维');
  const [newDesc, setNewDesc] = useState('');
  const [newVisibility, setNewVisibility] = useState<'private' | 'public'>('private');
  const [creating, setCreating] = useState(false);
  const [cloningId, setCloningId] = useState<string | null>(null);

  // 分享码加入私密题库弹窗
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinError, setJoinError] = useState('');
  const [joiningShare, setJoiningShare] = useState(false);

  const fetchBanks = async (currentScope: string, q: string) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ scope: currentScope });
      if (q.trim()) qs.set('q', q.trim());
      const res = await apiFetch<{ banks: QuestionBankSummary[] }>(`/api/banks?${qs.toString()}`);
      setBanks(res.banks);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setKeyword(urlQuery);
    setSelectedCategory('全部');
    void fetchBanks(scope, urlQuery);
  }, [scope, urlQuery]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const b of banks) {
      if (b.category && b.category.trim()) {
        set.add(b.category.trim());
      }
    }
    return ['全部', ...Array.from(set)];
  }, [banks]);

  const filteredBanks = useMemo(() => {
    if (selectedCategory === '全部') return banks;
    return banks.filter((b) => (b.category || '').trim() === selectedCategory);
  }, [banks, selectedCategory]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<{ id: string }>('/api/banks', {
        method: 'POST',
        json: {
          title: newTitle.trim(),
          category: newCategory.trim() || '默认分类',
          description: newDesc.trim(),
          visibility: newVisibility,
        },
      });
      setShowCreate(false);
      setNewTitle('');
      setNewDesc('');
      navigate(`/banks/${res.id}`);
    } finally {
      setCreating(false);
    }
  };

  const handleClone = async (id: string) => {
    setCloningId(id);
    try {
      const res = await apiFetch<{ id: string }>(`/api/banks/${id}/clone`, { method: 'POST' });
      navigate(`/banks/${res.id}`);
    } finally {
      setCloningId(null);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!window.confirm(`确定要删除题库「${title}」吗？题库内所有试题也会一并删除且不可恢复。`)) {
      return;
    }
    await apiFetch(`/api/banks/${id}`, { method: 'DELETE' });
    void fetchBanks(scope, keyword);
  };

  const handleLeaveShared = async (id: string, title: string) => {
    if (!user) return;
    if (!window.confirm(`确定退出私密分享题库「${title}」吗？`)) {
      return;
    }
    await apiFetch(`/api/banks/${id}/shares/${user.id}`, { method: 'DELETE' });
    void fetchBanks(scope, keyword);
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setJoiningShare(true);
    setJoinError('');
    try {
      const res = await apiFetch<{ bankId: string }>('/api/banks/share/join', {
        method: 'POST',
        json: {
          shareCode: joinCode.trim().toUpperCase(),
          password: joinPassword.trim(),
        },
      });
      setShowJoinModal(false);
      setJoinCode('');
      setJoinPassword('');
      navigate(`/banks/${res.bankId}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : '加入私密题库失败');
    } finally {
      setJoiningShare(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="题库中心"
        description="管理您的专属私有题库、查看好友私密分享题库，或探索并克隆团队公开共享题库"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<KeyRound className="h-3.5 w-3.5 text-indigo-600" />}
              onClick={() => {
                setJoinError('');
                setShowJoinModal(true);
              }}
            >
              分享码加入
            </Button>
            <Button
              variant="outline"
              icon={<FileUp className="h-3.5 w-3.5" />}
              onClick={() => navigate('/import?tab=standard-doc')}
            >
              Excel / Word 导题
            </Button>
            <Button icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setShowCreate(true)}>
              新建题库
            </Button>
          </>
        }
      />

      {/* 棱题 · PrismQ 分类筛选与搜索面板 */}
      <Card padding="md" className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            activeKey={scope}
            onChange={(k) => {
              const next: Record<string, string> = { scope: k };
              if (keyword.trim()) next.q = keyword.trim();
              setSearchParams(next);
            }}
            items={[
              { key: 'mine', label: '我的题库' },
              { key: 'shared', label: '好友分享给我' },
              { key: 'public', label: '公共题库广场' },
            ]}
          />

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void fetchBanks(scope, keyword);
            }}
            className="flex w-full max-w-xs gap-2"
          >
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#909399]" />
              <input
                type="text"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索题库名称或简介..."
                className={`${INPUT_CLS} pl-8`}
              />
            </div>
            <Button type="submit" variant="secondary">
              筛选
            </Button>
          </form>
        </div>

        {/* 动态分类胶囊条 */}
        {categories.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[#F0F2F5] pt-3 text-xs">
            <span className="font-semibold text-[#606266]">题库分类：</span>
            {categories.map((cat) => {
              const active = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-[4px] px-3 py-1 font-medium transition ${
                    active
                      ? 'bg-brand-50 font-semibold text-brand-600'
                      : 'text-[#606266] hover:bg-[#F5F7FA] hover:text-brand-600'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* 棱题 · PrismQ 清晰列表行视图 */}
      {loading ? (
        <div className="py-16 text-center text-sm text-[#606266]">正在加载题库列表...</div>
      ) : filteredBanks.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-10 w-10" />}
          title={
            scope === 'mine'
              ? '当前筛选下暂无个人题库'
              : scope === 'shared'
                ? '暂无好友向您私密分享的题库'
                : '暂无匹配的公共题库'
          }
          description={
            scope === 'shared'
              ? '可点击右上角「分享码加入」输入好友发送的分享码与口令，或请对方在题库详情中定向授权您的账号'
              : '点击下方按钮创建新题库、导入 Excel/Word 文档，或浏览公共广场'
          }
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {scope === 'shared' ? (
                <Button onClick={() => setShowJoinModal(true)}>分享码加入</Button>
              ) : (
                <>
                  <Button onClick={() => setShowCreate(true)}>新建题库</Button>
                  <Button
                    variant="outline"
                    onClick={() => navigate('/import?tab=standard-doc')}
                  >
                    Excel / Word 导题
                  </Button>
                </>
              )}
              {scope !== 'public' && (
                <Button
                  variant="secondary"
                  onClick={() => setSearchParams({ scope: 'public' })}
                >
                  逛逛公共广场
                </Button>
              )}
            </div>
          }
        />
      ) : (
        <Card padding="none" className="divide-y divide-[#F0F2F5] overflow-hidden">
          {filteredBanks.map((b) => {
            const isOwner = b.ownerId === user?.id || user?.role === 'admin';
            const pct =
              b.questionCount > 0 ? Math.round((b.practicedCount / b.questionCount) * 100) : 0;

            return (
              <div
                key={b.id}
                className="flex flex-col justify-between gap-4 px-5 py-4 transition hover:bg-[#FAFBFD] md:flex-row md:items-center"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="shrink-0 rounded-[4px] bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white">
                      {b.category || '题库'}
                    </span>
                    <Link
                      to={`/banks/${b.id}`}
                      className="truncate text-base font-bold text-[#303133] transition hover:text-brand-600"
                    >
                      {b.title}
                    </Link>
                    <Badge tone={b.visibility === 'public' ? 'success' : 'neutral'}>
                      {b.visibility === 'public' ? (
                        <>
                          <Globe className="h-3 w-3" /> 公开共享
                        </>
                      ) : (
                        <>
                          <Lock className="h-3 w-3" /> 个人私有
                        </>
                      )}
                    </Badge>
                    {b.visibility === 'private' && b.sharedWithMe && (
                      <Badge tone="ai">
                        <Share2 className="h-3 w-3" /> 好友私密分享
                      </Badge>
                    )}
                    {b.visibility === 'private' &&
                      b.ownerId === user?.id &&
                      (Boolean(b.shareEnabled) || (b.sharedUserCount ?? 0) > 0) && (
                        <Badge tone="ai">
                          <Share2 className="h-3 w-3" /> 已私密分享
                          {(b.sharedUserCount ?? 0) > 0 ? ` (${b.sharedUserCount}人)` : ''}
                        </Badge>
                      )}
                  </div>

                  {b.description && (
                    <p className="mt-1 line-clamp-1 text-xs text-[#606266]">{b.description}</p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[#606266] tabular-nums">
                    <span>
                      共 <strong className="text-[#303133]">{b.questionCount}</strong> 题
                    </span>
                    <span>{b.chapterCount} 章节</span>
                    <span>已练 {pct}%</span>
                    {b.mistakeCount > 0 && (
                      <span className="font-semibold text-rose-600">错题 {b.mistakeCount}</span>
                    )}
                    {b.visibility === 'public' && <span>克隆 {b.cloneCount} 次</span>}
                    <span className="text-[#909399]">创建者：{b.ownerName}</span>
                  </div>

                  <div className="mt-2.5 h-1.5 max-w-md overflow-hidden rounded-full bg-[#EBEEF5]">
                    <div
                      className="h-full rounded-full bg-brand-600 transition-all"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                  {!isOwner && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={cloningId === b.id}
                      icon={cloningId !== b.id ? <Copy className="h-3 w-3" /> : undefined}
                      onClick={() => void handleClone(b.id)}
                    >
                      克隆
                    </Button>
                  )}
                  {b.sharedWithMe && b.ownerId !== user?.id && (
                    <button
                      type="button"
                      onClick={() => void handleLeaveShared(b.id, b.title)}
                      title="退出分享"
                      aria-label="退出分享"
                      className="rounded-md p-1.5 text-[#909399] transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <LogOut className="h-4 w-4" />
                    </button>
                  )}
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void handleDelete(b.id, b.title)}
                      title="删除题库"
                      aria-label="删除题库"
                      className="rounded-md p-1.5 text-[#909399] transition hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      )}

      <Modal open={showJoinModal} onClose={() => setShowJoinModal(false)} title="通过分享码加入私密题库">
        <form onSubmit={handleJoinByCode} className="space-y-4">
          {joinError && <Alert tone="error">{joinError}</Alert>}
          <div>
            <label className={LABEL_CLS}>8 位私密分享码</label>
            <input
              type="text"
              required
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="例如：AB34XY78"
              className={`${INPUT_CLS} font-mono uppercase`}
            />
          </div>
          <div>
            <label className={LABEL_CLS}>访问口令（若创建者未设置口令可留空）</label>
            <input
              type="password"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              placeholder="可选：输入分享访问口令"
              className={INPUT_CLS}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowJoinModal(false)}>
              取消
            </Button>
            <Button type="submit" loading={joiningShare}>
              验证并加入
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="新建题库">
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className={LABEL_CLS}>题库名称</label>
            <input
              type="text"
              required
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="例如：2026 软考高项核心真题库"
              className={INPUT_CLS}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS}>分类标签</label>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="如：考公/财会/运维"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>可见性</label>
              <select
                value={newVisibility}
                onChange={(e) => setNewVisibility(e.target.value as 'private' | 'public')}
                className={`${SELECT_CLS} w-full`}
              >
                <option value="private">个人私有</option>
                <option value="public">公开到公共广场</option>
              </select>
            </div>
          </div>
          <div>
            <label className={LABEL_CLS}>简介说明</label>
            <textarea
              rows={3}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="可选，简要说明适用科目或来源"
              className={TEXTAREA_CLS}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>
              取消
            </Button>
            <Button type="submit" loading={creating}>
              创建并进入
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
