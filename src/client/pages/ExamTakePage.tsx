import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  Lock,
  Send,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import {
  QUESTION_TYPE_LABELS,
  type CheatEventItem,
  type ExamDeviceInfo,
  type QuestionOption,
  type QuestionType,
} from '../../shared/types.js';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import { attachWebAntiCheatMonitor, inspectWebEnvironment } from '../lib/examSecurity';
import { RichCodeText } from '../components/RichCodeText';
import {
  Alert,
  Badge,
  Button,
  Card,
  INPUT_CLS,
  LABEL_CLS,
  TEXTAREA_CLS,
} from '../components/ui';

interface ExamMeta {
  id: string;
  title: string;
  description: string;
  creatorName: string;
  shareCode: string;
  examType?: 'mock' | 'published';
  hasPassword: boolean;
  allowGuest: boolean;
  durationMinutes: number;
  startsAt?: string | null;
  endsAt?: string | null;
  endedAt?: string | null;
  notStarted?: boolean;
  expired?: boolean;
  totalScore: number;
  passScore: number;
  maxTabSwitches: number;
  maxAttempts: number;
  blockEmulator?: boolean;
  strictAntiCheat?: boolean;
  autoSubmitOnCheat?: boolean;
  status: string;
  questionCount: number;
}

interface SanitizedQuestion {
  questionId: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  score: number;
  chapterTitle?: string;
}

