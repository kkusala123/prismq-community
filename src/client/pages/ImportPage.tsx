import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  FileUp,
  Sparkles,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Trash2,
  Plus,
  Loader2,
  Wand2,
  BookOpen,
  Code2,
  Edit3,
  Check,
  Copy,
  LocateFixed,
  RefreshCw,
  Eye,
  UploadCloud,
  Clock,
  RotateCcw,
  Ban,
  ExternalLink,
  ListChecks,
} from 'lucide-react';
import {
  QUESTION_TYPE_LABELS,
  type AiConversionJobDetail,
  type AiConversionJobSummary,
  type AiJobStatus,
  type ImportValidationSummary,
  type ParsedQuestionDraft,
  type QuestionBankSummary,
  type QuestionOption,
  type QuestionType,
} from '../../shared/types.js';
import {
  CANONICAL_FORMAT_SAMPLE,
  STANDARD_QUESTION_BANK_JSON_SCHEMA,
  STANDARD_SCHEMA_VERSION,
  formatDraftsToCanonicalText,
  validateDraftBatch,
} from '../../shared/questionSchema.js';
import { apiFetch, downloadWithAuth, getAuthToken } from '../lib/api';
import { useAuth } from '../lib/auth';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  INPUT_CLS,
  LABEL_CLS,
  PageHeader,
  SELECT_CLS,
  TEXTAREA_CLS,
  Tabs,
} from '../components/ui';

const EMPTY_SUMMARY: ImportValidationSummary = {
  total: 0,
  validCount: 0,
  errorCount: 0,
  warningCount: 0,
  duplicateCount: 0,
};

export type ImportTabKey = 'standard-doc' | 'ai-studio' | 'ai-jobs' | 'ai-generate' | 'spec';

const JOB_STATUS_META: Record<
  AiJobStatus,
  { label: string; tone: 'neutral' | 'brand' | 'success' | 'danger' | 'warning' }
