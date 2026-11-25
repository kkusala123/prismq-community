import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  Award,
  CheckCircle2,
  XCircle,
  Download,
  BarChart3,
  AlertTriangle,
} from 'lucide-react';
import {
  QUESTION_TYPE_LABELS,
  type ExamQuestionSnapshot,
  type ExamSubmissionItem,
} from '../../shared/types.js';
import { apiFetch } from '../lib/api';
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
    status: string;
  };
  summary: {
    submissionCount: number;
    avgScore: number;
    maxScore: number;
    passCount: number;
    passRate: number;
  };
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
    errorRate: number;
  }>;
  chapterMastery: Array<{
    chapter: string;
    masteryRate: number;
  }>;
}

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
  const [gradeInputs, setGradeInputs] = useState<Record<string, number>>({});

  const loadData = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [submissionId, examId]);

  const exportAnalyticsCsv = () => {
    if (!analytics) return;
    const header = [
      '排名',
      '姓名',
      '学号/工号',
      '得分',
      '是否及格',
      '答对题数',
      '用时(秒)',
      '切屏次数',
      '交卷时间',
    ];
    const lines = analytics.submissions.map((s, i) => [
      i + 1,
      s.participantName,
      s.participantIdentifier || '',
      s.score,
      s.isPassed ? '及格' : '未及格',
      `${s.correctCount}/${s.totalQuestions}`,
      s.durationSeconds,
      s.tabSwitchCount,
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
    void loadData();
  };

  if (loading) {
    return <div className="py-20 text-center text-sm text-slate-500">正在加载报告数据...</div>;
  }

  if (error) {
    return <div className="py-20 text-center text-sm text-rose-600">{error}</div>;
  }

  if (submission) {
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

          <div className="mt-5 grid grid-cols-3 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-xs tabular-nums">
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
              <div className="text-slate-500">切屏次数</div>
              <div className="mt-1 text-base font-bold text-slate-900">
                {submission.tabSwitchCount} 次
              </div>
            </div>
          </div>
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

                <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-slate-900">
                  {q.stem}
                </p>

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
                        {opt.key}. {opt.content}
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
                      解析：{detail?.explanation || q.explanation}
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
    return (
      <div className="space-y-6">
        <PageHeader
          backTo="/exams"
          backLabel="返回考试中心"
          title={
            <span className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-brand-600" />
              <span>{analytics.exam.title} · 考情分析看板</span>
            </span>
          }
          actions={
            <Button
              variant="secondary"
              icon={<Download className="h-3.5 w-3.5 text-emerald-600" />}
              onClick={exportAnalyticsCsv}
            >
              导出成绩排行榜 CSV
            </Button>
          }
        />

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard label="已交卷人数" value={analytics.summary.submissionCount} />
          <StatCard
            label="平均分"
            value={analytics.summary.avgScore}
            valueClassName="text-brand-600"
          />
          <StatCard
            label="最高分"
            value={analytics.summary.maxScore}
            valueClassName="text-emerald-600"
          />
          <StatCard
            label="及格率"
            value={`${analytics.summary.passRate}%`}
            valueClassName="text-indigo-600"
          />
        </div>

        <Card>
          <CardHeader title="成绩排行榜与切屏审计" />
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
                    <th className="py-2.5 pr-3 font-semibold">状态</th>
                    <th className="py-2.5 pr-3 font-semibold">用时</th>
                    <th className="py-2.5 pr-3 font-semibold">切屏异常</th>
                    <th className="py-2.5 font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {analytics.submissions.map((s, idx) => (
                    <React.Fragment key={s.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="py-3 pr-3 font-bold text-slate-700">#{idx + 1}</td>
                        <td className="py-3 pr-3 font-semibold text-slate-900">
                          {s.participantName}
                        </td>
                        <td className="py-3 pr-3 text-slate-600">
                          {s.participantIdentifier || '-'}
                        </td>
                        <td className="py-3 pr-3 font-bold text-brand-700">{s.score}</td>
                        <td className="py-3 pr-3">
                          <Badge tone={s.isPassed ? 'success' : 'danger'}>
                            {s.isPassed ? '及格' : '未及格'}
                          </Badge>
                        </td>
                        <td className="py-3 pr-3 text-slate-700">{s.durationSeconds}s</td>
                        <td className="py-3 pr-3">
                          {s.tabSwitchCount > 0 ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-600">
                              <AlertTriangle className="h-3 w-3" /> {s.tabSwitchCount} 次
                            </span>
                          ) : (
                            <span className="text-emerald-700">0 次</span>
                          )}
                        </td>
                        <td className="py-3 space-x-3">
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
                      {editingSubId === s.id && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50 p-3">
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
                  ))}
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
            <CardHeader title="高频错题榜（按错误率排序）" />
            <div className="space-y-2.5">
              {analytics.questionStats.slice(0, 6).map((qs) => (
                <div
                  key={qs.questionId}
                  className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800">第 {qs.index} 题</span>
                    <Badge tone="danger">错误率 {qs.errorRate}%</Badge>
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