const DISPLAY_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const ExamTakePage: React.FC = () => {
  const { shareCode = '' } = useParams<{ shareCode: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [exam, setExam] = useState<ExamMeta | null>(null);
  const [questions, setQuestions] = useState<SanitizedQuestion[]>([]);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [accessPassword, setAccessPassword] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);

  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [participantName, setParticipantName] = useState('');
  const [participantIdentifier, setParticipantIdentifier] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [totalExamSeconds, setTotalExamSeconds] = useState(3600);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [cheatEvents, setCheatEvents] = useState<CheatEventItem[]>([]);
  const [deviceInfo, setDeviceInfo] = useState<ExamDeviceInfo>({});
  const [tabWarningMsg, setTabWarningMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const startedAtRef = useRef<string>(new Date().toISOString());
  const answersRef = useRef<Record<string, string>>({});
  answersRef.current = answers;
  const tabSwitchRef = useRef(0);
  tabSwitchRef.current = tabSwitchCount;
  const cheatEventsRef = useRef<CheatEventItem[]>([]);
  cheatEventsRef.current = cheatEvents;
  const submittingRef = useRef(false);
  submittingRef.current = submitting;

  const draftStorageKey = `kaoshibao_exam_draft_${shareCode.toUpperCase()}`;

  useEffect(() => {
    setDeviceInfo(inspectWebEnvironment());
  }, []);

  useEffect(() => {
    if (user && !participantName) {
      setParticipantName(user.nickname || user.username);
    }
  }, [user]);

  const fetchPaper = async (pwd = '') => {
    setLoading(true);
    setLoadError('');
    try {
      const qs = pwd ? `?password=${encodeURIComponent(pwd)}` : '';
      const data = await apiFetch<{
        requiresPassword: boolean;
        requiresLogin?: boolean;
        exam: ExamMeta;
        questions: SanitizedQuestion[];
      }>(`/api/exams/join/${shareCode}${qs}`);

      setExam(data.exam);
      setRequiresPassword(data.requiresPassword);
      setRequiresLogin(Boolean(data.requiresLogin));
      setQuestions(data.questions || []);
      const defaultSecs = (data.exam.durationMinutes || 60) * 60;
      setSecondsLeft(defaultSecs);
      setTotalExamSeconds(defaultSecs);

      try {
        const cached = localStorage.getItem(draftStorageKey);
        if (cached) {
          const parsed = JSON.parse(cached) as Record<string, string>;
          if (parsed && typeof parsed === 'object') setAnswers(parsed);
        }
      } catch {
        // ignore
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '加载试卷失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPaper();
  }, [shareCode]);

  const submitExam = async (autoReason?: string) => {
    if (submittingRef.current || !exam) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const elapsed = Math.max(1, totalExamSeconds - Math.max(0, secondsLeft));
      const latestDevice = inspectWebEnvironment();
      const res = await apiFetch<{ submission: { id: string } }>(
        `/api/exams/join/${shareCode}/submit`,
        {
          method: 'POST',
          json: {
            sessionId,
            participantName: participantName.trim(),
            participantIdentifier: participantIdentifier.trim(),
            answers: answersRef.current,
            durationSeconds: elapsed,
            tabSwitchCount: tabSwitchRef.current,
            cheatEvents: cheatEventsRef.current,
            deviceInfo: latestDevice,
            accessPassword,
            startedAt: startedAtRef.current,
          },
        }
      );
      localStorage.removeItem(draftStorageKey);
      navigate(`/exam/report/${res.submission.id}`, {
        state: autoReason ? { notice: autoReason } : undefined,
      });
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '交卷失败');
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleStartExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exam || !participantName.trim() || starting) return;
    setLoadError('');
    const currentDevice = inspectWebEnvironment();
    setDeviceInfo(currentDevice);

    if (exam.blockEmulator && (currentDevice.isEmulator || currentDevice.isVirtualSpace)) {
      setLoadError(
        `检测到当前处于虚拟机、模拟器或自动化测试环境（${currentDevice.reasons?.join('；') || '环境异常'}），本场考试禁止该环境参考。`
      );
      return;
    }

    setStarting(true);
    try {
      const initEvents: CheatEventItem[] = currentDevice.isMultiWindow
        ? [
            {
              type: 'small_window',
              detail: '开考时处于非全屏小窗/分屏状态',
              timestamp: new Date().toISOString(),
            },
          ]
        : [];
      const res = await apiFetch<{
        sessionId: string;
        startedAt: string;
        effectiveDurationSeconds: number;
      }>(`/api/exams/join/${shareCode}/start`, {
        method: 'POST',
        json: {
          participantName: participantName.trim(),
          participantIdentifier: participantIdentifier.trim(),
          accessPassword,
          deviceInfo: currentDevice,
          cheatEvents: initEvents,
        },
      });
      startedAtRef.current = res.startedAt;
      setSessionId(res.sessionId);
      setCheatEvents(initEvents);
      const eff = Math.max(10, res.effectiveDurationSeconds || exam.durationMinutes * 60);
      setTotalExamSeconds(eff);
      setSecondsLeft(eff);
      setStarted(true);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : '开考校验失败');
    } finally {
      setStarting(false);
    }
  };

  // 倒计时器
  useEffect(() => {
    if (!started || submitting) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          void submitExam('考试倒计时结束，系统已自动交卷');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [started, submitting]);

  // 全面防作弊监测（个人自测开启 strictAntiCheat=false 时自动跳过）
  useEffect(() => {
    if (!started || !exam || exam.strictAntiCheat === false) return;
    const detach = attachWebAntiCheatMonitor({
      strictAntiCheat: exam.strictAntiCheat !== false,
      onViolation: (ev) => {
        setCheatEvents((prev) => [...prev.slice(-99), ev]);
        setTabSwitchCount((prev) => {
          const next = prev + 1;
          const limitText =
            exam.maxTabSwitches > 0
              ? `（累计违规 ${next} / ${exam.maxTabSwitches} 次${exam.autoSubmitOnCheat !== false ? '，超限将自动交卷' : ''}）`
              : `（累计违规 ${next} 次）`;
          setTabWarningMsg(`风控警示：${ev.detail} ${limitText}`);
          if (
            exam.autoSubmitOnCheat !== false &&
            exam.maxTabSwitches > 0 &&
            next >= exam.maxTabSwitches
          ) {
            void submitExam('切屏/小窗/失焦违规次数达到上限，系统已自动强制交卷');
          }
          return next;
        });
      },
    });
    return detach;
  }, [started, exam]);

  // 实时心跳同步答案 & 检测组织者主动终结 / 到时自动收卷
  useEffect(() => {
    if (!started || !sessionId || !exam) return;
    const sendHeartbeat = async () => {
      if (submittingRef.current) return;
      try {
        const res = await apiFetch<{
          examStatus: string;
          terminated: boolean;
          forceSubmitted?: boolean;
          submissionId?: string | null;
          remainingServerSeconds?: number;
        }>(`/api/exams/join/${shareCode}/heartbeat`, {
          method: 'POST',
          json: {
            sessionId,
            answers: answersRef.current,
            tabSwitchCount: tabSwitchRef.current,
            cheatEvents: cheatEventsRef.current,
            deviceInfo: inspectWebEnvironment(),
          },
        });

        if (res.terminated) {
          localStorage.removeItem(draftStorageKey);
          if (res.submissionId) {
            navigate(`/exam/report/${res.submissionId}`, {
              state: {
                notice:
                  res.examStatus === 'expired'
                    ? '本场考试已达截止时间，系统已按最新作答自动收卷'
                    : '组织者已主动终结本场考试，系统已按你当前作答自动收卷',
              },
            });
          } else {
            void submitExam('本场考试已由组织者主动终结，系统自动交卷');
          }
          return;
        }

        if (typeof res.remainingServerSeconds === 'number') {
          setSecondsLeft((prev) => Math.min(prev, res.remainingServerSeconds!));
        }
      } catch {
        // 网络抖动时容错跳过本次心跳
      }
    };

    const timer = window.setInterval(() => {
      void sendHeartbeat();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [started, sessionId, exam, shareCode]);

  const updateAnswer = (qid: string, val: string) => {
    setAnswers((prev) => {
      const next = { ...prev, [qid]: val };
      try {
        localStorage.setItem(draftStorageKey, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const toggleMultiOption = (qid: string, optKey: string) => {
    const cur = answers[qid] || '';
    const set = new Set(cur.split('').filter(Boolean));
    if (set.has(optKey)) set.delete(optKey);
    else set.add(optKey);
    updateAnswer(qid, Array.from(set).sort().join(''));
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  if (loading) {
    return <div className="py-24 text-center text-sm text-slate-500">正在加载考场信息...</div>;
  }

  if (loadError && !exam) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F8FB] px-4">
        <Card className="w-full max-w-md text-center" padding="lg">
          <AlertTriangle className="mx-auto h-10 w-10 text-rose-500" />
          <p className="mt-3 text-sm font-semibold text-rose-700">{loadError}</p>
          <Button className="mt-5" onClick={() => navigate('/')}>
            返回首页
          </Button>
        </Card>
      </div>
    );
  }

  if (!exam) return null;

  if (requiresPassword) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F8FB] px-4">
        <Card className="w-full max-w-md" padding="lg">
          <Badge tone="brand">
            <Lock className="h-3 w-3" /> 考场口令验证
          </Badge>
          <h1 className="mt-3 text-lg font-bold text-slate-900">{exam.title}</h1>
          <p className="mt-1 text-xs text-slate-600">本场考试由 {exam.creatorName} 发布，请输入口令进入</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void fetchPaper(accessPassword);
            }}
            className="mt-4 space-y-3"
          >
            <input
              type="password"
              required
              value={accessPassword}
              onChange={(e) => setAccessPassword(e.target.value)}
              placeholder="请输入考试入场口令"
              className={INPUT_CLS}
            />
            <Button type="submit" size="lg" className="w-full">
              验证口令并进入
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  if (requiresLogin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F8FB] px-4">
        <Card className="w-full max-w-md text-center" padding="lg">
          <Lock className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-lg font-bold text-slate-900">{exam.title}</h1>
          <p className="mt-1.5 text-xs text-slate-600">本场考试要求登录后实名参试</p>
          <Button className="mt-5" onClick={() => navigate('/auth')}>
            去登录账号
          </Button>
        </Card>
      </div>
    );
  }

  if (!started) {
    const blockedState =
      exam.status !== 'active'
        ? '本场考试当前已被发起者终结或关闭，无法开始作答。'
        : exam.notStarted
          ? `考试尚未开始，开考时间为 ${new Date(exam.startsAt!).toLocaleString()}`
          : exam.expired
            ? `考试已超过截止时间（${new Date(exam.endsAt!).toLocaleString()}），无法入场。`
            : '';

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F6F8FB] px-4 py-10">
        <Card className="w-full max-w-lg rounded-2xl shadow-card-hover" padding="lg">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">考场分享码：{exam.shareCode}</Badge>
            {exam.examType === 'mock' && (
              <Badge tone="success">个人自测模式 · 交卷即出分与解析</Badge>
            )}
            {exam.blockEmulator && (
              <Badge tone="danger">
                <ShieldCheck className="h-3 w-3" /> 禁止虚拟机/模拟器
              </Badge>
            )}
          </div>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">{exam.title}</h1>
          {exam.description && <p className="mt-2 text-sm text-slate-600">{exam.description}</p>}

          <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs sm:grid-cols-4">
            <div>
              <div className="text-slate-500">总题量</div>
              <div className="mt-0.5 text-sm font-bold text-slate-900 tabular-nums">
                {exam.questionCount} 题
              </div>
            </div>
            <div>
              <div className="text-slate-500">考试时长</div>
              <div className="mt-0.5 text-sm font-bold text-slate-900 tabular-nums">
                {exam.durationMinutes} 分钟
              </div>
            </div>
            <div>
              <div className="text-slate-500">总分/及格</div>
              <div className="mt-0.5 text-sm font-bold text-slate-900 tabular-nums">
                {exam.totalScore} / {exam.passScore}
              </div>
            </div>
            <div>
              <div className="text-slate-500">防切屏/小窗</div>
              <div className="mt-0.5 text-sm font-bold text-rose-600 tabular-nums">
                {exam.maxTabSwitches > 0 ? `限 ${exam.maxTabSwitches} 次` : '仅记录'}
              </div>
            </div>
          </div>

          {(exam.startsAt || exam.endsAt) && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
              {exam.startsAt && <div>开考时间：{new Date(exam.startsAt).toLocaleString()}</div>}
              {exam.endsAt && <div>截止收卷：{new Date(exam.endsAt).toLocaleString()}</div>}
            </div>
          )}

          {exam.strictAntiCheat !== false && (
            <Alert tone="info" className="mt-3 text-xs">
              已启用严厉监考：离开考场、切换标签页、开启小窗/分屏、窗口失焦或调出开发者工具均会实时记录并同步至组织者。
            </Alert>
          )}

          {exam.strictAntiCheat !== false && deviceInfo.isEmulator && (
            <Alert tone="warning" className="mt-3 text-xs">
              当前浏览器疑似运行在虚拟化/自动化环境：{deviceInfo.reasons?.join('；')}
            </Alert>
          )}

          {loadError && (
            <Alert tone="error" className="mt-3">
              {loadError}
            </Alert>
          )}

          {blockedState ? (
            <Alert tone="error" className="mt-5">
              {blockedState}
            </Alert>
          ) : (
            <form onSubmit={handleStartExam} className="mt-5 space-y-3">
              <div>
                <label className={LABEL_CLS}>考生姓名（必填）</label>
                <input
                  type="text"
                  required
                  value={participantName}
                  onChange={(e) => setParticipantName(e.target.value)}
                  placeholder="请输入您的姓名"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS}>学号 / 工号 / 部门（可选）</label>
                <input
                  type="text"
                  value={participantIdentifier}
                  onChange={(e) => setParticipantIdentifier(e.target.value)}
                  placeholder="便于成绩排行榜区分同名人员"
                  className={INPUT_CLS}
                />
              </div>
              <Button type="submit" size="lg" loading={starting} className="mt-2 w-full">
                {exam.examType === 'mock' && exam.strictAntiCheat === false
                  ? '立即开始自测'
                  : '我已确认考试纪律，立即开始答题计时'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    );
  }

  const answeredCount = questions.filter((q) => Boolean((answers[q.questionId] || '').trim())).length;

  return (
    <div className="min-h-screen bg-[#F6F8FB] pb-16">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-slate-900">{exam.title}</div>
            <div className="text-xs text-slate-600 tabular-nums">
              考生：{participantName} · 已答 {answeredCount} / {questions.length} 题
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {tabSwitchCount > 0 && (
              <Badge tone="danger">
                <ShieldAlert className="h-3 w-3" /> 异常 {tabSwitchCount}
              </Badge>
            )}
            <div
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 font-mono text-sm font-bold tabular-nums ${
                secondsLeft < 300
                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                  : 'border-slate-200 bg-slate-100 text-slate-900'
              }`}
            >
              <Clock className="h-4 w-4" />
              {formatTimer(secondsLeft)}
            </div>
            <Button
              variant="success"
              loading={submitting}
              icon={!submitting ? <Send className="h-3.5 w-3.5" /> : undefined}
              onClick={() => {
                if (window.confirm(`当前已答 ${answeredCount}/${questions.length} 题，确认提交试卷？`)) {
                  void submitExam();
                }
              }}
            >
              交卷
            </Button>
          </div>
        </div>

        {tabWarningMsg && (
          <div className="flex items-center justify-center gap-3 bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white">
            <span>{tabWarningMsg}</span>
            <button type="button" onClick={() => setTabWarningMsg('')} className="underline">
              知道了
            </button>
          </div>
        )}
      </header>

      <div className="mx-auto mt-5 max-w-4xl space-y-4 px-4">
        {loadError && <Alert tone="error">{loadError}</Alert>}

        {questions.map((q, idx) => {
          const curVal = answers[q.questionId] || '';
          return (
            <Card key={q.questionId}>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold text-slate-600 tabular-nums">第 {idx + 1} 题</span>
                <Badge tone="brand">{QUESTION_TYPE_LABELS[q.type]}</Badge>
                <Badge tone="neutral">{q.score} 分</Badge>
                {curVal.trim() && (
                  <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" />
                )}
              </div>

              <RichCodeText
                text={q.stem}
                className="mb-4 text-sm font-medium leading-relaxed text-slate-900 sm:text-base"
              />

              {q.options.length > 0 && (
                <div className="space-y-2">
                  {q.options.map((opt, optIdx) => {
                    const isSelected =
                      q.type === 'multiple' ? curVal.includes(opt.key) : curVal === opt.key;
                    const displayKey =
                      q.type === 'boolean' ? opt.key : DISPLAY_LETTERS[optIdx] || opt.key;
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        onClick={() =>
                          q.type === 'multiple'
                            ? toggleMultiOption(q.questionId, opt.key)
                            : updateAnswer(q.questionId, opt.key)
                        }
                        className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left text-sm transition ${
                          isSelected
                            ? 'border-brand-600 bg-brand-50 font-medium text-brand-950'
                            : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                        }`}
                      >
                        <span
                          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold ${
                            isSelected
                              ? 'border-brand-600 bg-brand-600 text-white'
                              : 'border-slate-300 bg-slate-50 text-slate-700'
                          }`}
                        >
                          {displayKey}
                        </span>
                        <RichCodeText text={opt.content} inline className="flex-1" />
                      </button>
                    );
                  })}
                </div>
              )}

              {q.type === 'fill' && (
                <input
                  type="text"
                  value={curVal}
                  onChange={(e) => updateAnswer(q.questionId, e.target.value)}
                  placeholder="请输入填空答案（若有多空请用 | 分隔）"
                  className={INPUT_CLS}
                />
              )}

              {q.type === 'short' && (
                <textarea
                  rows={3}
                  value={curVal}
                  onChange={(e) => updateAnswer(q.questionId, e.target.value)}
                  placeholder="请输入简答题作答内容..."
                  className={TEXTAREA_CLS}
                />
              )}
            </Card>
          );
        })}

        <div className="flex justify-center pt-4">
          <Button
            size="lg"
            variant="success"
            loading={submitting}
            icon={!submitting ? <Send className="h-4 w-4" /> : undefined}
            onClick={() => {
              if (window.confirm(`当前已答 ${answeredCount}/${questions.length} 题，确认提交试卷？`)) {
                void submitExam();
              }
            }}
          >
            提交试卷并查看成绩报告
          </Button>
        </div>
      </div>
    </div>
  );
};
