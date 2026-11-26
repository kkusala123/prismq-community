import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Award,
  CheckCircle2,
  XCircle,
  Download,
  BarChart3,
  AlertTriangle,
  OctagonX,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  QUESTION_TYPE_LABELS,
  type ActiveExamSessionItem,
  type ExamQuestionSnapshot,
  type ExamSubmissionItem,
} from '../../shared/types.js';
import { apiFetch } from '../lib/api';
import { RichCodeText } from '../components/RichCodeText';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  INPUT_CLS,
  PageHeader,
  StatCard,
} from '../components/ui';

interface AnalyticsData {
  exam: {
    id: string;
    title: string;
    shareCode: string;
    totalScore: number;
    passScore: number;
    durationMinutes: number;
    startsAt?: string | null;
    endsAt?: string | null;
    endedAt?: string | null;
    maxTabSwitches?: number;
    blockEmulator?: boolean;
    status: string;
  };
  summary: {
    submissionCount: number;
    inProgressCount?: number;
    avgScore: number;
    avgAccuracy?: number;
    maxScore: number;
    minScore?: number;
    passCount: number;
    passRate: number;
    riskSubmissionCount?: number;
  };
  activeSessions?: ActiveExamSessionItem[];
  submissions: ExamSubmissionItem[];
  questionStats: Array<{
    index: number;
    questionId: string;
    type: string;
    stem: string;
    chapterTitle: string;
    score: number;
    correctTimes: number;
    wrongTimes: number;
    correctRate?: number;
    errorRate: number;
  }>;
  chapterMastery: Array<{
    chapter: string;
    masteryRate: number;
  }>;
}

const RISK_FLAG_LABELS: Record<string, string> = {
  emulator: '虚拟机/模拟器',
  debugger: '调试工具',
  virtual_space: '应用多开',
  multi_window: '分屏/小窗',
  small_window: '小窗/分屏',
  focus_lost: '窗口失焦',
  tab_switch: '切屏离开',
  devtools: 'DevTools',
  screenshot: '截屏风险',
};

