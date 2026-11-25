import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  Bookmark,
  StickyNote,
  Play,
  Printer,
  Trash2,
  CheckCircle2,
} from 'lucide-react';
import {
  QUESTION_TYPE_LABELS,
  type QuestionBankSummary,
  type QuestionItem,
} from '../../shared/types.js';
import { apiFetch } from '../lib/api';
import { PrintModal } from '../components/PrintModal';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLS,
  PageHeader,
  SELECT_CLS,
  Tabs,
} from '../components/ui';

type MistakeRow = QuestionItem & { bankTitle?: string };

export const MistakesPage: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'mistakes' | 'favorites' | 'notes'>('mistakes');
  const [items, setItems] = useState<MistakeRow[]>([]);
  const [threshold, setThreshold] = useState(3);
  const [banks, setBanks] = useState<QuestionBankSummary[]>([]);
  const [bankId, setBankId] = useState('');
  const [type, setType] = useState('');
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPrint, setShowPrint] = useState(false);

  const loadList = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ tab });
      if (bankId) qs.set('bankId', bankId);
      if (type) qs.set('type', type);
      if (keyword.trim()) qs.set('q', keyword.trim());
      const res = await apiFetch<{ items: MistakeRow[]; removeThreshold: number }>(
        `/api/practice/mistakes?${qs.toString()}`
      );
      setItems(res.items);
      setThreshold(res.removeThreshold || 3);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void apiFetch<{ banks: QuestionBankSummary[] }>('/api/banks?scope=all').then((r) =>
      setBanks(r.banks)
    );
  }, []);

  useEffect(() => {
    void loadList();
  }, [tab, bankId, type]);

  const handleRemoveMistake = async (questionId: string) => {
    await apiFetch(`/api/practice/mistakes/${questionId}`, { method: 'DELETE' });
    setItems((prev) => prev.filter((item) => item.id !== questionId));
  };

  const practiceTargetBank = bankId || 'all';
  const practiceMode = tab === 'favorites' ? 'favorites' : 'mistakes';

  return (
    <div className="space-y-5">
      <PageHeader
        title="错题本 · 收藏夹 · 笔记中心"
        description={`自动归集历史错题，连续答对 ${threshold} 次自动移出（可在系统设置中修改阈值）`}
        actions={
          items.length > 0 ? (
            <>
              <Button
                variant="secondary"
                icon={<Printer className="h-3.5 w-3.5" />}
                onClick={() => setShowPrint(true)}
              >
                打印{tab === 'favorites' ? '收藏' : '错题'}讲义
              </Button>
              <Button
                variant="danger"
                icon={<Play className="h-3.5 w-3.5" />}
                onClick={() => navigate(`/practice/${practiceTargetBank}?mode=${practiceMode}`)}
              >
                专项消灭重练 ({items.length})
              </Button>
            </>
          ) : undefined
        }
      />

      <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'mistakes', label: '错题本', icon: <AlertCircle className="h-3.5 w-3.5" /> },
            { key: 'favorites', label: '收藏夹', icon: <Bookmark className="h-3.5 w-3.5" /> },
            { key: 'notes', label: '个人笔记', icon: <StickyNote className="h-3.5 w-3.5" /> },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={bankId}
            onChange={(e) => setBankId(e.target.value)}
            className={`${SELECT_CLS} h-8 text-xs`}
          >
            <option value="">全部题库</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>

          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={`${SELECT_CLS} h-8 text-xs`}
          >
            <option value="">全部题型</option>
            {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void loadList();
            }}
            className="flex gap-1.5"
          >
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜关键词..."
              className={`${INPUT_CLS} h-8 w-36 text-xs`}
            />
            <Button type="submit" size="sm" variant="secondary">
              筛选
            </Button>
          </form>
        </div>
      </Card>

      {loading ? (
        <div className="py-16 text-center text-sm text-slate-500">正在加载...</div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-10 w-10 text-emerald-400" />}
          title={
            tab === 'mistakes'
              ? '当前没有待消灭的错题'
              : tab === 'favorites'
                ? '暂无收藏的题目'
                : '暂无记录个人笔记的题目'
          }
          description="在刷题页面可以随时点击收藏或添加个人备考笔记"
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="brand">{QUESTION_TYPE_LABELS[item.type]}</Badge>
                  {item.bankTitle && <Badge tone="neutral">{item.bankTitle}</Badge>}
                  {item.record && item.record.wrongCount > 0 && (
                    <Badge tone="danger">
                      错 {item.record.wrongCount} 次 · 已连对 {item.record.consecutiveCorrect}/{threshold}
                    </Badge>
                  )}
                </div>

                {tab === 'mistakes' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 className="h-3.5 w-3.5" />}
                    onClick={() => void handleRemoveMistake(item.id)}
                  >
                    标为已掌握移出
                  </Button>
                )}
              </div>

              <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-900">
                {item.stem}
              </p>

              {item.options.length > 0 && (
                <div className="mt-2.5 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
                  {item.options.map((opt) => (
                    <div
                      key={opt.key}
                      className={`rounded-lg border px-3 py-1.5 ${
                        item.answer.includes(opt.key)
                          ? 'border-emerald-200 bg-emerald-50 font-semibold text-emerald-800'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      {opt.key}. {opt.content}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 space-y-1 border-t border-slate-100 pt-2.5 text-xs">
                <div className="font-bold text-emerald-700">
                  标准答案：
                  {item.type === 'boolean'
                    ? item.answer === 'A'
                      ? '正确'
                      : '错误'
                    : item.answer}
                </div>
                {item.explanation && (
                  <div className="text-slate-600">解析：{item.explanation}</div>
                )}
                {item.record?.note && (
                  <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-amber-900">
                    我的笔记：{item.record.note}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <PrintModal
        open={showPrint}
        onClose={() => setShowPrint(false)}
        title={tab === 'favorites' ? '棱题 · PrismQ · 收藏题集讲义' : '棱题 · PrismQ · 错题复盘讲义'}
        questions={items}
      />
    </div>
  );
};
