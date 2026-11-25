import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, BookOpen } from 'lucide-react';
import { QUESTION_TYPE_LABELS, type QuestionItem } from '../../shared/types.js';
import { apiFetch } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  INPUT_CLS,
  PageHeader,
} from '../components/ui';

type SearchResultItem = QuestionItem & { bankTitle?: string };

function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.trim().toLowerCase() ? (
          <mark key={i} className="rounded bg-amber-200 px-0.5 text-slate-900">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

export const SearchPage: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  const [query, setQuery] = useState(initialQ);
  const [submittedQuery, setSubmittedQuery] = useState(initialQ);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);

  const runSearch = async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch<{ items: SearchResultItem[] }>(
        `/api/practice/search?q=${encodeURIComponent(trimmed)}`
      );
      setItems(res.items);
      setSubmittedQuery(trimmed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQ.trim()) {
      setQuery(initialQ);
      void runSearch(initialQ);
    }
  }, [initialQ]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchParams(query.trim() ? { q: query.trim() } : {});
    void runSearch(query);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="全局精准搜题"
        description="支持跨所有私有题库与公共共享题库即时检索题干、选项、答案及解析内容"
      />

      <Card padding="sm">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="请输入题目关键词、命令或选项片段..."
              className={`${INPUT_CLS} h-10 pl-9`}
            />
          </div>
          <Button type="submit" size="lg" loading={loading} icon={!loading ? <Search className="h-4 w-4" /> : undefined}>
            搜题
          </Button>
        </form>
      </Card>

      {submittedQuery && !loading && (
        <div className="text-xs text-slate-600 tabular-nums">
          关键词「<span className="font-bold text-slate-900">{submittedQuery}</span>」共匹配{' '}
          <span className="font-bold text-brand-700">{items.length}</span> 道试题
        </div>
      )}

      {items.length > 0 ? (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id}>
              <div className="mb-2.5 flex flex-wrap items-center gap-2">
                <Badge tone="brand">{QUESTION_TYPE_LABELS[item.type]}</Badge>
                {item.bankTitle && (
                  <Link
                    to={`/banks/${item.bankId}`}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:text-brand-700"
                  >
                    <BookOpen className="h-3 w-3" />
                    {item.bankTitle}
                  </Link>
                )}
                {item.chapterTitle && <Badge tone="neutral">{item.chapterTitle}</Badge>}
              </div>

              <div className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-900">
                <HighlightText text={item.stem} query={submittedQuery} />
              </div>

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
                      {opt.key}. <HighlightText text={opt.content} query={submittedQuery} />
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 border-t border-slate-100 pt-2.5 text-xs">
                <div className="font-bold text-emerald-700">
                  标准答案：
                  {item.type === 'boolean'
                    ? item.answer === 'A'
                      ? '正确'
                      : '错误'
                    : item.answer}
                </div>
                {item.explanation && (
                  <div className="mt-1 text-slate-600">
                    解析：<HighlightText text={item.explanation} query={submittedQuery} />
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        submittedQuery &&
        !loading && (
          <EmptyState
            icon={<Search className="h-9 w-9" />}
            title={`没有找到包含「${submittedQuery}」的题目`}
            description="可以尝试缩短或更换关键词再次检索"
          />
        )
      )}
    </div>
  );
};