> = {
  queued: { label: '排队等待', tone: 'warning' },
  running: { label: '后端转换中', tone: 'brand' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '转换失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'neutral' },
};

function notifyJobsUpdated() {
  window.dispatchEvent(new CustomEvent('ksb:ai-jobs-updated'));
}

function formatShortTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const SOURCE_FORMAT_LABELS: Record<string, string> = {
  excel: 'Excel 标准表格',
  'word-table': 'Word 标准表格 (.docx)',
  'word-paragraph': 'Word 标准段落 (.docx)',
  json: '标准 JSON 题库',
  text: '文本格式',
};

export const ImportPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const initialTab: ImportTabKey =
    urlTab === 'ai-studio'
      ? 'ai-studio'
      : urlTab === 'ai-jobs'
        ? 'ai-jobs'
        : urlTab === 'ai-generate'
          ? 'ai-generate'
          : urlTab === 'spec'
            ? 'spec'
            : 'standard-doc';

  const [activeTab, setActiveTab] = useState<ImportTabKey>(initialTab);
  const [banks, setBanks] = useState<QuestionBankSummary[]>([]);
  const [targetBankId, setTargetBankId] = useState(searchParams.get('bankId') || '');
  const [newBankTitle, setNewBankTitle] = useState('');
  const [defaultChapter, setDefaultChapter] = useState('');

  // 左侧编辑器与原始文本对照状态
  const [editorText, setEditorText] = useState('');
  const [originalSourceText, setOriginalSourceText] = useState('');
  const [viewingOriginal, setViewingOriginal] = useState(false);
  const [uploadedFilename, setUploadedFilename] = useState('');
  const [detectedFormat, setDetectedFormat] = useState<string>('');
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const standardDocInputRef = useRef<HTMLInputElement | null>(null);
  const directBgFileInputRef = useRef<HTMLInputElement | null>(null);
  const skipNextDebounceRef = useRef(false);

  // AI 导题策略
  const [preserveOriginalWording, setPreserveOriginalWording] = useState(true);
  const [autoGenerateExplanation, setAutoGenerateExplanation] = useState(true);
  const [autoInferMissingAnswer, setAutoInferMissingAnswer] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState(true);
  const [autoImportOnComplete, setAutoImportOnComplete] = useState(false);

  // AI 后台异步任务队列状态
  const [jobs, setJobs] = useState<AiConversionJobSummary[]>([]);
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [submittingJob, setSubmittingJob] = useState(false);
  const [loadingJobId, setLoadingJobId] = useState<string | null>(null);
  const [busyJobActionId, setBusyJobActionId] = useState<string | null>(null);
  const prevActiveJobIdsRef = useRef<Set<string>>(new Set());

  // AI 流式 / 解析状态
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [repairing, setRepairing] = useState(false);

  // 右侧标准校验卡片状态
  const [drafts, setDrafts] = useState<ParsedQuestionDraft[]>([]);
  const [summary, setSummary] = useState<ImportValidationSummary>(EMPTY_SUMMARY);
  const [filterMode, setFilterMode] = useState<'all' | 'error' | 'warning'>('all');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [skipInvalidOnCommit, setSkipInvalidOnCommit] = useState(false);

  // Tab 2 AI 出题状态
  const [topicMaterial, setTopicMaterial] = useState('');
  const [singleCount, setSingleCount] = useState(3);
  const [multipleCount, setMultipleCount] = useState(1);
  const [booleanCount, setBooleanCount] = useState(1);
  const [fillCount, setFillCount] = useState(0);
  const [shortCount, setShortCount] = useState(0);
  const [difficulty, setDifficulty] = useState(2);

  // 全局提示
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [committing, setCommitting] = useState(false);
  const [copiedCanonical, setCopiedCanonical] = useState(false);

  const aiAvailable = Boolean(user?.hasPersonalAiKey || user?.systemAiAvailable);

  useEffect(() => {
    if (urlTab === 'ai-studio' || urlTab === 'ai-jobs' || urlTab === 'ai-generate' || urlTab === 'spec' || urlTab === 'standard-doc') {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  const fetchAiJobs = async (silent = true) => {
    if (!silent) setJobsLoading(true);
    try {
      const res = await apiFetch<{ jobs: AiConversionJobSummary[]; activeCount: number }>(
        '/api/ai/jobs'
      );
      const nextJobs = res.jobs || [];
      const currentActiveIds = new Set(
        nextJobs.filter((j) => j.status === 'queued' || j.status === 'running').map((j) => j.id)
      );

      if (prevActiveJobIdsRef.current.size > 0) {
        const justCompleted = nextJobs.filter(
          (j) => prevActiveJobIdsRef.current.has(j.id) && j.status === 'completed'
        );
        if (justCompleted.length > 0) {
          const latest = justCompleted[0];
          setStatusMsg(
            `后台转换任务「${latest.sourceFilename || '文本任务'}」已完成：共 ${
              latest.resultSummary.total
            } 题（合格 ${latest.resultSummary.validCount} 题）${
              latest.importedBankId ? `，已自动入库 ${latest.importedCount} 题` : '，可点击载入校验或导入题库'
            }。`
          );
          void apiFetch<{ banks: QuestionBankSummary[] }>('/api/banks?scope=mine').then((bRes) =>
            setBanks(bRes.banks)
          );
          notifyJobsUpdated();
        }
      }
      prevActiveJobIdsRef.current = currentActiveIds;

      setJobs(nextJobs);
      setActiveJobCount(Number(res.activeCount ?? currentActiveIds.size));
    } catch {
      // 忽略瞬时轮询错误
    } finally {
      if (!silent) setJobsLoading(false);
    }
  };

  useEffect(() => {
    void apiFetch<{ banks: QuestionBankSummary[] }>('/api/banks?scope=mine').then((res) => {
      setBanks(res.banks);
      if (!targetBankId && res.banks.length > 0) {
        setTargetBankId(res.banks[0].id);
      }
    });
    void fetchAiJobs(false);
  }, []);

  useEffect(() => {
    if (activeJobCount === 0) return;
    const timer = window.setInterval(() => {
      void fetchAiJobs(true);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [activeJobCount]);

  // 目标题库切换时自动重新校验去重
  useEffect(() => {
    if (drafts.length === 0 || !targetBankId || targetBankId === '__new__') return;
    void apiFetch<{
      drafts: ParsedQuestionDraft[];
      summary: ImportValidationSummary;
    }>('/api/import/validate', {
      method: 'POST',
      json: { drafts, bankId: targetBankId },
    })
      .then((res) => {
        setDrafts(res.drafts);
        setSummary(res.summary);
      })
      .catch(() => undefined);
  }, [targetBankId]);

  const applyDraftsResult = (
    nextDrafts: ParsedQuestionDraft[],
    nextSummary: ImportValidationSummary,
    nextCanonical?: string,
    updateEditor = true
  ) => {
    setDrafts(nextDrafts);
    setSummary(nextSummary);
    setEditingIndex(null);
    if (updateEditor) {
      skipNextDebounceRef.current = true;
      setViewingOriginal(false);
      setEditorText(nextCanonical ?? formatDraftsToCanonicalText(nextDrafts));
    }
  };

  // 左侧编辑器编辑时 350ms 防抖同步右侧预览与校验
  useEffect(() => {
    if (viewingOriginal) return;
    if (skipNextDebounceRef.current) {
      skipNextDebounceRef.current = false;
      return;
    }
    if (!editorText.trim()) {
      setDrafts([]);
      setSummary(EMPTY_SUMMARY);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{
          drafts: ParsedQuestionDraft[];
          summary: ImportValidationSummary;
        }>('/api/import/parse-text', {
          method: 'POST',
          json: {
            text: editorText,
            defaultChapter,
            bankId: targetBankId !== '__new__' ? targetBankId : undefined,
          },
        });
        setDrafts(res.drafts);
        setSummary(res.summary);
      } catch {
        // 输入中间态忽略瞬时解析失败
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [editorText, viewingOriginal, defaultChapter]);

  const lineNumbers = useMemo(() => {
    const text = viewingOriginal ? originalSourceText : editorText;
    const count = Math.max(12, text.split('\n').length);
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [editorText, originalSourceText, viewingOriginal]);

  const syncScroll = () => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const jumpToLine = (line?: number) => {
    if (!line || line < 1) return;
    setViewingOriginal(false);
    setHighlightedLine(line);
    window.setTimeout(() => {
      if (textareaRef.current) {
        const targetScroll = Math.max(0, (line - 3) * 24);
        textareaRef.current.scrollTo({ top: targetScroll, behavior: 'smooth' });
        textareaRef.current.focus();
      }
    }, 50);
    window.setTimeout(() => setHighlightedLine(null), 2600);
  };

  const handleFileSelected = async (file: File) => {
    setErrorMsg('');
    setStatusMsg('');
    setProcessing(true);
    setProgressMsg(`正在读取「${file.name}」...`);
    setProgressPct(15);

    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('defaultChapter', defaultChapter);
      if (targetBankId && targetBankId !== '__new__') {
        fd.append('bankId', targetBankId);
      }
      const token = getAuthToken();
      const res = await fetch('/api/import/extract-raw', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '文件提取失败');

      setUploadedFilename(data.filename || file.name);
      setDetectedFormat(String(data.sourceFormat || ''));

      // 若用户尚未填写新题库名称，自动用文件名（去后缀）预填
      const baseTitle = String(data.filename || file.name).replace(/\.[^.]+$/, '').trim();
      if (baseTitle && !newBankTitle.trim()) {
        setNewBankTitle(baseTitle);
      }

      if (data.mode === 'structured') {
        setOriginalSourceText(String(data.rawText || ''));
        applyDraftsResult(data.drafts || [], data.summary || EMPTY_SUMMARY, data.canonicalText, true);
        const fmtLabel = SOURCE_FORMAT_LABELS[String(data.sourceFormat || '')] || '标准文档';
        setStatusMsg(
          `已按「${fmtLabel}」从「${data.filename}」规范化解析 ${data.count} 道题目（合格 ${data.summary?.validCount ?? 0} 题，待修正 ${data.summary?.errorCount ?? 0} 题），核对无误后即可直接入库。`
        );
      } else {
        const extracted = String(data.rawText || '');
        setOriginalSourceText(extracted);
        setViewingOriginal(false);
        setEditorText(extracted);
        setStatusMsg(
          `已提取「${data.filename}」全文（共 ${extracted.length} 字符）。${
            aiAvailable
              ? '若排版较杂乱，可切换至「AI 智能导题工作台」点击「AI 智能整理为标准格式」一键清洗！'
              : '已在右侧尝试按规则预览，也可下载上方标准 Excel / Word 模板按规范格式导入。'
          }`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '读取文件失败');
    } finally {
      setProcessing(false);
      setProgressMsg('');
      setProgressPct(0);
    }
  };

  const handleAiExtractStream = async () => {
    const sourceText = (viewingOriginal ? originalSourceText : editorText).trim();
    if (!sourceText) {
      setErrorMsg('请先上传文档或粘贴需要整理的试题/讲义文本');
      return;
    }

    setProcessing(true);
    setErrorMsg('');
    setStatusMsg('');
    setProgressMsg('正在连接 DeepSeek AI 智能导题引擎...');
    setProgressPct(8);
    setOriginalSourceText(sourceText);

    try {
      const token = getAuthToken();
      const res = await fetch('/api/ai/extract-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          rawText: sourceText,
          defaultChapter,
          bankId: targetBankId && targetBankId !== '__new__' ? targetBankId : '',
          preserveOriginalWording,
          autoGenerateExplanation,
          autoInferMissingAnswer,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `请求失败 (HTTP ${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('当前浏览器不支持流式响应');
      }

      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let currentEvent = 'message';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const chunk of parts) {
          const lines = chunk.split('\n');
          let evtName = currentEvent;
          const dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith('event:')) {
              evtName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trim());
            }
          }
          if (dataLines.length === 0) continue;
          const payload = JSON.parse(dataLines.join('\n')) as Record<string, unknown>;

          if (evtName === 'progress') {
            setProgressMsg(String(payload.message || '处理中...'));
            const cIdx = Number(payload.chunkIndex || 0);
            const cTotal = Number(payload.totalChunks || 1);
            if (cTotal > 0) {
              setProgressPct(Math.min(95, Math.max(10, Math.round((cIdx / cTotal) * 90))));
            }
          } else if (evtName === 'error') {
            throw new Error(String(payload.error || 'AI 提取发生错误'));
          } else if (evtName === 'done') {
            setProgressPct(100);
            const nextDrafts = (payload.drafts as ParsedQuestionDraft[]) || [];
            const nextSummary = (payload.summary as ImportValidationSummary) || EMPTY_SUMMARY;
            const nextCanonical = String(payload.canonicalText || '');
            applyDraftsResult(nextDrafts, nextSummary, nextCanonical, true);

            const answerKeyHint = payload.detectedAnswerKey
              ? '（已自动匹配文末集中参考答案区）'
              : '';
            setStatusMsg(
              `DeepSeek (${String(payload.modelUsed || '')}) 已将文档清洗为规范标准格式：共识别 ${nextSummary.total} 题，其中合格 ${nextSummary.validCount} 题，待修正 ${nextSummary.errorCount} 题${answerKeyHint}。`
            );
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI 智能导题失败');
    } finally {
      setProcessing(false);
      setProgressMsg('');
      setProgressPct(0);
    }
  };

  const handleDirectFileToBackgroundJob = async (file: File) => {
    setErrorMsg('');
    setStatusMsg('');
    setSubmittingJob(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('defaultChapter', defaultChapter);
      fd.append(
        'targetBankId',
        targetBankId && targetBankId !== '__new__' ? targetBankId : ''
      );
      fd.append(
        'newBankTitle',
        newBankTitle.trim() || file.name.replace(/\.[^.]+$/, '').trim()
      );
      fd.append('autoImport', String(autoImportOnComplete));
      fd.append('preserveOriginalWording', String(preserveOriginalWording));
      fd.append('autoGenerateExplanation', String(autoGenerateExplanation));
      fd.append('autoInferMissingAnswer', String(autoInferMissingAnswer));

      const token = getAuthToken();
      const res = await fetch('/api/ai/jobs', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = (await res.json()) as { job?: AiConversionJobSummary; error?: string };
      if (!res.ok || !data.job) {
        throw new Error(data.error || '提交后台转换任务失败');
      }

      setUploadedFilename(file.name);
      await fetchAiJobs(true);
      notifyJobsUpdated();
      setStatusMsg(
        `已将「${file.name}」上传并交由后端 AI 队列异步转换（可自由切换或关闭页面，任务完成后随时查看结果）。`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '提交后端 AI 转换失败');
    } finally {
      setSubmittingJob(false);
    }
  };

  const handleSubmitTextToBackgroundJob = async () => {
    const sourceText = (viewingOriginal ? originalSourceText : editorText).trim();
    if (!sourceText) {
      setErrorMsg('请先上传文档或粘贴需要整理的试题/讲义文本');
      return;
    }
    setErrorMsg('');
    setStatusMsg('');
    setSubmittingJob(true);
    try {
      const data = await apiFetch<{ job: AiConversionJobSummary }>('/api/ai/jobs', {
        method: 'POST',
        json: {
          rawText: sourceText,
          sourceFilename: uploadedFilename || `手动粘贴文本 (${sourceText.length} 字)`,
          defaultChapter,
          targetBankId: targetBankId && targetBankId !== '__new__' ? targetBankId : '',
          newBankTitle:
            newBankTitle.trim() ||
            (uploadedFilename ? uploadedFilename.replace(/\.[^.]+$/, '').trim() : ''),
          autoImport: autoImportOnComplete,
          preserveOriginalWording,
          autoGenerateExplanation,
          autoInferMissingAnswer,
        },
      });
      await fetchAiJobs(true);
      notifyJobsUpdated();
      setStatusMsg(
        `已将「${data.job.sourceFilename || '文本内容'}」提交至后端 AI 后台转换队列，可随时切换页面并在「后台转换任务」查看进度！`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '提交后台任务失败');
    } finally {
      setSubmittingJob(false);
    }
  };

  const handleCancelJob = async (jobId: string) => {
    setBusyJobActionId(jobId);
    setErrorMsg('');
    try {
      await apiFetch(`/api/ai/jobs/${jobId}/cancel`, { method: 'POST' });
      await fetchAiJobs(true);
      notifyJobsUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '取消后台任务失败');
    } finally {
      setBusyJobActionId(null);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    setBusyJobActionId(jobId);
    setErrorMsg('');
    try {
      await apiFetch(`/api/ai/jobs/${jobId}/retry`, { method: 'POST' });
      await fetchAiJobs(true);
      notifyJobsUpdated();
      setStatusMsg('已重新提交至后端 AI 转换队列。');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '重试后台任务失败');
    } finally {
      setBusyJobActionId(null);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    setBusyJobActionId(jobId);
    setErrorMsg('');
    try {
      await apiFetch(`/api/ai/jobs/${jobId}`, { method: 'DELETE' });
      await fetchAiJobs(true);
      notifyJobsUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '删除任务记录失败');
    } finally {
      setBusyJobActionId(null);
    }
  };

  const handleLoadJobIntoStudio = async (jobId: string) => {
    setLoadingJobId(jobId);
    setErrorMsg('');
    try {
      const res = await apiFetch<{ job: AiConversionJobDetail }>(`/api/ai/jobs/${jobId}`);
      const job = res.job;
      setOriginalSourceText(job.sourceText || '');
      if (job.sourceFilename) {
        setUploadedFilename(job.sourceFilename);
      }
      const destBank = job.importedBankId || job.targetBankId;
      if (destBank) {
        setTargetBankId(destBank);
      }
      applyDraftsResult(
        job.resultDrafts || [],
        job.resultSummary || EMPTY_SUMMARY,
        job.resultCanonicalText || '',
        true
      );
      setActiveTab('ai-studio');
      setStatusMsg(
        `已从后台任务「${job.sourceFilename || job.id.slice(0, 8)}」载入 ${
          job.resultSummary.total
        } 道试题到工作台，可继续核对编辑或入库。`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '加载后台任务详情失败');
    } finally {
      setLoadingJobId(null);
    }
  };

  const handleRuleParseNow = async () => {
    const sourceText = (viewingOriginal ? originalSourceText : editorText).trim();
    if (!sourceText) {
      setErrorMsg('编辑器为空，请先填入试题文本');
      return;
    }
    setProcessing(true);
    setErrorMsg('');
    try {
      const res = await apiFetch<{
        drafts: ParsedQuestionDraft[];
        summary: ImportValidationSummary;
        canonicalText: string;
      }>('/api/import/parse-text', {
        method: 'POST',
        json: {
          text: sourceText,
          defaultChapter,
          bankId: targetBankId !== '__new__' ? targetBankId : undefined,
        },
      });
      setOriginalSourceText(sourceText);
      applyDraftsResult(res.drafts, res.summary, res.canonicalText, true);
      setStatusMsg(
        `规则解析并规范化完成：共 ${res.summary.total} 题（合格 ${res.summary.validCount} 题，错误 ${res.summary.errorCount} 题）。`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '规则解析失败');
    } finally {
      setProcessing(false);
    }
  };

  const handleAiRepairAll = async () => {
    if (drafts.length === 0) return;
    setRepairing(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const res = await apiFetch<{
        drafts: ParsedQuestionDraft[];
        summary: ImportValidationSummary;
        canonicalText: string;
        repairedCount: number;
        modelUsed: string;
      }>('/api/ai/repair', {
        method: 'POST',
        json: {
          drafts,
          fillMissingExplanation: true,
          bankId: targetBankId !== '__new__' ? targetBankId : undefined,
        },
      });
      applyDraftsResult(res.drafts, res.summary, res.canonicalText, true);
      setStatusMsg(
        `DeepSeek (${res.modelUsed}) 已完成质检修复：共优化修复 ${res.repairedCount} 道题目！`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI 修复失败');
    } finally {
      setRepairing(false);
    }
  };

  const handleAiGenerate = async () => {
    if (!topicMaterial.trim()) {
      setErrorMsg('请输入知识点主题或粘贴复习资料');
      return;
    }
    setProcessing(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const data = await apiFetch<{
        drafts: ParsedQuestionDraft[];
        summary: ImportValidationSummary;
        canonicalText: string;
        count: number;
        modelUsed: string;
      }>('/api/ai/generate', {
        method: 'POST',
        json: {
          topicOrMaterial: topicMaterial,
          singleCount,
          multipleCount,
          booleanCount,
          fillCount,
          shortCount,
          difficulty,
          chapterTitle: defaultChapter,
        },
      });
      applyDraftsResult(data.drafts, data.summary, data.canonicalText, true);
      setActiveTab('ai-studio');
      setStatusMsg(
        `DeepSeek (${data.modelUsed}) 成功命制 ${data.count} 道规范试题，已同步至左右分栏工作台！`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI 出题失败');
    } finally {
      setProcessing(false);
    }
  };

  const mutateDraftAndSync = (nextRawDrafts: ParsedQuestionDraft[]) => {
    const validated = validateDraftBatch(nextRawDrafts);
    applyDraftsResult(validated.drafts, validated.summary, undefined, true);
  };

  const updateDraftField = (idx: number, patch: Partial<ParsedQuestionDraft>) => {
    const next = drafts.map((d, i) => {
      if (i !== idx) return d;
      const updated = { ...d, ...patch };
      if (patch.type === 'boolean') {
        updated.options = [
          { key: 'A', content: '正确' },
          { key: 'B', content: '错误' },
        ];
        if (updated.answer !== 'A' && updated.answer !== 'B') updated.answer = 'A';
      } else if (
        (patch.type === 'single' || patch.type === 'multiple') &&
        updated.options.length < 2
      ) {
        updated.options = [
          { key: 'A', content: '选项A' },
          { key: 'B', content: '选项B' },
          { key: 'C', content: '选项C' },
          { key: 'D', content: '选项D' },
        ];
      } else if (patch.type === 'fill' || patch.type === 'short') {
        updated.options = [];
      }
      return updated;
    });
    const validated = validateDraftBatch(next);
    setDrafts(validated.drafts);
    setSummary(validated.summary);
    skipNextDebounceRef.current = true;
    setEditorText(formatDraftsToCanonicalText(validated.drafts));
  };

  const removeDraft = (idx: number) => {
    const next = drafts.filter((_, i) => i !== idx);
    mutateDraftAndSync(next);
  };

  const exportCanonicalJson = () => {
    const payload = {
      schemaVersion: STANDARD_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      questions: drafts.map((d) => ({
        type: d.type,
        stem: d.stem,
        options: d.options,
        answer: d.answer,
        explanation: d.explanation,
        chapterTitle: d.chapterTitle,
        difficulty: d.difficulty,
        tags: d.tags,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `棱题PrismQ_标准题库_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyCanonicalText = async () => {
    const text = formatDraftsToCanonicalText(drafts);
    await navigator.clipboard.writeText(text);
    setCopiedCanonical(true);
    setTimeout(() => setCopiedCanonical(false), 1800);
  };

  const handleCommitToBank = async () => {
    if (drafts.length === 0) return;
    if (summary.errorCount > 0 && !skipInvalidOnCommit) {
      setErrorMsg(
        `尚有 ${summary.errorCount} 道存在阻塞错误的试题，请先修复（或点击「AI 一键修复」），也可勾选「跳过错误题」仅导入合格试题。`
      );
      setFilterMode('error');
      return;
    }

    setCommitting(true);
    setErrorMsg('');
    try {
      let bankId = targetBankId;
      if (bankId === '__new__' || (!bankId && newBankTitle.trim()) || banks.length === 0) {
        const title = newBankTitle.trim() || `AI 导入题库 ${new Date().toLocaleDateString()}`;
        const created = await apiFetch<{ id: string }>('/api/banks', {
          method: 'POST',
          json: { title, category: '智能导题', visibility: 'private' },
        });
        bankId = created.id;
      }

      const res = await apiFetch<{ insertedCount: number; skippedCount: number }>(
        `/api/banks/${bankId}/questions/batch`,
        {
          method: 'POST',
          json: {
            questions: drafts,
            skipInvalid: skipInvalidOnCommit,
          },
        }
      );
      setStatusMsg(
        `成功入库 ${res.insertedCount} 道规范试题${
          res.skippedCount > 0 ? `（已跳过 ${res.skippedCount} 道错误题）` : ''
        }！正在跳转至题库...`
      );
      setTimeout(() => navigate(`/banks/${bankId}`), 700);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '批量入库失败');
    } finally {
      setCommitting(false);
    }
  };

  const filteredDraftEntries = useMemo(() => {
    return drafts
      .map((draft, idx) => ({ draft, idx }))
      .filter(({ draft }) => {
        if (filterMode === 'error') return draft.errors.length > 0;
        if (filterMode === 'warning') return draft.warnings.length > 0 || draft.isDuplicate;
        return true;
      });
  }, [drafts, filterMode]);

  return (
    <div className="space-y-6 pb-20">
      {/* 页头与规范资源入口 */}
      <PageHeader
        title="题库导题中心（Excel / Word 标准导题 & AI 工作台）"
        description={`支持按照规范化 Excel (.xlsx/.csv) 或 Word (.docx) 文档免 AI 秒级直导题库，亦可通过 AI 智能清洗任意杂乱试卷（Schema: ${STANDARD_SCHEMA_VERSION}）`}
        actions={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void downloadWithAuth('/api/import/template', '棱题PrismQ_标准导题模板.xlsx')
              }
              icon={<Download className="h-3.5 w-3.5 text-emerald-600" />}
            >
              下载标准 Excel 模板 (.xlsx)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void downloadWithAuth('/api/import/template-word', '棱题PrismQ_标准导题模板.docx')
              }
              icon={<Download className="h-3.5 w-3.5 text-brand-600" />}
            >
              下载标准 Word 模板 (.docx)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setActiveTab('spec')}
              icon={<BookOpen className="h-3.5 w-3.5 text-slate-700" />}
            >
              格式规范说明
            </Button>
          </>
        }
      />

      {/* 未配置 AI Key 引导提醒（仅在 AI 相关 Tab 显示，Excel/Word 标准导题无需 AI Key） */}
      {!aiAvailable && (activeTab === 'ai-studio' || activeTab === 'ai-jobs' || activeTab === 'ai-generate') && (
        <Alert
          tone="warning"
          action={
            <Link
              to="/settings"
              className="inline-flex h-8 items-center rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white transition hover:bg-amber-700"
            >
              立即前往设置 →
            </Link>
          }
        >
          {user?.role === 'admin' ? (
            <>
              检测到当前尚未启用可用的 AI 服务。您可以在个人中心配置 <strong>个人 API Key</strong> 或设置全站全局 AI 服务，解锁杂乱文档智能洗题、自动补解析与 AI 出题。
            </>
          ) : (
            <>
              检测到当前尚未配置您个人的 <strong>AI API Key</strong>。配置后可将杂乱 Word / PDF / 讲义一键整理为标准题库，并解锁 AI 修复与智能出题（仍可免费使用规则快速解析与模板导题）。
            </>
          )}
        </Alert>
      )}

      {/* 主模式切换 Tab */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'standard-doc',
            label: 'Excel / Word 标准文档导题',
            icon: <FileUp className="h-3.5 w-3.5" />,
          },
          {
            key: 'ai-studio',
            label: 'AI 智能导题 & 文本工作台',
            icon: <Sparkles className="h-3.5 w-3.5" />,
          },
          {
            key: 'ai-jobs',
            label: '后台转换任务',
            icon: <Clock className="h-3.5 w-3.5" />,
            badge: activeJobCount > 0 ? activeJobCount : jobs.length > 0 ? jobs.length : undefined,
          },
          {
            key: 'ai-generate',
            label: 'AI 按主题 / 讲义自动出题',
            icon: <Wand2 className="h-3.5 w-3.5" />,
          },
          {
            key: 'spec',
            label: '标准格式规范与 Schema 中心',
            icon: <Code2 className="h-3.5 w-3.5" />,
          },
        ]}
      />

      {/* 全局错误/进度反馈 */}
      {errorMsg && <Alert tone="error">{errorMsg}</Alert>}
      {statusMsg && <Alert tone="success">{statusMsg}</Alert>}

      {/* 进行中的后台转换任务实时状态条 */}
      {activeTab !== 'ai-jobs' &&
        activeJobCount > 0 &&
        (() => {
          const runningJobs = jobs.filter(
            (j) => j.status === 'queued' || j.status === 'running'
          );
          const lead = runningJobs[0];
          if (!lead) return null;
          return (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-950">
                  <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
                  <span>
                    后端 AI 转换进行中：{lead.sourceFilename || '文本任务'}
                    {runningJobs.length > 1 ? `（另有 ${runningJobs.length - 1} 项任务）` : ''}
                  </span>
                  <Badge tone="brand">{lead.progressPct}%</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setActiveTab('ai-jobs')}
                    icon={<ListChecks className="h-3.5 w-3.5" />}
                  >
                    查看任务队列 ({runningJobs.length})
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyJobActionId === lead.id}
                    onClick={() => void handleCancelJob(lead.id)}
                    className="text-rose-600 hover:bg-rose-100/70"
                  >
                    取消
                  </Button>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-indigo-800">{lead.progressMessage}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                  style={{ width: `${lead.progressPct}%` }}
                />
              </div>
            </div>
          );
        })()}

      {/* ==================== TAB 1：Excel / Word 标准文档导题 & TAB 2：AI 智能工作台 ==================== */}
      {(activeTab === 'standard-doc' || activeTab === 'ai-studio') && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            {activeTab === 'standard-doc' ? (
              /* 左侧栏（标准文档导题模式）：模板下载 + 规范说明 + Excel/Word 上传 + 快速建库设置 */
              <Card padding="md" className="flex flex-col justify-between space-y-5">
                <div className="space-y-4">
                  <CardHeader
                    title="按规范化 Excel / Word 文档直接导入题库"
                    subtitle="无需消耗 AI Token，按模板或通用规范排版的 Excel (.xlsx/.xls/.csv) 与 Word (.docx) 可直接秒级解析入库"
                    icon={<FileUp className="h-4 w-4 text-brand-600" />}
                  />

                  {/* 双标准模板卡片 */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col justify-between rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-emerald-950">
                            规范方式一：Excel 标准表格
                          </span>
                          <Badge tone="success">.xlsx / .xls / .csv</Badge>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                          表头含 <code>章节、题型、题干、选项A~F、正确答案、解析、难度、标签</code>，支持多 Sheet 自动按工作表名分章。
                        </p>
                      </div>
                      <div className="mt-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void downloadWithAuth(
                              '/api/import/template',
                              '棱题PrismQ_标准导题模板.xlsx'
                            )
                          }
                          icon={<Download className="h-3.5 w-3.5 text-emerald-600" />}
                        >
                          下载标准 Excel 模板
                        </Button>
                      </div>
                    </div>

                    <div className="flex flex-col justify-between rounded-xl border border-brand-200 bg-brand-50/40 p-3.5">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-brand-950">
                            规范方式二：Word 标准文档
                          </span>
                          <Badge tone="brand">.docx</Badge>
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                          同时兼容 <strong>Word 标准段落</strong>（<code># 章节</code>、<code>1. [单选题] 题干</code>、<code>A. 选项</code>、<code>答案：A</code> 或文末集中 <code>参考答案</code>）与 <strong>Word 表格题库</strong>。
                        </p>
                      </div>
                      <div className="mt-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            void downloadWithAuth(
                              '/api/import/template-word',
                              '棱题PrismQ_标准导题模板.docx'
                            )
                          }
                          icon={<Download className="h-3.5 w-3.5 text-brand-600" />}
                        >
                          下载标准 Word 模板
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* 大号标准文档拖拽上传区 */}
                  <div
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (file) void handleFileSelected(file);
                    }}
                    onClick={() => standardDocInputRef.current?.click()}
                    className="cursor-pointer rounded-xl border-2 border-dashed border-brand-300 bg-brand-50/20 px-5 py-8 text-center transition hover:border-brand-500 hover:bg-brand-50/40"
                  >
                    <input
                      ref={standardDocInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,.docx,.json"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleFileSelected(f);
                        e.target.value = '';
                      }}
                    />
                    <UploadCloud className="mx-auto h-9 w-9 text-brand-600" />
                    <p className="mt-2.5 text-sm font-bold text-slate-900">
                      {uploadedFilename
                        ? `已载入文档：${uploadedFilename}`
                        : '点击选择或将规范化 Excel / Word 题库文档拖入此处'}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      支持 <code>.xlsx</code>、<code>.xls</code>、<code>.csv</code>、<code>.docx</code>（Word 段落式或表格式均可自动识别）与 <code>.json</code>
                    </p>
                    {detectedFormat && (
                      <div className="mt-3 inline-flex items-center gap-2">
                        <Badge tone="brand">
                          识别类型：{SOURCE_FORMAT_LABELS[detectedFormat] || detectedFormat}
                        </Badge>
                        <Badge tone="success">已解析 {summary.total} 题</Badge>
                      </div>
                    )}
                  </div>

                  {/* 导入配置：目标题库 & 默认章节 */}
                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS}>导入至目标题库</label>
                      <select
                        value={targetBankId}
                        onChange={(e) => setTargetBankId(e.target.value)}
                        className={`${SELECT_CLS} w-full`}
                      >
                        {banks.map((b) => (
                          <option key={b.id} value={b.id}>
                            现有题库：{b.title}
                          </option>
                        ))}
                        <option value="__new__">+ 直接新建一个私有题库</option>
                      </select>
                    </div>

                    {(targetBankId === '__new__' || banks.length === 0) ? (
                      <div>
                        <label className={LABEL_CLS}>新题库名称（默认取文件名）</label>
                        <input
                          type="text"
                          value={newBankTitle}
                          onChange={(e) => setNewBankTitle(e.target.value)}
                          placeholder="如：2026 计算机网络题库"
                          className={INPUT_CLS}
                        />
                      </div>
                    ) : (
                      <div>
                        <label className={LABEL_CLS}>默认归属章节（文档未标注章节时使用）</label>
                        <input
                          type="text"
                          value={defaultChapter}
                          onChange={(e) => setDefaultChapter(e.target.value)}
                          placeholder="如：第一章 基础知识"
                          className={INPUT_CLS}
                        />
                      </div>
                    )}
                  </div>

                  {/* 格式速查提示 */}
                  <div className="rounded-xl border border-slate-200 bg-white p-3.5 text-xs leading-relaxed text-slate-600">
                    <div className="font-bold text-slate-800">Word / Excel 规范化识别要点：</div>
                    <ul className="mt-1.5 list-disc space-y-1 pl-4">
                      <li>
                        <strong>Word 段落模式</strong>：题号支持 <code>1.</code> / <code>1、</code> / <code>(1)</code>，题型可标 <code>[单选题]</code> / <code>【多选题】</code> 或使用大标题 <code>一、单选题</code>；答案行支持 <code>答案：A</code> 或在题干括号内直接写 <code>（ A ）</code>，亦支持试卷末尾集中附 <code>参考答案</code> 自动配对。
                      </li>
                      <li>
                        <strong>Word 表格 / Excel 模式</strong>：第一行为表头（含 <code>题干/题目</code>、<code>选项A~D</code> 或合并 <code>选项</code> 列、<code>正确答案</code>、<code>解析</code>、<code>章节</code>），判断题答案写 <code>正确/错误</code> 或 <code>对/错</code> 或 <code>A/B</code> 均可。
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setActiveTab('ai-studio')}
                    icon={<Edit3 className="h-3.5 w-3.5" />}
                  >
                    切换到文本编辑器 / AI 洗题工作台
                  </Button>

                  {drafts.length > 0 && (
                    <Button
                      variant="success"
                      loading={committing}
                      disabled={summary.validCount === 0}
                      onClick={() => void handleCommitToBank()}
                      icon={!committing ? <Plus className="h-4 w-4" /> : undefined}
                    >
                      立即导入题库 ({skipInvalidOnCommit ? summary.validCount : summary.total} 题)
                    </Button>
                  )}
                </div>
              </Card>
            ) : (
            /* 左侧栏：上传 + AI 清洗 + 标准文本编辑器 */
            <Card padding="md" className="flex flex-col">
              {/* 文件拖放上传区 */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files?.[0];
                  if (file) void handleFileSelected(file);
                }}
                onClick={() => fileInputRef.current?.click()}
                className="cursor-pointer rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/70 p-4 text-center transition hover:border-brand-400 hover:bg-brand-50/30"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx,.pdf,.txt,.md,.gift,.xlsx,.xls,.csv,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleFileSelected(f);
                    e.target.value = '';
                  }}
                />
                <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-semibold text-slate-800">
                  <UploadCloud className="h-5 w-5 text-brand-600" />
                  <span>
                    {uploadedFilename
                      ? `已载入：${uploadedFilename}（点击或拖入新文件替换）`
                      : '点击或拖入文件（Word .docx / PDF / Excel / TXT / MD / GIFT / JSON）'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Word / PDF / TXT 会先提取文本供 AI 清洗规范化；Excel / JSON 将直接转为标准试题格式
                </p>
              </div>

              {/* AI 清洗选项 + 默认章节 + 后台队列/自动入库策略 */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS}>默认归属章节（可选）</label>
                  <input
                    type="text"
                    value={defaultChapter}
                    onChange={(e) => setDefaultChapter(e.target.value)}
                    placeholder="如：第一章 基础知识"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS}>转换目标题库（可选 / 自动入库使用）</label>
                  <select
                    value={targetBankId}
                    onChange={(e) => setTargetBankId(e.target.value)}
                    className={`${SELECT_CLS} w-full`}
                  >
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        现有题库：{b.title}
                      </option>
                    ))}
                    <option value="__new__">+ 直接新建一个私有题库</option>
                  </select>
                </div>
              </div>

              {(targetBankId === '__new__' || banks.length === 0) && (
                <div className="mt-2.5">
                  <input
                    type="text"
                    value={newBankTitle}
                    onChange={(e) => setNewBankTitle(e.target.value)}
                    placeholder="自动新建私有题库名称（留空则自动使用上传文件名）"
                    className={INPUT_CLS}
                  />
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs text-slate-700">
                <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-indigo-800">
                  <input
                    type="checkbox"
                    checked={backgroundMode}
                    onChange={(e) => setBackgroundMode(e.target.checked)}
                  />
                  启用后台异步转换（离开或关闭页面不中断）
                </label>
                <label
                  className="flex items-center gap-1.5 cursor-pointer"
                  title="后端转换完成后自动跳过异常题并将合格试题直接写入目标题库"
                >
                  <input
                    type="checkbox"
                    checked={autoImportOnComplete}
                    onChange={(e) => setAutoImportOnComplete(e.target.checked)}
                  />
                  转换完自动入库
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preserveOriginalWording}
                    onChange={(e) => setPreserveOriginalWording(e.target.checked)}
                  />
                  忠实保留原题措辞
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoGenerateExplanation}
                    onChange={(e) => setAutoGenerateExplanation(e.target.checked)}
                  />
                  自动补全解析
                </label>
                <label
                  className="flex items-center gap-1.5 cursor-pointer"
                  title="原文未附答案时让 AI 推导并打上提醒标记"
                >
                  <input
                    type="checkbox"
                    checked={autoInferMissingAnswer}
                    onChange={(e) => setAutoInferMissingAnswer(e.target.checked)}
                  />
                  无答案时 AI 推导
                </label>
              </div>

              {/* 核心操作按钮栏 */}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <input
                  ref={directBgFileInputRef}
                  type="file"
                  accept=".docx,.pdf,.txt,.md,.gift,.xlsx,.xls,.csv,.json"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleDirectFileToBackgroundJob(f);
                    e.target.value = '';
                  }}
                />
                <Button
                  variant="ai"
                  loading={backgroundMode ? submittingJob : processing}
                  onClick={() =>
                    void (backgroundMode
                      ? handleSubmitTextToBackgroundJob()
                      : handleAiExtractStream())
                  }
                  icon={
                    !(backgroundMode ? submittingJob : processing) ? (
                      <Sparkles className="h-4 w-4" />
                    ) : undefined
                  }
                >
                  {backgroundMode
                    ? submittingJob
                      ? '正在提交后台队列...'
                      : '提交 AI 后台转换'
                    : processing
                      ? 'AI 清洗转换中...'
                      : 'AI 实时整理为标准格式'}
                </Button>

                <Button
                  variant="secondary"
                  loading={submittingJob}
                  onClick={() => directBgFileInputRef.current?.click()}
                  icon={!submittingJob ? <UploadCloud className="h-3.5 w-3.5 text-indigo-600" /> : undefined}
                >
                  上传文件直转后台
                </Button>

                <Button
                  variant="secondary"
                  disabled={processing}
                  onClick={() => void handleRuleParseNow()}
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                >
                  规则快速解析
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => {
                    setViewingOriginal(false);
                    setEditorText(CANONICAL_FORMAT_SAMPLE);
                  }}
                >
                  填入标准示例
                </Button>

                {originalSourceText && (
                  <Button
                    variant={viewingOriginal ? 'primary' : 'secondary'}
                    onClick={() => setViewingOriginal((v) => !v)}
                    icon={<Eye className="h-3.5 w-3.5" />}
                  >
                    {viewingOriginal ? '返回标准编辑器' : '查看导入原文'}
                  </Button>
                )}

                {editorText && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditorText('');
                      setOriginalSourceText('');
                      setUploadedFilename('');
                      setDrafts([]);
                      setSummary(EMPTY_SUMMARY);
                    }}
                    className="ml-auto text-slate-600 hover:text-rose-600"
                  >
                    清空
                  </Button>
                )}
              </div>

              {/* AI 流式进度条 */}
              {processing && progressMsg && (
                <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
                  <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-indigo-800">
                    <span>{progressMsg}</span>
                    <span className="tabular-nums">{progressPct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-indigo-100">
                    <div
                      className="h-full rounded-full bg-indigo-600 transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* 带行号槽的等宽编辑器 */}
              <div className="mt-3.5 flex flex-1 overflow-hidden rounded-xl border border-slate-300 bg-slate-950/5">
                <div
                  ref={gutterRef}
                  className="w-11 shrink-0 select-none overflow-hidden border-r border-slate-200 bg-slate-100 py-3 text-right font-mono text-[12px] leading-6 text-slate-500 tabular-nums"
                >
                  {lineNumbers.map((ln) => (
                    <div
                      key={ln}
                      className={`px-2 ${
                        highlightedLine === ln
                          ? 'bg-amber-300 font-bold text-slate-900'
                          : ''
                      }`}
                    >
                      {ln}
                    </div>
                  ))}
                </div>
                <textarea
                  ref={textareaRef}
                  onScroll={syncScroll}
                  readOnly={viewingOriginal}
                  value={viewingOriginal ? originalSourceText : editorText}
                  onChange={(e) => setEditorText(e.target.value)}
                  placeholder={`在这里粘贴任何杂乱的试卷、Word/PDF 提取内容或复习笔记，点击上方「AI 智能整理为标准格式」即可自动洗成统一规范格式！\n\n也可以直接按「棱题 · PrismQ 标准格式」编辑（左侧输入，右侧实时预览并校对）：\n1. [单选题] 题目内容...\nA. 选项A\nB. 选项B\n答案：A\n解析：解析内容...`}
                  className="h-[520px] w-full flex-1 resize-none bg-white p-3 font-mono text-[13px] leading-6 text-slate-800 focus:outline-none"
                />
              </div>
            </Card>
            )}

            {/* 右侧栏：实时标准试题预览与合规体检中心 */}
            <Card padding="md" className="flex flex-col">
              {/* 体检统计栏 */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setFilterMode('all')}
                    className={`rounded-lg px-2.5 py-1 font-semibold tabular-nums transition ${
                      filterMode === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                    }`}
                  >
                    全部 {summary.total}
                  </button>
                  <Badge tone="success" className="px-2.5 py-1 text-xs tabular-nums">
                    合格 {summary.validCount}
                  </Badge>
                  <button
                    type="button"
                    onClick={() => setFilterMode(filterMode === 'error' ? 'all' : 'error')}
                    className={`rounded-lg px-2.5 py-1 font-semibold tabular-nums transition ${
                      filterMode === 'error'
                        ? 'bg-rose-600 text-white'
                        : summary.errorCount > 0
                          ? 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    错误 {summary.errorCount}
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterMode(filterMode === 'warning' ? 'all' : 'warning')}
                    className={`rounded-lg px-2.5 py-1 font-semibold tabular-nums transition ${
                      filterMode === 'warning'
                        ? 'bg-amber-500 text-white'
                        : summary.warningCount > 0
                          ? 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    提示 {summary.warningCount}
                  </button>
                  {summary.duplicateCount > 0 && (
                    <Badge tone="ai" className="px-2.5 py-1 text-xs tabular-nums">
                      重复 {summary.duplicateCount}
                    </Badge>
                  )}
                </div>

                {/* 右侧质检与导出快捷按钮 */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {drafts.length > 0 && (summary.errorCount > 0 || summary.warningCount > 0) && (
                    <Button
                      variant="ai"
                      size="sm"
                      loading={repairing}
                      onClick={() => void handleAiRepairAll()}
                      icon={!repairing ? <Sparkles className="h-3.5 w-3.5" /> : undefined}
                    >
                      AI 一键修复/补解析
                    </Button>
                  )}

                  {drafts.length > 0 && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void copyCanonicalText()}
                        icon={
                          copiedCanonical ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )
                        }
                      >
                        复制标准文本
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={exportCanonicalJson}
                        icon={<Download className="h-3.5 w-3.5" />}
                      >
                        JSON
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* 实时预览卡片滚动画布 */}
              <div className="mt-3 h-[585px] flex-1 space-y-3 overflow-y-auto pr-1">
                {drafts.length === 0 ? (
                  <div className="flex h-full items-center justify-center">
                    <EmptyState
                      icon={<Sparkles className="h-10 w-10 text-slate-300" />}
                      title="实时标准试题预览区"
                      description="在左侧上传 Word/PDF/Excel 或粘贴试题文本后，这里将实时呈现符合标准的考试卡片，并自动进行选项闭环、答案缺失、空位匹配与重复校验。"
                    />
                  </div>
                ) : filteredDraftEntries.length === 0 ? (
                  <div className="py-16 text-center text-xs text-slate-500">
                    当前筛选分类下没有题目
                  </div>
                ) : (
                  filteredDraftEntries.map(({ draft, idx }) => {
                    const hasError = draft.errors.length > 0;
                    const hasWarn = draft.warnings.length > 0;
                    const isEditing = editingIndex === idx;

                    return (
                      <div
                        key={draft.tempId}
                        className={`rounded-xl border p-4 transition ${
                          hasError
                            ? 'border-rose-300 bg-rose-50/40'
                            : hasWarn
                              ? 'border-amber-200 bg-amber-50/30'
                              : 'border-slate-200 bg-white'
                        }`}
                      >
                        {/* 卡片头部 */}
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-bold text-slate-600 tabular-nums">
                              #{idx + 1}
                            </span>
                            <Badge tone="brand">{QUESTION_TYPE_LABELS[draft.type]}</Badge>
                            {draft.chapterTitle && <Badge tone="neutral">{draft.chapterTitle}</Badge>}
                            {draft.sourceLine && (
                              <button
                                type="button"
                                onClick={() => jumpToLine(draft.sourceLine)}
                                title="点击在左侧编辑器高亮定位"
                                className="inline-flex items-center gap-0.5 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 transition hover:bg-brand-100 hover:text-brand-700"
                              >
                                <LocateFixed className="h-3 w-3" />L{draft.sourceLine}
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setEditingIndex(isEditing ? null : idx)}
                              icon={<Edit3 className="h-3 w-3" />}
                              className="h-7 px-2 text-[11px]"
                            >
                              {isEditing ? '收起' : '编辑'}
                            </Button>
                            <button
                              type="button"
                              onClick={() => removeDraft(idx)}
                              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-100 hover:text-rose-600"
                              title="移除此题"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* 阻塞错误与建议警告 */}
                        {draft.errors.length > 0 && (
                          <div className="mb-2 space-y-1">
                            {draft.errors.map((err, ei) => (
                              <div
                                key={ei}
                                className="flex items-center gap-1.5 rounded-lg bg-rose-100/90 px-2.5 py-1 text-[11px] font-semibold text-rose-800"
                              >
                                <XCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>{err}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {draft.warnings.length > 0 && (
                          <div className="mb-2 space-y-1">
                            {draft.warnings.map((w, wi) => (
                              <div
                                key={wi}
                                className="flex items-center gap-1.5 rounded-lg bg-amber-100/80 px-2.5 py-1 text-[11px] font-medium text-amber-900"
                              >
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                                <span>{w}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {!isEditing ? (
                          /* 预览态 */
                          <>
                            <p className="whitespace-pre-wrap text-sm font-medium text-slate-900">
                              {draft.stem || '（空题干）'}
                            </p>
                            {draft.options.length > 0 && (
                              <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs sm:grid-cols-2">
                                {draft.options.map((opt) => (
                                  <div
                                    key={opt.key}
                                    className={`rounded-lg px-2.5 py-1.5 ${
                                      draft.answer.includes(opt.key)
                                        ? 'bg-emerald-50 font-semibold text-emerald-800 ring-1 ring-emerald-200'
                                        : 'bg-slate-50 text-slate-700'
                                    }`}
                                  >
                                    {opt.key}. {opt.content}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="mt-2.5 border-t border-slate-100 pt-2 text-xs">
                              <span className="font-bold text-emerald-700">
                                答案：
                                {draft.type === 'boolean'
                                  ? draft.answer === 'A'
                                    ? '正确'
                                    : draft.answer === 'B'
                                      ? '错误'
                                      : '未设置'
                                  : draft.answer || '未设置'}
                              </span>
                              {draft.explanation && (
                                <p className="mt-0.5 text-slate-600">解析：{draft.explanation}</p>
                              )}
                            </div>
                          </>
                        ) : (
                          /* 结构化直观编辑态 */
                          <div className="mt-2 space-y-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="grid grid-cols-2 gap-2">
                              <select
                                value={draft.type}
                                onChange={(e) =>
                                  updateDraftField(idx, { type: e.target.value as QuestionType })
                                }
                                className={`${SELECT_CLS} h-8 text-xs font-semibold`}
                              >
                                {Object.entries(QUESTION_TYPE_LABELS).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="text"
                                value={draft.chapterTitle}
                                onChange={(e) =>
                                  updateDraftField(idx, { chapterTitle: e.target.value })
                                }
                                placeholder="所属章节"
                                className={`${INPUT_CLS} h-8 text-xs`}
                              />
                            </div>

                            <textarea
                              rows={2}
                              value={draft.stem}
                              onChange={(e) => updateDraftField(idx, { stem: e.target.value })}
                              className={`${TEXTAREA_CLS} p-2 text-xs font-medium`}
                            />

                            {(draft.type === 'single' || draft.type === 'multiple') && (
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-[11px] text-slate-600">
                                  <span>点击左侧字母按钮可直接设为正确答案：</span>
                                  {draft.options.length < 8 && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextKey = String.fromCharCode(
                                          65 + draft.options.length
                                        );
                                        updateDraftField(idx, {
                                          options: [
                                            ...draft.options,
                                            { key: nextKey, content: '' },
                                          ],
                                        });
                                      }}
                                      className="font-semibold text-brand-600 hover:underline"
                                    >
                                      + 增加选项
                                    </button>
                                  )}
                                </div>
                                {draft.options.map((opt, oIdx) => {
                                  const activeAns = draft.answer.includes(opt.key);
                                  return (
                                    <div key={opt.key} className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (draft.type === 'single') {
                                            updateDraftField(idx, { answer: opt.key });
                                          } else {
                                            const set = new Set(
                                              draft.answer.split('').filter(Boolean)
                                            );
                                            if (set.has(opt.key)) set.delete(opt.key);
                                            else set.add(opt.key);
                                            updateDraftField(idx, {
                                              answer: Array.from(set).sort().join(''),
                                            });
                                          }
                                        }}
                                        className={`h-7 w-7 shrink-0 rounded-md border text-xs font-bold transition ${
                                          activeAns
                                            ? 'border-emerald-600 bg-emerald-600 text-white'
                                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                        }`}
                                      >
                                        {opt.key}
                                      </button>
                                      <input
                                        type="text"
                                        value={opt.content}
                                        onChange={(e) => {
                                          const nextOpts: QuestionOption[] = [...draft.options];
                                          nextOpts[oIdx] = { ...opt, content: e.target.value };
                                          updateDraftField(idx, { options: nextOpts });
                                        }}
                                        className={`${INPUT_CLS} h-8 flex-1 text-xs`}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {draft.type === 'boolean' && (
                              <div className="flex gap-2">
                                {[
                                  { k: 'A', label: '正确 (A)' },
                                  { k: 'B', label: '错误 (B)' },
                                ].map((b) => (
                                  <button
                                    key={b.k}
                                    type="button"
                                    onClick={() => updateDraftField(idx, { answer: b.k })}
                                    className={`flex-1 rounded-lg border py-1.5 text-xs font-semibold transition ${
                                      draft.answer === b.k
                                        ? 'border-emerald-600 bg-emerald-600 text-white'
                                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    {b.label}
                                  </button>
                                ))}
                              </div>
                            )}

                            {(draft.type === 'fill' || draft.type === 'short') && (
                              <input
                                type="text"
                                value={draft.answer}
                                onChange={(e) => updateDraftField(idx, { answer: e.target.value })}
                                placeholder={
                                  draft.type === 'fill'
                                    ? '填空答案，多空用 | 隔开'
                                    : '参考答案要点'
                                }
                                className={`${INPUT_CLS} h-8 text-xs font-semibold text-emerald-700`}
                              />
                            )}

                            <textarea
                              rows={2}
                              value={draft.explanation}
                              onChange={(e) =>
                                updateDraftField(idx, { explanation: e.target.value })
                              }
                              placeholder="答案解析..."
                              className={`${TEXTAREA_CLS} p-2 text-xs`}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </Card>
          </div>

          {/* 底部吸顶目标题库与入库栏 */}
          {drafts.length > 0 && (
            <div className="sticky bottom-16 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur-md lg:bottom-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={targetBankId}
                  onChange={(e) => setTargetBankId(e.target.value)}
                  className={SELECT_CLS}
                >
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      目标题库：{b.title}
                    </option>
                  ))}
                  <option value="__new__">+ 直接新建一个私有题库</option>
                </select>

                {(targetBankId === '__new__' || banks.length === 0) && (
                  <input
                    type="text"
                    value={newBankTitle}
                    onChange={(e) => setNewBankTitle(e.target.value)}
                    placeholder="输入新题库名称..."
                    className={`${INPUT_CLS} w-52`}
                  />
                )}

                {summary.errorCount > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-rose-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipInvalidOnCommit}
                      onChange={(e) => setSkipInvalidOnCommit(e.target.checked)}
                    />
                    跳过 {summary.errorCount} 道错误题，仅入库合格的 {summary.validCount} 题
                  </label>
                )}
              </div>

              <Button
                variant="success"
                loading={committing}
                disabled={summary.validCount === 0}
                onClick={() => void handleCommitToBank()}
                icon={!committing ? <Plus className="h-4 w-4" /> : undefined}
              >
                确认入库 ({skipInvalidOnCommit ? summary.validCount : summary.total} 题)
              </Button>
            </div>
          )}
        </div>
      )}

      {/* ==================== TAB：后端 AI 异步转换任务中心 ==================== */}
      {activeTab === 'ai-jobs' && (
        <div className="space-y-5">
          <Card padding="lg" className="space-y-4">
            <CardHeader
              title="上传文档至后端异步 AI 转换队列"
              subtitle="文件上传后由后端提取内容并在异步队列持久化转换，支持大文件多段拆解，离开页面或关闭浏览器均不中断"
              icon={<UploadCloud className="h-4 w-4 text-indigo-600" />}
              action={
                editorText.trim() ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={submittingJob}
                    onClick={() => void handleSubmitTextToBackgroundJob()}
                    icon={<Sparkles className="h-3.5 w-3.5 text-indigo-600" />}
                  >
                    将当前工作台文本加入后台队列
                  </Button>
                ) : undefined
              }
            />

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files?.[0];
                if (file) void handleDirectFileToBackgroundJob(file);
              }}
              onClick={() => directBgFileInputRef.current?.click()}
              className="cursor-pointer rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/25 px-5 py-7 text-center transition hover:border-indigo-500 hover:bg-indigo-50/50"
            >
              <input
                ref={directBgFileInputRef}
                type="file"
                accept=".docx,.pdf,.txt,.md,.gift,.xlsx,.xls,.csv,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleDirectFileToBackgroundJob(f);
                  e.target.value = '';
                }}
              />
              <UploadCloud className="mx-auto h-8 w-8 text-indigo-600" />
              <p className="mt-2 text-sm font-bold text-slate-900">
                {submittingJob
                  ? '正在上传并加入后端队列...'
                  : '点击选择或拖入 Word / PDF / TXT / Excel / JSON 文档直接后台转换'}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                上传完成后立即进入后端队列，最大支持 30MB 文档（最多自动拆分为 30 段处理）
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 sm:grid-cols-3">
              <div>
                <label className={LABEL_CLS}>转换目标题库（可选）</label>
                <select
                  value={targetBankId}
                  onChange={(e) => setTargetBankId(e.target.value)}
                  className={`${SELECT_CLS} w-full`}
                >
                  {banks.map((b) => (
                    <option key={b.id} value={b.id}>
                      现有题库：{b.title}
                    </option>
                  ))}
                  <option value="__new__">+ 直接新建一个私有题库</option>
                </select>
              </div>
              {(targetBankId === '__new__' || banks.length === 0) ? (
                <div>
                  <label className={LABEL_CLS}>新建题库名称（留空取文件名）</label>
                  <input
                    type="text"
                    value={newBankTitle}
                    onChange={(e) => setNewBankTitle(e.target.value)}
                    placeholder="如：Java 程序设计习题"
                    className={INPUT_CLS}
                  />
                </div>
              ) : (
                <div>
                  <label className={LABEL_CLS}>默认归属章节（可选）</label>
                  <input
                    type="text"
                    value={defaultChapter}
                    onChange={(e) => setDefaultChapter(e.target.value)}
                    placeholder="如：第一章"
                    className={INPUT_CLS}
                  />
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 sm:pt-5 text-xs text-slate-700">
                <label className="flex items-center gap-1.5 cursor-pointer font-semibold text-emerald-700">
                  <input
                    type="checkbox"
                    checked={autoImportOnComplete}
                    onChange={(e) => setAutoImportOnComplete(e.target.checked)}
                  />
                  转换完成自动入库（跳过错误题）
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preserveOriginalWording}
                    onChange={(e) => setPreserveOriginalWording(e.target.checked)}
                  />
                  忠实保留原题措辞
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoGenerateExplanation}
                    onChange={(e) => setAutoGenerateExplanation(e.target.checked)}
                  />
                  自动补解析
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoInferMissingAnswer}
                    onChange={(e) => setAutoInferMissingAnswer(e.target.checked)}
                  />
                  无答案时 AI 推导
                </label>
              </div>
            </div>
          </Card>

          <Card padding="lg" className="space-y-4">
            <CardHeader
              title="后台转换任务记录"
              subtitle="所有任务与结果均持久化保存在服务器数据库，支持随时载入校对、取消、重试或直达入库题库"
              icon={<ListChecks className="h-4 w-4 text-brand-600" />}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  loading={jobsLoading}
                  onClick={() => void fetchAiJobs(false)}
                  icon={!jobsLoading ? <RefreshCw className="h-3.5 w-3.5" /> : undefined}
                >
                  刷新列表
                </Button>
              }
            />

            {jobs.length === 0 ? (
              <EmptyState
                icon={<Clock className="h-10 w-10 text-slate-300" />}
                title="暂无后台 AI 转换任务"
                description="在上方拖入 Word / PDF / Excel 文档，或在工作台点击「提交 AI 后台转换」，即可交由后端队列异步清洗转换。"
              />
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => {
                  const statusMeta = JOB_STATUS_META[job.status] || JOB_STATUS_META.queued;
                  const isActive = job.status === 'queued' || job.status === 'running';
                  const isBusy = busyJobActionId === job.id || loadingJobId === job.id;

                  return (
                    <div
                      key={job.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-slate-300"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-bold text-slate-900">
                              {job.sourceFilename || '手动提交文本'}
                            </span>
                            <Badge tone={statusMeta.tone}>{statusMeta.label}</Badge>
                            {job.modelUsed && <Badge tone="ai">{job.modelUsed}</Badge>}
                            {job.autoImport && <Badge tone="brand">自动入库</Badge>}
                          </div>
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                            <span>文本长度：{job.sourceCharCount} 字</span>
                            <span>创建于：{formatShortTime(job.createdAt)}</span>
                            {job.finishedAt && <span>完成于：{formatShortTime(job.finishedAt)}</span>}
                            {job.totalChunks > 0 && (
                              <span>
                                分段进度：{job.currentChunk} / {job.totalChunks}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {job.status === 'completed' && (
                            <Button
                              variant="primary"
                              size="sm"
                              loading={loadingJobId === job.id}
                              onClick={() => void handleLoadJobIntoStudio(job.id)}
                              icon={<Edit3 className="h-3.5 w-3.5" />}
                            >
                              载入校对/编辑
                            </Button>
                          )}

                          {job.importedBankId && (
                            <Button
                              variant="success"
                              size="sm"
                              onClick={() => navigate(`/banks/${job.importedBankId}`)}
                              icon={<ExternalLink className="h-3.5 w-3.5" />}
                            >
                              查看题库 ({job.importedCount}题)
                            </Button>
                          )}

                          {isActive && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => void handleCancelJob(job.id)}
                              icon={<Ban className="h-3.5 w-3.5 text-rose-600" />}
                              className="text-rose-600"
                            >
                              取消
                            </Button>
                          )}

                          {(job.status === 'failed' || job.status === 'cancelled') && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => void handleRetryJob(job.id)}
                              icon={<RotateCcw className="h-3.5 w-3.5 text-brand-600" />}
                            >
                              重试
                            </Button>
                          )}

                          {!isActive && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => void handleDeleteJob(job.id)}
                              title="删除记录"
                              className="rounded-lg p-1.5 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span
                            className={
                              job.status === 'failed'
                                ? 'font-medium text-rose-700'
                                : 'text-slate-600'
                            }
                          >
                            {job.status === 'failed' && job.errorMessage
                              ? `${job.progressMessage}：${job.errorMessage}`
                              : job.progressMessage}
                          </span>
                          <span className="font-semibold tabular-nums text-slate-700">
                            {job.progressPct}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              job.status === 'failed'
                                ? 'bg-rose-500'
                                : job.status === 'completed'
                                  ? 'bg-emerald-500'
                                  : job.status === 'cancelled'
                                    ? 'bg-slate-400'
                                    : 'bg-indigo-600'
                            }`}
                            style={{ width: `${job.progressPct}%` }}
                          />
                        </div>
                      </div>

                      {job.status === 'completed' && (
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                          <Badge tone="neutral">总识别 {job.resultSummary.total} 题</Badge>
                          <Badge tone="success">合格 {job.resultSummary.validCount} 题</Badge>
                          {job.resultSummary.errorCount > 0 && (
                            <Badge tone="danger">待修正 {job.resultSummary.errorCount} 题</Badge>
                          )}
                          {job.detectedAnswerKey && (
                            <Badge tone="ai">已自动匹配文末参考答案</Badge>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ==================== TAB 2：AI 自动出题 ==================== */}
      {activeTab === 'ai-generate' && (
        <Card padding="lg" className="space-y-5">
          <CardHeader
            title="AI 按主题 / 讲义自动命题"
            subtitle="输入考核知识点主题，或直接粘贴教材/复习讲义原文，生成后将自动进入左右分栏标准工作台供核对入库"
            icon={<Wand2 className="h-4 w-4 text-indigo-600" />}
          />
          <div>
            <label className={LABEL_CLS}>知识点主题或讲义材料</label>
            <textarea
              rows={6}
              value={topicMaterial}
              onChange={(e) => setTopicMaterial(e.target.value)}
              placeholder="例如：PostgreSQL 事务隔离级别与 GIN 索引优化；或者粘贴整篇技术文档/课堂笔记..."
              className={TEXTAREA_CLS}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <div>
              <label className={LABEL_CLS}>单选题数</label>
              <input
                type="number"
                min={0}
                max={20}
                value={singleCount}
                onChange={(e) => setSingleCount(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>多选题数</label>
              <input
                type="number"
                min={0}
                max={20}
                value={multipleCount}
                onChange={(e) => setMultipleCount(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>判断题数</label>
              <input
                type="number"
                min={0}
                max={20}
                value={booleanCount}
                onChange={(e) => setBooleanCount(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>填空题数</label>
              <input
                type="number"
                min={0}
                max={10}
                value={fillCount}
                onChange={(e) => setFillCount(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>简答题数</label>
              <input
                type="number"
                min={0}
                max={10}
                value={shortCount}
                onChange={(e) => setShortCount(Number(e.target.value))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>难度等级</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(Number(e.target.value))}
                className={`${SELECT_CLS} w-full`}
              >
                <option value={1}>1 - 基础入门</option>
                <option value={2}>2 - 常规巩固</option>
                <option value={3}>3 - 进阶应用</option>
                <option value={4}>4 - 综合拔高</option>
                <option value={5}>5 - 压轴挑战</option>
              </select>
            </div>
          </div>

          <Button
            variant="ai"
            size="lg"
            loading={processing}
            onClick={() => void handleAiGenerate()}
            icon={!processing ? <Wand2 className="h-4 w-4" /> : undefined}
          >
            {processing ? 'AI 正在出题中...' : '生成标准试题并进入校验工作台'}
          </Button>
        </Card>
      )}

      {/* ==================== TAB 3：标准格式规范与模板中心 ==================== */}
      {activeTab === 'spec' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card padding="lg" className="space-y-4">
            <CardHeader
              title="1. 棱题 · PrismQ 标准录题文本规范"
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setViewingOriginal(false);
                    setEditorText(CANONICAL_FORMAT_SAMPLE);
                    setActiveTab('ai-studio');
                  }}
                >
                  载入工作台试用 →
                </Button>
              }
            />
            <p className="text-xs leading-relaxed text-slate-600">
              AI 导题最终会自动为您清洗为以下整洁规范的文本格式；如果您手写整理或修改文本，也建议遵守此结构。填空空位统一用 <code>（____）</code>，多空用 <code>|</code> 分隔，同行或跨行选项均可识别。
            </p>
            <pre className="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
              {CANONICAL_FORMAT_SAMPLE}
            </pre>
          </Card>

          <Card padding="lg" className="space-y-4">
            <CardHeader
              title="2. 标准化 JSON Schema 与国际格式兼容"
              action={
                <a
                  href="/api/import/schema.json"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <Download className="h-3.5 w-3.5" />
                  获取 schema.json
                </a>
              }
            />
            <div className="space-y-2 text-xs text-slate-600">
              <p>
                • <strong>Excel / CSV 模板</strong>：点击顶部「标准 Excel 模板」下载，包含 <code>章节、题型、题干、选项A~F、正确答案、解析、难度、标签</code> 标准列，导出的题库也可原样再导回。
              </p>
              <p>
                • <strong>Aiken 标准格式</strong>：兼容 <code>A. ... / ANSWER: B</code> 纯英文/中文单选题格式。
              </p>
              <p>
                • <strong>Moodle GIFT 标准格式</strong>：兼容 <code>{'题干 {=正确答案 ~干扰项}'}</code>、<code>{'{T}/{F}'}</code> 及填空格式。
              </p>
            </div>
            <pre className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-slate-100">
              {JSON.stringify(STANDARD_QUESTION_BANK_JSON_SCHEMA, null, 2)}
            </pre>
          </Card>
        </div>
      )}
    </div>
  );
};