export const ExamReportPage: React.FC = () => {
  const { submissionId, examId } = useParams<{ submissionId?: string; examId?: string }>();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;

  const [submission, setSubmission] = useState<ExamSubmissionItem | null>(null);
  const [questions, setQuestions] = useState<ExamQuestionSnapshot[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editingSubId, setEditingSubId] = useState<string | null>(null);
  const [expandedRiskSubId, setExpandedRiskSubId] = useState<string | null>(null);
  const [gradeInputs, setGradeInputs] = useState<Record<string, number>>({});
  const [terminating, setTerminating] = useState(false);
  const [aiLoadingId, setAiLoadingId] = useState<string | null>(null);
  const [aiExplainMap, setAiExplainMap] = useState<
    Record<string, { keyPoint: string; analysis: string; mnemonic: string }>
  >({});
  const [aiErrorMap, setAiErrorMap] = useState<Record<string, string>>({});

  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      if (submissionId) {
        const res = await apiFetch<{
          submission: ExamSubmissionItem;
          questions: ExamQuestionSnapshot[];
        }>(`/api/exams/submissions/${submissionId}`);
        setSubmission(res.submission);
        setQuestions(res.questions);
      } else if (examId) {
        const res = await apiFetch<AnalyticsData>(`/api/exams/${examId}/analytics`);
        setAnalytics(res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载报告失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    void loadData(false);
  }, [submissionId, examId]);

  useEffect(() => {
    if (!examId) return;
    const timer = window.setInterval(() => {
      void loadData(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [examId]);

  const handleTerminateExam = async () => {
    if (!analytics) return;
    if (
      !window.confirm(
        `确认主动终结「${analytics.exam.title}」吗？\n考场将立刻关闭，所有在考人员将按当前最新作答自动结算成绩并收卷！`
      )
    ) {
      return;
    }
    setTerminating(true);
    try {
      const res = await apiFetch<{ terminatedCount: number }>(
        `/api/exams/${analytics.exam.id}/terminate`,
        { method: 'POST' }
      );
      window.alert(
        res.terminatedCount > 0
          ? `考试已主动终结，已为 ${res.terminatedCount} 名在考人员自动收卷并生成成绩。`
          : '考试已主动终结并关闭入口。'
      );
      await loadData(false);
    } finally {
      setTerminating(false);
    }
  };

  const exportAnalyticsCsv = () => {
    if (!analytics) return;
    const header = [
      '排名',
      '姓名',
      '学号/工号',
      '得分',
      '正确率',
      '是否及格',
      '答对题数',
      '用时(秒)',
      '异常次数',
      '风控告警',
      '交卷时间',
    ];
    const lines = analytics.submissions.map((s, i) => [
      i + 1,
      s.participantName,
      s.participantIdentifier || '',
      s.score,
      `${s.accuracy ?? (s.totalQuestions > 0 ? Math.round((s.correctCount / s.totalQuestions) * 100) : 0)}%`,
      s.isPassed ? '及格' : '未及格',
      `${s.correctCount}/${s.totalQuestions}`,
      s.durationSeconds,
      s.tabSwitchCount,
      (s.riskFlags || []).map((f) => RISK_FLAG_LABELS[f] || f).join('/'),
      new Date(s.submittedAt).toLocaleString(),
    ]);
    const csv = '\uFEFF' + [header, ...lines].map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${analytics.exam.title}_成绩排行榜.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleManualGrade = async (subId: string, qid: string) => {
    if (!analytics) return;
    await apiFetch(`/api/exams/${analytics.exam.id}/submissions/${subId}/grade`, {
      method: 'PUT',
      json: { questionId: qid, earnedScore: gradeInputs[qid] ?? 0 },
    });
    setEditingSubId(null);
    void loadData(false);
  };

  const handleAiExplain = async (
    q: ExamQuestionSnapshot,
    userAnswer?: string,
    correctAnswer?: string,
    explanation?: string
  ) => {
    const key = q.questionId;
    setAiLoadingId(key);
    setAiErrorMap((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    try {
      const res = await apiFetch<{ keyPoint: string; analysis: string; mnemonic: string }>(
        '/api/ai/explain',
        {
          method: 'POST',
          json: {
            questionId: q.questionId || undefined,
            userAnswer: userAnswer || '',
            saveToQuestion: false,
            type: q.type,
            stem: q.stem,
            options: q.options || [],
            answer: correctAnswer || q.answer || '',
            explanation: explanation || q.explanation || '',
          },
        }
      );
      setAiExplainMap((prev) => ({ ...prev, [key]: res }));
    } catch (err) {
      setAiErrorMap((prev) => ({
        ...prev,
        [key]: err instanceof Error ? err.message : 'AI 解析生成失败',
      }));
    } finally {
      setAiLoadingId(null);
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-sm text-slate-500">正在加载报告数据...</div>;
  }

  if (error) {
    return <div className="py-20 text-center text-sm text-rose-600">{error}</div>;
  }

  if (submission) {
    const accPct =
      submission.accuracy ??
      (submission.totalQuestions > 0
        ? Math.round((submission.correctCount / submission.totalQuestions) * 100)
        : 0);

    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6">
        <PageHeader
          backTo="/exams"
          backLabel="返回考试中心"
          title={submission.examTitle || '考试成绩单'}
          description={`考生：${submission.participantName}${
            submission.participantIdentifier ? `（${submission.participantIdentifier}）` : ''
          } · 交卷时间：${new Date(submission.submittedAt).toLocaleString()}`}
        />

        {notice && <Alert tone="warning">{notice}</Alert>}
        {submission.terminatedByCreator && !notice && (
          <Alert tone="info">本份答卷由考试发起者主动终结考场后自动统一收卷结算。</Alert>
        )}

        <Card padding="lg">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold text-slate-500">最终得分</div>
              <div
                className={`mt-1 text-3xl font-extrabold tabular-nums ${
                  submission.isPassed ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {submission.score}{' '}
                <span className="text-sm font-semibold text-slate-500">
                  / {submission.totalScore}
                </span>
              </div>
            </div>
            <Badge tone={submission.isPassed ? 'success' : 'danger'} className="px-3.5 py-1.5 text-sm">
              <Award className="h-4 w-4" />
              {submission.isPassed ? '成绩合格' : '未达及格线'}
            </Badge>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs tabular-nums sm:grid-cols-4">
            <div>
              <div className="text-slate-500">题目正确率</div>
              <div className="mt-1 text-base font-bold text-brand-700">{accPct}%</div>
            </div>
            <div>
              <div className="text-slate-500">答对题数</div>
              <div className="mt-1 text-base font-bold text-slate-900">
                {submission.correctCount} / {submission.totalQuestions}
              </div>
            </div>
            <div>
              <div className="text-slate-500">答题用时</div>
              <div className="mt-1 text-base font-bold text-slate-900">
                {Math.floor(submission.durationSeconds / 60)} 分 {submission.durationSeconds % 60} 秒
              </div>
            </div>
            <div>
              <div className="text-slate-500">异常行为记录</div>
              <div className="mt-1 text-base font-bold text-slate-900">
                {submission.tabSwitchCount} 次
              </div>
            </div>
          </div>

          {(submission.riskFlags?.length ?? 0) > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-semibold text-rose-700">风控审计标记：</span>
              {submission.riskFlags!.map((flag) => (
                <Badge key={flag} tone="danger">
                  {RISK_FLAG_LABELS[flag] || flag}
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-900 sm:text-base">逐题得分与错题复盘</h2>
          {questions.map((q, idx) => {
            const detail = submission.gradingDetail[q.questionId];
            const isOk = detail?.isCorrect;
            return (
              <Card
                key={q.questionId}
                className={isOk ? 'border-emerald-200' : 'border-rose-200'}
              >
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-600 tabular-nums">#{idx + 1}</span>
                    <Badge tone="neutral">{QUESTION_TYPE_LABELS[q.type]}</Badge>
                    <span className="text-xs font-medium text-slate-600 tabular-nums">
                      得分 {detail?.earnedScore ?? 0} / {q.score}
                    </span>
                  </div>
                  {isOk ? (
                    <Badge tone="success">
                      <CheckCircle2 className="h-3.5 w-3.5" /> 正确
                    </Badge>
                  ) : (
                    <Badge tone="danger">
                      <XCircle className="h-3.5 w-3.5" /> 错误
                    </Badge>
                  )}
                </div>

                <RichCodeText
                  text={q.stem}
                  className="text-sm font-medium leading-relaxed text-slate-900"
                />

                {q.options && q.options.length > 0 && (
                  <div className="mt-2.5 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
                    {q.options.map((opt) => (
                      <div
                        key={opt.key}
                        className={`rounded-lg border px-3 py-1.5 ${
                          (detail?.correctAnswer || q.answer || '').includes(opt.key)
                            ? 'border-emerald-200 bg-emerald-50 font-semibold text-emerald-800'
                            : (detail?.userAnswer || '').includes(opt.key) && !isOk
                              ? 'border-rose-200 bg-rose-50 text-rose-700'
                              : 'border-slate-200 bg-slate-50 text-slate-700'
                        }`}
                      >
                        {opt.key}. <RichCodeText text={opt.content} inline />
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 space-y-1 border-t border-slate-100 pt-2.5 text-xs">
                  <div>
                    你的答案：
                    <span className={`font-bold ${isOk ? 'text-emerald-700' : 'text-rose-600'}`}>
                      {detail?.userAnswer || '未作答'}
                    </span>
                    <span className="mx-2 text-slate-300">|</span>
                    标准答案：
                    <span className="font-bold text-emerald-700">
                      {detail?.correctAnswer || q.answer}
                    </span>
                  </div>
                  {(detail?.explanation || q.explanation) && (
                    <div className="text-slate-600">
                      解析：
                      <RichCodeText text={detail?.explanation || q.explanation || ''} inline />
                    </div>
                  )}

                  <div className="pt-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={aiLoadingId === q.questionId}
                      disabled={aiLoadingId === q.questionId}
                      onClick={() =>
                        void handleAiExplain(
                          q,
                          detail?.userAnswer,
                          detail?.correctAnswer,
                          detail?.explanation
                        )
                      }
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      {aiLoadingId === q.questionId
                        ? 'AI 正在生成解析…'
                        : aiExplainMap[q.questionId]
                          ? '重新 AI 一键解析'
                          : 'AI 一键解析'}
                    </Button>
                  </div>

                  {aiErrorMap[q.questionId] && (
                    <div className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      {aiErrorMap[q.questionId]}
                    </div>
                  )}

                  {aiExplainMap[q.questionId] && (
                    <div className="mt-2 space-y-1.5 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 text-xs leading-relaxed text-slate-700">
                      <div className="flex items-center gap-1.5 font-bold text-indigo-700">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>AI 深度解析</span>
                      </div>
                      {aiExplainMap[q.questionId].keyPoint && (
                        <div>
                          <span className="font-semibold text-slate-900">核心考点：</span>
                          <span>{aiExplainMap[q.questionId].keyPoint}</span>
                        </div>
                      )}
                      {aiExplainMap[q.questionId].analysis && (
                        <div>
                          <div className="font-semibold text-slate-900">深度解析：</div>
                          <RichCodeText text={aiExplainMap[q.questionId].analysis} />
                        </div>
                      )}
                      {aiExplainMap[q.questionId].mnemonic && (
                        <div className="rounded-lg bg-white/80 px-2.5 py-1.5 text-indigo-800">
                          <span className="font-semibold">记忆口诀：</span>
                          <span>{aiExplainMap[q.questionId].mnemonic}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  if (analytics) {
    const activeList = analytics.activeSessions || [];

    return (
      <div className="space-y-6">
        <PageHeader
          backTo="/exams"
          backLabel="返回考试中心"
          title={
            <span className="flex flex-wrap items-center gap-2">
              <BarChart3 className="h-5 w-5 text-brand-600" />
              <span>{analytics.exam.title} · 考情统计与实时监考</span>
              <Badge tone={analytics.exam.status === 'active' ? 'success' : 'danger'}>
                {analytics.exam.status === 'active' ? '进行中' : '已终结/关闭'}
              </Badge>
            </span>
          }
          description={`分享码：${analytics.exam.shareCode}${
            analytics.exam.endedAt
              ? ` · 终结时间：${new Date(analytics.exam.endedAt).toLocaleString()}`
              : ''
          }`}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                icon={<RefreshCw className="h-3.5 w-3.5" />}
                onClick={() => void loadData(false)}
              >
                刷新
              </Button>
              {analytics.exam.status === 'active' && (
                <Button
                  variant="danger"
                  loading={terminating}
                  icon={<OctagonX className="h-3.5 w-3.5" />}
                  onClick={() => void handleTerminateExam()}
                >
                  主动终结考试并收卷
                </Button>
              )}
              <Button
                variant="secondary"
                icon={<Download className="h-3.5 w-3.5 text-emerald-600" />}
                onClick={exportAnalyticsCsv}
              >
                导出成绩 CSV
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="已交卷人数" value={analytics.summary.submissionCount} />
          <StatCard
            label="当前在考"
            value={analytics.summary.inProgressCount ?? activeList.length}
            valueClassName="text-amber-600"
          />
          <StatCard
            label="平均分"
            value={analytics.summary.avgScore}
            valueClassName="text-brand-600"
          />
          <StatCard
            label="平均正确率"
            value={`${analytics.summary.avgAccuracy ?? 0}%`}
            valueClassName="text-emerald-600"
          />
          <StatCard
            label="及格率"
            value={`${analytics.summary.passRate}%`}
            valueClassName="text-indigo-600"
          />
          <StatCard
            label="最高分"
            value={analytics.summary.maxScore}
            valueClassName="text-slate-800"
          />
        </div>

        {activeList.length > 0 && (
          <Card>
            <CardHeader
              icon={<Users className="h-4 w-4 text-amber-600" />}
              title={`正在考试中 (${activeList.length} 人)`}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2 pr-3 font-semibold">考生</th>
                    <th className="py-2 pr-3 font-semibold">答题进度</th>
                    <th className="py-2 pr-3 font-semibold">环境与风险标记</th>
                    <th className="py-2 pr-3 font-semibold">异常次数</th>
                    <th className="py-2 font-semibold">最近心跳</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {activeList.map((sess) => (
                    <tr key={sess.id}>
                      <td className="py-2.5 pr-3 font-semibold text-slate-900">
                        {sess.participantName}
                        {sess.participantIdentifier ? (
                          <span className="ml-1 text-slate-400">({sess.participantIdentifier})</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-700">已答 {sess.answeredCount} 题</td>
                      <td className="py-2.5 pr-3">
                        {sess.riskFlags.length === 0 ? (
                          <Badge tone="success">环境正常</Badge>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {sess.riskFlags.map((f) => (
                              <Badge key={f} tone="danger">
                                {RISK_FLAG_LABELS[f] || f}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 font-semibold text-rose-600">
                        {sess.tabSwitchCount} 次
                      </td>
                      <td className="py-2.5 text-slate-500">
                        {new Date(sess.lastHeartbeatAt).toLocaleTimeString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <Card>
          <CardHeader title="成绩排行榜、正确率与防作弊审计" />
          {analytics.submissions.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">暂无考生交卷</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="py-2.5 pr-3 font-semibold">名次</th>
                    <th className="py-2.5 pr-3 font-semibold">姓名</th>
                    <th className="py-2.5 pr-3 font-semibold">工号/学号</th>
                    <th className="py-2.5 pr-3 font-semibold">总分</th>
                    <th className="py-2.5 pr-3 font-semibold">正确率</th>
                    <th className="py-2.5 pr-3 font-semibold">状态</th>
                    <th className="py-2.5 pr-3 font-semibold">用时</th>
                    <th className="py-2.5 pr-3 font-semibold">风控异常</th>
                    <th className="py-2.5 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {analytics.submissions.map((s, idx) => {
                    const acc =
                      s.accuracy ??
                      (s.totalQuestions > 0
                        ? Math.round((s.correctCount / s.totalQuestions) * 100)
                        : 0);
                    const hasRisk = (s.riskFlags?.length ?? 0) > 0 || s.tabSwitchCount > 0;
                    return (
                      <React.Fragment key={s.id}>
                        <tr className="hover:bg-slate-50">
                          <td className="py-3 pr-3 font-bold text-slate-700">#{idx + 1}</td>
                          <td className="py-3 pr-3 font-semibold text-slate-900">
                            {s.participantName}
                            {s.terminatedByCreator && (
                              <Badge tone="neutral" className="ml-1.5 text-[10px]">
                                统一收卷
                              </Badge>
                            )}
                          </td>
                          <td className="py-3 pr-3 text-slate-600">
                            {s.participantIdentifier || '-'}
                          </td>
                          <td className="py-3 pr-3 font-bold text-brand-700">{s.score}</td>
                          <td className="py-3 pr-3 font-semibold text-emerald-700">{acc}%</td>
                          <td className="py-3 pr-3">
                            <Badge tone={s.isPassed ? 'success' : 'danger'}>
                              {s.isPassed ? '及格' : '未及格'}
                            </Badge>
                          </td>
                          <td className="py-3 pr-3 text-slate-700">{s.durationSeconds}s</td>
                          <td className="py-3 pr-3">
                            {hasRisk ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedRiskSubId(expandedRiskSubId === s.id ? null : s.id)
                                }
                                className="inline-flex items-center gap-1 font-semibold text-rose-600 hover:underline"
                              >
                                <AlertTriangle className="h-3 w-3" /> {s.tabSwitchCount} 次
                                {(s.riskFlags?.length ?? 0) > 0 &&
                                  ` (${s.riskFlags!.map((f) => RISK_FLAG_LABELS[f] || f).slice(0, 2).join('·')})`}
                              </button>
                            ) : (
                              <span className="text-emerald-700">正常</span>
                            )}
                          </td>
                          <td className="space-x-3 py-3">
                            <Link
                              to={`/exam/report/${s.id}`}
                              className="font-semibold text-brand-600 hover:underline"
                            >
                              看卷
                            </Link>
                            <button
                              type="button"
                              onClick={() => {
                                if (editingSubId === s.id) {
                                  setEditingSubId(null);
                                } else {
                                  const init: Record<string, number> = {};
                                  Object.entries(s.gradingDetail).forEach(([k, v]) => {
                                    init[k] = v.earnedScore;
                                  });
                                  setGradeInputs(init);
                                  setEditingSubId(s.id);
                                }
                              }}
                              className="font-semibold text-indigo-600 hover:underline"
                            >
                              调分
                            </button>
                          </td>
                        </tr>

                        {expandedRiskSubId === s.id && (
                          <tr>
                            <td colSpan={9} className="bg-rose-50/60 p-3">
                              <div className="space-y-1.5 text-xs">
                                <div className="flex items-center gap-1.5 font-bold text-rose-800">
                                  <ShieldAlert className="h-3.5 w-3.5" />
                                  设备环境与违规事件时间轴
                                </div>
                                {s.deviceInfo?.deviceLabel && (
                                  <div className="text-slate-600">
                                    设备：{s.deviceInfo.platform || ''} · {s.deviceInfo.deviceLabel}
                                  </div>
                                )}
                                {(s.cheatEvents || []).length === 0 ? (
                                  <div className="text-slate-500">仅记录到 {s.tabSwitchCount} 次切屏/失焦</div>
                                ) : (
                                  <div className="max-h-36 space-y-1 overflow-y-auto">
                                    {(s.cheatEvents || []).map((ev, eIdx) => (
                                      <div key={eIdx} className="text-rose-700">
                                        [{new Date(ev.timestamp).toLocaleTimeString()}] {ev.detail}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}

                        {editingSubId === s.id && (
                          <tr>
                            <td colSpan={9} className="bg-slate-50 p-3">
                              <div className="space-y-2">
                                <div className="text-xs font-bold text-slate-800">
                                  人工调分（修改指定题目得分）：
                                </div>
                                {Object.entries(s.gradingDetail).map(([qid, det], qIdx) => (
                                  <div key={qid} className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="w-16 font-semibold text-slate-700">题 {qIdx + 1}</span>
                                    <span className="max-w-md truncate text-slate-600">
                                      答：{det.userAnswer || '空'}
                                    </span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={det.maxScore}
                                      step={0.5}
                                      value={gradeInputs[qid] ?? det.earnedScore}
                                      onChange={(e) =>
                                        setGradeInputs((p) => ({
                                          ...p,
                                          [qid]: Number(e.target.value),
                                        }))
                                      }
                                      className={`${INPUT_CLS} h-8 w-20 text-xs`}
                                    />
                                    <span className="text-slate-500">/ {det.maxScore}</span>
                                    <Button
                                      size="sm"
                                      variant="ai"
                                      onClick={() => void handleManualGrade(s.id, qid)}
                                    >
                                      更新分数
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="各章节知识点掌握度" />
            <div className="space-y-3">
              {analytics.chapterMastery.map((c) => (
                <div key={c.chapter}>
                  <div className="mb-1 flex justify-between text-xs tabular-nums">
                    <span className="font-semibold text-slate-700">{c.chapter}</span>
                    <span className="font-bold text-brand-700">{c.masteryRate}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-brand-600"
                      style={{ width: `${c.masteryRate}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="单题正确率与高频错题" />
            <div className="space-y-2.5">
              {analytics.questionStats.slice(0, 8).map((qs) => (
                <div
                  key={qs.questionId}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">第 {qs.index} 题</span>
                    <div className="flex items-center gap-1.5 tabular-nums">
                      <Badge tone="success">
                        正确率 {qs.correctRate ?? 100 - qs.errorRate}%
                      </Badge>
                      <Badge tone="danger">错误率 {qs.errorRate}%</Badge>
                    </div>
                  </div>
                  <p className="mt-1 line-clamp-2 text-slate-600">{qs.stem}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return null;
};
