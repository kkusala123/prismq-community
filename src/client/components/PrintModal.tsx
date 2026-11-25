import React, { useState } from 'react';
import { Printer, X, FileText, BookOpen } from 'lucide-react';
import { QUESTION_TYPE_LABELS, type QuestionOption, type QuestionType } from '../../shared/types.js';

export interface PrintableQuestion {
  id: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation?: string;
  chapterTitle?: string;
}

interface PrintModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  questions: PrintableQuestion[];
}

export const PrintModal: React.FC<PrintModalProps> = ({
  open,
  onClose,
  title,
  subtitle,
  questions,
}) => {
  const [printMode, setPrintMode] = useState<'blank' | 'study'>('study');

  if (!open) return null;

  const formatAnswerText = (q: PrintableQuestion) => {
    if (q.type === 'boolean') {
      return q.answer === 'A' ? '正确' : q.answer === 'B' ? '错误' : q.answer;
    }
    return q.answer || '未设答案';
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/60 backdrop-blur-sm print:static print:bg-white">
      {/* 顶部控制栏：打印时隐藏 */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-bold text-slate-800">打印 / 导出 PDF 讲义预览</h3>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
            共 {questions.length} 题
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPrintMode('study')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              printMode === 'study'
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <BookOpen className="h-4 w-4" />
            背题讲义版（含解析）
          </button>
          <button
            type="button"
            onClick={() => setPrintMode('blank')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              printMode === 'blank'
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <FileText className="h-4 w-4" />
            空白考卷版（答案附后）
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <Printer className="h-4 w-4" />
            立即打印 / 另存 PDF
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* A4 纸张预览区域 */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-8 print:overflow-visible print:p-0">
        <div className="print-only-container mx-auto max-w-4xl rounded-xl border border-slate-200 bg-white p-8 shadow-lg sm:p-12">
          <div className="mb-8 border-b-2 border-slate-800 pb-4 text-center">
            <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            <p className="mt-2 text-xs text-slate-400">
              棱题 · PrismQ · {printMode === 'study' ? '背题讲义版' : '空白试卷版'} · 共 {questions.length} 题
            </p>
          </div>

          <div className="space-y-6">
            {questions.map((q, idx) => (
              <div key={q.id} className="print-break-inside-avoid border-b border-slate-100 pb-4 last:border-none">
                <div className="flex items-start gap-2 text-sm leading-relaxed text-slate-900">
                  <span className="font-bold text-slate-700">{idx + 1}.</span>
                  <div className="flex-1">
                    <span className="mr-2 inline-block rounded border border-slate-300 px-1.5 py-0.5 text-xs font-medium text-slate-600">
                      {QUESTION_TYPE_LABELS[q.type]}
                    </span>
                    {q.chapterTitle && (
                      <span className="mr-2 text-xs text-slate-400">[{q.chapterTitle}]</span>
                    )}
                    <span className="whitespace-pre-wrap font-medium">{q.stem}</span>
                  </div>
                </div>

                {q.options.length > 0 && (
                  <div className="mt-2.5 grid grid-cols-1 gap-1.5 pl-6 sm:grid-cols-2">
                    {q.options.map((opt) => (
                      <div key={opt.key} className="text-sm text-slate-700">
                        <span className="mr-1.5 font-semibold">{opt.key}.</span>
                        <span>{opt.content}</span>
                      </div>
                    ))}
                  </div>
                )}

                {q.type === 'short' && printMode === 'blank' && (
                  <div className="mt-3 ml-6 h-16 rounded border border-dashed border-slate-300" />
                )}

                {printMode === 'study' && (
                  <div className="mt-3 ml-6 rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="font-semibold text-emerald-700">
                      参考答案：{formatAnswerText(q)}
                    </div>
                    {q.explanation && (
                      <div className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                        解析：{q.explanation}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {printMode === 'blank' && questions.length > 0 && (
            <div className="print-page-break mt-10 border-t-2 border-slate-800 pt-6">
              <h2 className="mb-4 text-lg font-bold text-slate-900">参考答案与解析附录</h2>
              <div className="space-y-3 text-sm">
                {questions.map((q, idx) => (
                  <div key={`ans-${q.id}`} className="print-break-inside-avoid">
                    <span className="font-bold text-slate-800">{idx + 1}. </span>
                    <span className="font-semibold text-emerald-700">{formatAnswerText(q)}</span>
                    {q.explanation && (
                      <p className="mt-0.5 pl-5 text-xs text-slate-600">解析：{q.explanation}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
