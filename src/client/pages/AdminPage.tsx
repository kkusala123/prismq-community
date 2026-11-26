import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  Users,
  Clock,
  BookOpen,
  ClipboardCheck,
  History,
  UserPlus,
  KeyRound,
  Trash2,
  ArrowRightLeft,
  Globe,
  Lock,
  ExternalLink,
  RefreshCw,
  BarChart3,
  Power,
  Ban,
  CheckCircle2,
  Cpu,
  Upload,
  Smartphone,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../lib/auth';
import type {
  AdminAiJobItem,
  AdminAuditLogItem,
  AdminBankItem,
  AdminExamItem,
  AdminOverview,
  AdminUsageResponse,
  AdminUserItem,
  AppUpdateReleaseInfo,
  AppUpdateSyncResult,
  SystemPolicy,
} from '../../shared/types.js';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  INPUT_CLS,
  LABEL_CLS,
  Modal,
  PageHeader,
  SELECT_CLS,
  StatCard,
  Tabs,
  type TabItem,
} from '../components/ui';

type AdminTab = 'overview' | 'users' | 'usage' | 'banks' | 'exams' | 'audit';

function formatDuration(totalSeconds: number): string {
  const sec = Math.max(0, Math.round(totalSeconds || 0));
  if (sec === 0) return '0 分钟';
  if (sec < 60) return `${sec} 秒`;
  const totalMinutes = Math.floor(sec / 60);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins > 0 ? `${hours} 小时 ${mins} 分` : `${hours} 小时`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '从未活跃';
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  create_user: '新建账号',
  update_user: '修改用户',
  reset_password: '重置密码',
  delete_user: '删除用户',
  update_bank: '修改题库',
  delete_bank: '删除题库',
  update_exam: '管理考场',
  delete_exam: '删除考场',
  delete_ai_job: '清理AI任务',
  update_policy: '变更注册策略',
};

const USAGE_RANGE_OPTIONS: Array<{ key: '1' | '7' | '30' | '90' | 'all'; label: string }> = [
  { key: '1', label: '今日' },
  { key: '7', label: '近 7 天' },
  { key: '30', label: '近 30 天' },
  { key: '90', label: '近 90 天' },
  { key: 'all', label: '历史全部' },
];

export const AdminPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [banner, setBanner] = useState<{ tone: 'success' | 'error' | 'info'; message: string } | null>(
    null
  );

  // 总览数据
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Android 安装包自托管分发
  const [appUpdateInfo, setAppUpdateInfo] = useState<{
    latest: AppUpdateReleaseInfo | null;
    connectedClients: number;
    lastCheckedAt: string | null;
  } | null>(null);
  const [apkFile, setApkFile] = useState<File | null>(null);
  const [apkVersion, setApkVersion] = useState('');
  const [apkVersionCode, setApkVersionCode] = useState('');
  const [apkNotes, setApkNotes] = useState('');
  const [apkForceUpdate, setApkForceUpdate] = useState(false);
  const [uploadingApk, setUploadingApk] = useState(false);
  const [scanningApk, setScanningApk] = useState(false);

  // 用户管理数据
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'' | 'admin' | 'member'>('');
  const [userStatusFilter, setUserStatusFilter] = useState<'' | 'active' | 'disabled'>('');
  const [userSort, setUserSort] = useState<'usage_desc' | 'last_active' | 'created_desc' | 'questions_desc'>(
    'usage_desc'
  );

  // 新建用户 & 重置密码弹窗
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUserForm, setNewUserForm] = useState({
    username: '',
    email: '',
    nickname: '',
    password: '',
    role: 'member' as 'admin' | 'member',
  });
  const [creatingUser, setCreatingUser] = useState(false);
  const [resetPwdTarget, setResetPwdTarget] = useState<AdminUserItem | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resettingPwd, setResettingPwd] = useState(false);

  // 使用时长查询数据
  const [usageDays, setUsageDays] = useState<'1' | '7' | '30' | '90' | 'all'>('7');
  const [usageSearch, setUsageSearch] = useState('');
  const [usageData, setUsageData] = useState<AdminUsageResponse | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [detailUserTarget, setDetailUserTarget] = useState<{
    userId: string;
    label: string;
  } | null>(null);
  const [detailUserUsage, setDetailUserUsage] = useState<AdminUsageResponse | null>(null);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);

  // 全站题库数据
  const [banks, setBanks] = useState<AdminBankItem[]>([]);
  const [loadingBanks, setLoadingBanks] = useState(false);
  const [bankSearch, setBankSearch] = useState('');
  const [bankVisFilter, setBankVisFilter] = useState<'' | 'public' | 'private'>('');
  const [transferBankTarget, setTransferBankTarget] = useState<AdminBankItem | null>(null);
  const [transferOwnerId, setTransferOwnerId] = useState('');
  const [transferringBank, setTransferringBank] = useState(false);

  // 全站考场与 AI 任务
  const [exams, setExams] = useState<AdminExamItem[]>([]);
  const [aiJobs, setAiJobs] = useState<AdminAiJobItem[]>([]);
  const [loadingOps, setLoadingOps] = useState(false);

  // 审计日志
  const [auditLogs, setAuditLogs] = useState<AdminAuditLogItem[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const loadAppUpdateInfo = async () => {
    try {
      const res = await apiFetch<{
        latest: AppUpdateReleaseInfo | null;
        connectedClients: number;
        lastCheckedAt: string | null;
      }>('/api/app-update/admin/config');
      setAppUpdateInfo({
        latest: res.latest,
        connectedClients: res.connectedClients,
        lastCheckedAt: res.lastCheckedAt,
      });
    } catch {
      // ignore optional widget errors
    }
  };

  const loadOverview = async () => {
    setLoadingOverview(true);
    try {
      const [res] = await Promise.all([
        apiFetch<AdminOverview>('/api/admin/overview'),
        loadAppUpdateInfo(),
      ]);
      setOverview(res);
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '加载系统概览失败',
      });
    } finally {
      setLoadingOverview(false);
    }
  };

  const handleUploadApk = async () => {
    if (!apkFile) {
      setBanner({ tone: 'error', message: '请先选择要上传的 .apk 安装包文件' });
      return;
    }
    setUploadingApk(true);
    try {
      const form = new FormData();
      form.append('file', apkFile);
      if (apkVersion.trim()) form.append('versionName', apkVersion.trim());
      if (apkVersionCode.trim()) form.append('versionCode', apkVersionCode.trim());
      if (apkNotes.trim()) form.append('releaseNotes', apkNotes.trim());
      form.append('forceUpdate', apkForceUpdate ? 'true' : 'false');

      const res = await apiFetch<AppUpdateSyncResult>('/api/app-update/admin/upload', {
        method: 'POST',
        body: form,
      });
      await loadAppUpdateInfo();
      setApkFile(null);
      setBanner({
        tone: 'success',
        message: `已上传并发布 v${res.latest?.versionName || ''}（${
          res.latest?.forceUpdate ? '强制更新' : '客户端可选更新'
        }），已向 ${res.pushedClients} 个在线 Android 端推送更新提示。`,
      });
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '上传 APK 安装包失败',
      });
    } finally {
      setUploadingApk(false);
    }
  };

  const handleScanLocalApk = async () => {
    setScanningApk(true);
    try {
      const res = await apiFetch<AppUpdateSyncResult>('/api/app-update/admin/sync', {
        method: 'POST',
      });
      await loadAppUpdateInfo();
      if (!res.latest) {
        setBanner({
          tone: 'info',
          message: '服务器 updates 目录暂未检测到 .apk 安装包，可先在下方上传或放到服务器目录中。',
        });
      } else {
        setBanner({
          tone: 'success',
          message: `已扫描服务器目录并发布 v${res.latest.versionName}，已向 ${res.pushedClients} 个在线 Android 端推送更新。`,
        });
      }
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '扫描服务器安装包失败',
      });
    } finally {
      setScanningApk(false);
    }
  };

  const loadUsers = async () => {
    setLoadingUsers(true);
    try {
      const qs = new URLSearchParams({ sort: userSort });
      if (userSearch.trim()) qs.set('q', userSearch.trim());
      if (userRoleFilter) qs.set('role', userRoleFilter);
      if (userStatusFilter) qs.set('status', userStatusFilter);
      const res = await apiFetch<{ users: AdminUserItem[] }>(`/api/admin/users?${qs.toString()}`);
      setUsers(res.users);
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '加载用户列表失败',
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const loadUsage = async () => {
    setLoadingUsage(true);
    try {
      const qs = new URLSearchParams({ days: usageDays });
      if (usageSearch.trim()) qs.set('q', usageSearch.trim());
      const res = await apiFetch<AdminUsageResponse>(`/api/admin/usage?${qs.toString()}`);
      setUsageData(res);
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '加载使用时长统计失败',
      });
    } finally {
      setLoadingUsage(false);
    }
  };

  const loadBanks = async () => {
    setLoadingBanks(true);
    try {
      const qs = new URLSearchParams();
      if (bankSearch.trim()) qs.set('q', bankSearch.trim());
      if (bankVisFilter) qs.set('visibility', bankVisFilter);
      const res = await apiFetch<{ banks: AdminBankItem[] }>(`/api/admin/banks?${qs.toString()}`);
      setBanks(res.banks);
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '加载全站题库失败',
      });
    } finally {
      setLoadingBanks(false);
    }
  };

  const loadOps = async () => {
    setLoadingOps(true);
    try {
      const [examRes, jobRes] = await Promise.all([
        apiFetch<{ exams: AdminExamItem[] }>('/api/admin/exams'),
        apiFetch<{ jobs: AdminAiJobItem[] }>('/api/admin/ai-jobs'),
      ]);
      setExams(examRes.exams);
      setAiJobs(jobRes.jobs);
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '加载考场与 AI 任务失败',
      });
    } finally {
      setLoadingOps(false);
    }
  };

  const loadAuditLogs = async () => {
    setLoadingAudit(true);
    try {
      const res = await apiFetch<{ logs: AdminAuditLogItem[] }>('/api/admin/audit-logs?limit=80');
      setAuditLogs(res.logs);
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '加载审计日志失败',
      });
    } finally {
      setLoadingAudit(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    if (activeTab === 'users') void loadUsers();
    else if (activeTab === 'usage') void loadUsage();
    else if (activeTab === 'banks') void loadBanks();
    else if (activeTab === 'exams') void loadOps();
    else if (activeTab === 'audit') void loadAuditLogs();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'users') void loadUsers();
  }, [userRoleFilter, userStatusFilter, userSort]);

  useEffect(() => {
    if (activeTab === 'usage') void loadUsage();
  }, [usageDays]);

  useEffect(() => {
    if (activeTab === 'banks') void loadBanks();
  }, [bankVisFilter]);

  const handleToggleRegistration = async () => {
    if (!overview) return;
    const nextVal = !overview.policy.allowRegistration;
    try {
      const res = await apiFetch<{ policy: SystemPolicy }>('/api/admin/policy', {
        method: 'PUT',
        json: { allowRegistration: nextVal },
      });
      setOverview((prev) => (prev ? { ...prev, policy: res.policy } : prev));
      setBanner({
        tone: 'success',
        message: res.policy.allowRegistration
          ? '已开启公开自助注册，新用户可自行注册普通成员账号。'
          : '已关闭自助注册，仅管理员可在后台手动开通账号。',
      });
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '变更注册策略失败',
      });
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreatingUser(true);
    setBanner(null);
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        json: newUserForm,
      });
      setShowCreateUser(false);
      setNewUserForm({ username: '', email: '', nickname: '', password: '', role: 'member' });
      setBanner({ tone: 'success', message: `已成功创建账号「${newUserForm.username}」。` });
      void loadUsers();
      void loadOverview();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '新建账号失败',
      });
    } finally {
      setCreatingUser(false);
    }
  };

  const handleUpdateUser = async (
    target: AdminUserItem,
    patch: { role?: 'admin' | 'member'; isDisabled?: boolean }
  ) => {
    setBanner(null);
    try {
      await apiFetch(`/api/admin/users/${target.id}`, {
        method: 'PUT',
        json: patch,
      });
      setBanner({
        tone: 'success',
        message: `已更新账号「${target.username}」权限或状态。`,
      });
      void loadUsers();
      void loadOverview();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '更新账号状态失败',
      });
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetPwdTarget) return;
    setResettingPwd(true);
    try {
      await apiFetch(`/api/admin/users/${resetPwdTarget.id}/reset-password`, {
        method: 'POST',
        json: { newPassword: newPasswordInput },
      });
      setBanner({
        tone: 'success',
        message: `已重置账号「${resetPwdTarget.username}」的登录密码。`,
      });
      setResetPwdTarget(null);
      setNewPasswordInput('');
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '重置密码失败',
      });
    } finally {
      setResettingPwd(false);
    }
  };

  const handleDeleteUser = async (target: AdminUserItem) => {
    if (
      !window.confirm(
        `确定永久删除账号「${target.username}」吗？其名下私有题库、刷题记录、使用时长及考试记录将被级联移除。`
      )
    ) {
      return;
    }
    try {
      await apiFetch(`/api/admin/users/${target.id}`, { method: 'DELETE' });
      setBanner({ tone: 'success', message: `已删除账号「${target.username}」。` });
      void loadUsers();
      void loadOverview();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '删除账号失败',
      });
    }
  };

  const openUserUsageDetail = async (userId: string, label: string) => {
    setDetailUserTarget({ userId, label });
    setLoadingUserDetail(true);
    setDetailUserUsage(null);
    try {
      const res = await apiFetch<AdminUsageResponse>(
        `/api/admin/usage?days=30&userId=${encodeURIComponent(userId)}`
      );
      setDetailUserUsage(res);
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '加载用户逐日时长明细失败',
      });
      setDetailUserTarget(null);
    } finally {
      setLoadingUserDetail(false);
    }
  };

  const handleUpdateBank = async (
    bank: AdminBankItem,
    patch: { visibility?: 'public' | 'private'; disableShare?: boolean; ownerId?: string }
  ) => {
    try {
      await apiFetch(`/api/admin/banks/${bank.id}`, {
        method: 'PUT',
        json: patch,
      });
      setBanner({ tone: 'success', message: `已更新题库「${bank.title}」。` });
      void loadBanks();
      void loadOverview();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '更新题库失败',
      });
    }
  };

  const handleDeleteBank = async (bank: AdminBankItem) => {
    if (!window.confirm(`确定删除题库「${bank.title}」（归属：${bank.ownerUsername}）吗？此操作不可恢复。`)) {
      return;
    }
    try {
      await apiFetch(`/api/admin/banks/${bank.id}`, { method: 'DELETE' });
      setBanner({ tone: 'success', message: `已删除题库「${bank.title}」。` });
      void loadBanks();
      void loadOverview();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '删除题库失败',
      });
    }
  };

  const openTransferBankModal = async (bank: AdminBankItem) => {
    setTransferBankTarget(bank);
    setTransferOwnerId(bank.ownerId);
    if (users.length === 0) {
      await loadUsers();
    }
  };

  const handleConfirmTransferBank = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferBankTarget || !transferOwnerId) return;
    setTransferringBank(true);
    try {
      await apiFetch(`/api/admin/banks/${transferBankTarget.id}`, {
        method: 'PUT',
        json: { ownerId: transferOwnerId },
      });
      setBanner({
        tone: 'success',
        message: `已转移题库「${transferBankTarget.title}」的归属权。`,
      });
      setTransferBankTarget(null);
      void loadBanks();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '转移归属失败',
      });
    } finally {
      setTransferringBank(false);
    }
  };

  const handleToggleExamStatus = async (ex: AdminExamItem) => {
    const nextStatus = ex.status === 'active' ? 'closed' : 'active';
    try {
      await apiFetch(`/api/admin/exams/${ex.id}`, {
        method: 'PUT',
        json: { status: nextStatus },
      });
      setBanner({
        tone: 'success',
        message: `已将考场「${ex.title}」状态切换为${nextStatus === 'active' ? '进行中' : '已关闭'}。`,
      });
      void loadOps();
      void loadOverview();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '修改考场状态失败',
      });
    }
  };

  const handleDeleteExam = async (ex: AdminExamItem) => {
    if (!window.confirm(`确定删除考场「${ex.title}」及全部交卷成绩吗？`)) return;
    try {
      await apiFetch(`/api/admin/exams/${ex.id}`, { method: 'DELETE' });
      setBanner({ tone: 'success', message: `已删除考场「${ex.title}」。` });
      void loadOps();
      void loadOverview();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '删除考场失败',
      });
    }
  };

  const handleDeleteAiJob = async (job: AdminAiJobItem) => {
    try {
      await apiFetch(`/api/admin/ai-jobs/${job.id}`, { method: 'DELETE' });
      setBanner({ tone: 'success', message: '已清理该 AI 任务记录。' });
      void loadOps();
      void loadOverview();
    } catch (err) {
      setBanner({
        tone: 'error',
        message: err instanceof Error ? err.message : '清理 AI 任务失败',
      });
    }
  };

  const tabItems: TabItem<AdminTab>[] = [
    { key: 'overview', label: '总览看板', icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    {
      key: 'users',
      label: '用户管理',
      icon: <Users className="h-3.5 w-3.5" />,
      badge: overview?.users.total,
    },
    { key: 'usage', label: '使用时长查询', icon: <Clock className="h-3.5 w-3.5" /> },
    {
      key: 'banks',
      label: '全站题库管理',
      icon: <BookOpen className="h-3.5 w-3.5" />,
      badge: overview?.content.totalBanks,
    },
    {
      key: 'exams',
      label: '考场与 AI 任务',
      icon: <ClipboardCheck className="h-3.5 w-3.5" />,
      badge: overview?.exams.totalExams,
    },
    { key: 'audit', label: '审计日志', icon: <History className="h-3.5 w-3.5" /> },
  ];

  const maxOverviewSec = Math.max(
    1,
    ...(overview?.dailyTrend.map((d) => d.activeSeconds) || [1])
  );
  const maxUsageSec = Math.max(
    1,
    ...(usageData?.dailyTrend.map((d) => d.activeSeconds) || [1])
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="系统管理控制台"
        description="全站最高权限视图：账号与角色治理、全站公私有题库维护、用户使用时长统计与注册策略控制"
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => {
              void loadOverview();
              if (activeTab === 'users') void loadUsers();
              if (activeTab === 'usage') void loadUsage();
              if (activeTab === 'banks') void loadBanks();
              if (activeTab === 'exams') void loadOps();
              if (activeTab === 'audit') void loadAuditLogs();
            }}
          >
            刷新数据
          </Button>
        }
      />

      {banner && <Alert tone={banner.tone}>{banner.message}</Alert>}

      <Tabs items={tabItems} activeKey={activeTab} onChange={setActiveTab} className="w-full sm:w-auto" />

      {/* -------------------- TAB 1: 总览看板 -------------------- */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {loadingOverview && !overview ? (
            <div className="py-12 text-center text-sm text-slate-500">正在汇总全站运行指标...</div>
          ) : overview ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="注册账号总数"
                  value={overview.users.total}
                  hint={`管理员 ${overview.users.admins} · 禁用 ${overview.users.disabled}`}
                  icon={<Users className="h-4 w-4 text-brand-600" />}
                />
                <StatCard
                  label="活跃用户数"
                  value={`${overview.users.todayActive} / ${overview.users.last7dActive}`}
                  hint="今日活跃 / 近 7 天活跃"
                  icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                />
                <StatCard
                  label="累计使用时长"
                  value={formatDuration(overview.usage.totalSeconds)}
                  hint={`今日 ${formatDuration(overview.usage.todaySeconds)}`}
                  icon={<Clock className="h-4 w-4 text-brand-600" />}
                />
                <StatCard
                  label="全站题库 / 题目"
                  value={`${overview.content.totalBanks} / ${overview.content.totalQuestions}`}
                  hint={`公开 ${overview.content.publicBanks} · 私有 ${overview.content.privateBanks} · 已AI评 ${overview.content.ratedQuestions}`}
                  icon={<BookOpen className="h-4 w-4 text-indigo-600" />}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                  <CardHeader
                    title="近 14 天全站使用时长趋势"
                    subtitle="仅统计用户在前台停留的真实活跃秒数（已过滤切后台与休眠时段）"
                    icon={<BarChart3 className="h-4 w-4" />}
                  />
                  <div className="mt-2 flex h-44 items-end gap-1.5 sm:gap-2">
                    {overview.dailyTrend.map((pt) => {
                      const pct = pt.activeSeconds > 0 ? Math.max(8, Math.round((pt.activeSeconds / maxOverviewSec) * 100)) : 4;
                      return (
                        <div
                          key={pt.date}
                          className="group flex flex-1 flex-col items-center justify-end gap-1.5"
                          title={`${pt.date} · 活跃 ${pt.activeUsers} 人 · 总时长 ${formatDuration(pt.activeSeconds)}（刷题 ${formatDuration(pt.practiceSeconds)} / 考试 ${formatDuration(pt.examSeconds)}）`}
                        >
                          <div className="text-[10px] font-medium text-slate-500 tabular-nums opacity-0 transition group-hover:opacity-100">
                            {pt.activeUsers}人
                          </div>
                          <div className="flex h-28 w-full items-end rounded-md bg-slate-100/80 p-0.5">
                            <div
                              style={{ height: `${pct}%` }}
                              className={`w-full rounded-sm transition-all ${
                                pt.activeSeconds > 0 ? 'bg-brand-600 group-hover:bg-brand-500' : 'bg-slate-200'
                              }`}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500 tabular-nums">
                            {pt.date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>

                <Card>
                  <CardHeader
                    title="系统控制与运行状态"
                    subtitle="全站级开关与关键服务状态"
                    icon={<ShieldCheck className="h-4 w-4" />}
                  />
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                      <div>
                        <div className="font-bold text-slate-900">允许公开自助注册</div>
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          {overview.policy.allowRegistration
                            ? '当前任何人可在登录页注册新账号'
                            : '已关闭，仅限管理员后台创建用户'}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={overview.policy.allowRegistration ? 'success' : 'secondary'}
                        onClick={() => void handleToggleRegistration()}
                      >
                        {overview.policy.allowRegistration ? '已开启' : '已关闭'}
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 tabular-nums">
                      <div className="rounded-lg border border-slate-200 p-2.5">
                        <div className="text-[11px] text-slate-500">累计作答 / 正确率</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          {overview.learning.totalAnswered} 题 · {overview.learning.accuracyPercent}%
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2.5">
                        <div className="text-[11px] text-slate-500">考场 / 总交卷</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          {overview.exams.totalExams} 场 · {overview.exams.totalSubmissions} 份
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2.5">
                        <div className="text-[11px] text-slate-500">AI 后台转换任务</div>
                        <div className="mt-1 text-sm font-bold text-slate-900">
                          {overview.aiJobs.total} 次 (运行 {overview.aiJobs.running})
                        </div>
                      </div>
                      <div className="rounded-lg border border-slate-200 p-2.5">
                        <div className="text-[11px] text-slate-500">数据库引擎</div>
                        <div className="mt-1 text-sm font-bold uppercase text-brand-700">
                          {overview.dbEngine}
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full"
                      icon={<Cpu className="h-3.5 w-3.5" />}
                      onClick={() => navigate('/settings')}
                    >
                      前往配置全站共享 DeepSeek AI 服务
                    </Button>
                  </div>
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Android 安装包自托管分发与推送"
                  description="安装包直接存放在本服务器并推送更新通知（不依赖 GitHub），客户端弹窗提供「立即更新」与「稍后再说」可选更新。"
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={scanningApk}
                      icon={<RefreshCw className="h-3.5 w-3.5" />}
                      onClick={() => void handleScanLocalApk()}
                    >
                      扫描服务器目录并推送
                    </Button>
                  }
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                        <Smartphone className="h-3.5 w-3.5 text-brand-600" />
                        当前服务器在线分发版本
                      </span>
                      <Badge tone="brand">
                        在线连接 {appUpdateInfo?.connectedClients ?? 0} 台
                      </Badge>
                    </div>
                    {appUpdateInfo?.latest ? (
                      <div className="space-y-1 text-slate-600">
                        <div>
                          版本号：<span className="font-bold text-slate-900">v{appUpdateInfo.latest.versionName}</span>
                          <span className="ml-2 text-slate-500">(versionCode: {appUpdateInfo.latest.versionCode})</span>
                          <Badge tone={appUpdateInfo.latest.forceUpdate ? 'danger' : 'success'} className="ml-2">
                            {appUpdateInfo.latest.forceUpdate ? '强制更新' : '客户端可选'}
                          </Badge>
                        </div>
                        <div>文件名：{appUpdateInfo.latest.fileName}（{(appUpdateInfo.latest.fileSize / 1024 / 1024).toFixed(2)} MB）</div>
                        <div className="truncate font-mono text-[11px] text-slate-500">
                          SHA-256: {appUpdateInfo.latest.sha256}
                        </div>
                        {appUpdateInfo.latest.releaseNotes && (
                          <div className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-slate-700">
                            {appUpdateInfo.latest.releaseNotes}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-slate-500">
                        服务器尚未发布任何 APK，可在右侧直接上传 `.apk` 或将安装包放入服务器 `./data/updates/` 目录。
                      </div>
                    )}
                  </div>

                  <div className="space-y-2.5 rounded-lg border border-slate-200 p-3.5 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={LABEL_CLS}>版本号（留空按文件名识别）</label>
                        <input
                          type="text"
                          value={apkVersion}
                          onChange={(e) => setApkVersion(e.target.value)}
                          placeholder="如 2.4.4"
                          className={INPUT_CLS}
                        />
                      </div>
                      <div>
                        <label className={LABEL_CLS}>版本码 versionCode（可选）</label>
                        <input
                          type="number"
                          value={apkVersionCode}
                          onChange={(e) => setApkVersionCode(e.target.value)}
                          placeholder="如 12"
                          className={INPUT_CLS}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={LABEL_CLS}>更新说明（展示在客户端更新弹窗）</label>
                      <input
                        type="text"
                        value={apkNotes}
                        onChange={(e) => setApkNotes(e.target.value)}
                        placeholder="如：支持服务器直接推送更新、一键重置刷题进度、优化性能"
                        className={INPUT_CLS}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                      <label className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={apkForceUpdate}
                          onChange={(e) => setApkForceUpdate(e.target.checked)}
                        />
                        强制更新（不勾选则用户可点「稍后再说」）
                      </label>
                      <input
                        type="file"
                        accept=".apk,application/vnd.android.package-archive"
                        onChange={(e) => setApkFile(e.target.files?.[0] ?? null)}
                        className="max-w-full text-[11px] text-slate-600"
                      />
                    </div>

                    <Button
                      size="sm"
                      variant="primary"
                      className="w-full"
                      loading={uploadingApk}
                      icon={<Upload className="h-3.5 w-3.5" />}
                      onClick={() => void handleUploadApk()}
                    >
                      {apkFile ? `上传「${apkFile.name}」并推送给客户端` : '上传 APK 安装包并推送给客户端'}
                    </Button>
                  </div>
                </div>
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* -------------------- TAB 2: 用户管理 -------------------- */}
      {activeTab === 'users' && (
        <div className="space-y-4">
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadUsers();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="搜用户名 / 昵称 / 邮箱..."
                className={`${INPUT_CLS} h-8 w-48 text-xs`}
              />
              <select
                value={userRoleFilter}
                onChange={(e) => setUserRoleFilter(e.target.value as '' | 'admin' | 'member')}
                className={`${SELECT_CLS} h-8 text-xs`}
              >
                <option value="">全部角色</option>
                <option value="admin">系统管理员</option>
                <option value="member">普通成员</option>
              </select>
              <select
                value={userStatusFilter}
                onChange={(e) => setUserStatusFilter(e.target.value as '' | 'active' | 'disabled')}
                className={`${SELECT_CLS} h-8 text-xs`}
              >
                <option value="">全部状态</option>
                <option value="active">正常启用</option>
                <option value="disabled">已禁用</option>
              </select>
              <select
                value={userSort}
                onChange={(e) =>
                  setUserSort(
                    e.target.value as 'usage_desc' | 'last_active' | 'created_desc' | 'questions_desc'
                  )
                }
                className={`${SELECT_CLS} h-8 text-xs`}
              >
                <option value="usage_desc">按使用总时长</option>
                <option value="last_active">按最近活跃时间</option>
                <option value="questions_desc">按累计作答量</option>
                <option value="created_desc">按注册时间</option>
              </select>
              <Button type="submit" size="sm" variant="secondary">
                查询
              </Button>
            </form>

            <Button
              size="sm"
              icon={<UserPlus className="h-3.5 w-3.5" />}
              onClick={() => setShowCreateUser(true)}
            >
              新建用户
            </Button>
          </Card>

          {loadingUsers ? (
            <div className="py-12 text-center text-sm text-slate-500">加载用户列表...</div>
          ) : users.length === 0 ? (
            <EmptyState icon={<Users className="h-8 w-8" />} title="暂无匹配用户" />
          ) : (
            <div className="space-y-2.5">
              {users.map((u) => {
                const isSelf = u.id === currentUser?.id;
                return (
                  <Card key={u.id} padding="sm" className="sm:p-4">
                    <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">
                            {u.nickname || u.username}
                          </span>
                          <span className="font-mono text-xs text-slate-500">@{u.username}</span>
                          <Badge tone={u.role === 'admin' ? 'brand' : 'neutral'}>
                            {u.role === 'admin' ? '管理员' : '成员'}
                          </Badge>
                          {u.isDisabled ? (
                            <Badge tone="danger">已禁用</Badge>
                          ) : (
                            <Badge tone="success">正常</Badge>
                          )}
                          {isSelf && <Badge tone="ai">当前登录</Badge>}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                          <span>邮箱：{u.email}</span>
                          <span>
                            题库/题目：{u.bankCount} 库 / {u.questionCount} 题
                          </span>
                          <span>
                            刷题/交卷：{u.answeredCount} 题 / {u.submissionCount} 份
                          </span>
                          <span className="font-semibold text-brand-700">
                            总时长 {formatDuration(u.totalActiveSeconds)}（今日{' '}
                            {formatDuration(u.todayActiveSeconds)} · 近7天{' '}
                            {formatDuration(u.last7dActiveSeconds)}）
                          </span>
                          <span>最近活跃：{formatDateTime(u.lastActiveAt)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Clock className="h-3.5 w-3.5" />}
                          onClick={() =>
                            void openUserUsageDetail(u.id, `${u.nickname || u.username} (@${u.username})`)
                          }
                        >
                          时长明细
                        </Button>
                        {!isSelf && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              void handleUpdateUser(u, {
                                role: u.role === 'admin' ? 'member' : 'admin',
                              })
                            }
                          >
                            {u.role === 'admin' ? '降为成员' : '设为管理员'}
                          </Button>
                        )}
                        {!isSelf && (
                          <Button
                            size="sm"
                            variant={u.isDisabled ? 'success' : 'secondary'}
                            icon={
                              u.isDisabled ? (
                                <Power className="h-3.5 w-3.5" />
                              ) : (
                                <Ban className="h-3.5 w-3.5" />
                              )
                            }
                            onClick={() =>
                              void handleUpdateUser(u, { isDisabled: !u.isDisabled })
                            }
                          >
                            {u.isDisabled ? '启用' : '禁用'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<KeyRound className="h-3.5 w-3.5" />}
                          onClick={() => {
                            setResetPwdTarget(u);
                            setNewPasswordInput('');
                          }}
                        >
                          改密
                        </Button>
                        {!isSelf && (
                          <Button
                            size="sm"
                            variant="danger"
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                            onClick={() => void handleDeleteUser(u)}
                          >
                            删除
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* -------------------- TAB 3: 使用时长查询 -------------------- */}
      {activeTab === 'usage' && (
        <div className="space-y-4">
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {USAGE_RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setUsageDays(opt.key)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    usageDays === opt.key
                      ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                      : 'border-[#E6E9EF] bg-white text-slate-700 hover:border-brand-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadUsage();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={usageSearch}
                onChange={(e) => setUsageSearch(e.target.value)}
                placeholder="筛选用户..."
                className={`${INPUT_CLS} h-8 w-44 text-xs`}
              />
              <Button type="submit" size="sm" variant="secondary">
                查询
              </Button>
            </form>
          </Card>

          {loadingUsage && !usageData ? (
            <div className="py-12 text-center text-sm text-slate-500">正在统计使用时长...</div>
          ) : usageData ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard
                  label="周期总使用时长"
                  value={formatDuration(usageData.summary.totalSeconds)}
                  hint={usageData.startDate ? `${usageData.startDate} 至今` : '全历史统计'}
                  icon={<Clock className="h-4 w-4 text-brand-600" />}
                />
                <StatCard
                  label="专项刷题时长"
                  value={formatDuration(usageData.summary.practiceSeconds)}
                  hint="沉浸刷题与背题页面停留"
                  icon={<BookOpen className="h-4 w-4 text-emerald-600" />}
                />
                <StatCard
                  label="在线考试时长"
                  value={formatDuration(usageData.summary.examSeconds)}
                  hint="考场作答活跃时长"
                  icon={<ClipboardCheck className="h-4 w-4 text-indigo-600" />}
                />
                <StatCard
                  label="活跃人数 / 人均时长"
                  value={`${usageData.summary.activeUsers} 人`}
                  hint={`人均 ${formatDuration(usageData.summary.avgSecondsPerActiveUser)}`}
                  icon={<Users className="h-4 w-4 text-brand-600" />}
                />
              </div>

              {usageData.dailyTrend.length > 0 && (
                <Card>
                  <CardHeader
                    title="每日使用时长分布"
                    subtitle="悬停柱条可查看当日总时长、刷题与考试时长分解"
                    icon={<BarChart3 className="h-4 w-4" />}
                  />
                  <div className="flex h-36 items-end gap-1.5 overflow-x-auto pb-1">
                    {usageData.dailyTrend.map((pt) => {
                      const pct =
                        pt.activeSeconds > 0
                          ? Math.max(8, Math.round((pt.activeSeconds / maxUsageSec) * 100))
                          : 4;
                      return (
                        <div
                          key={pt.date}
                          className="group flex min-w-[20px] flex-1 flex-col items-center justify-end gap-1"
                          title={`${pt.date}：总计 ${formatDuration(pt.activeSeconds)}（刷题 ${formatDuration(pt.practiceSeconds)} / 考试 ${formatDuration(pt.examSeconds)}），活跃 ${pt.activeUsers} 人`}
                        >
                          <div className="flex h-24 w-full items-end rounded bg-slate-100/80 p-0.5">
                            <div
                              style={{ height: `${pct}%` }}
                              className={`w-full rounded-sm transition ${
                                pt.activeSeconds > 0 ? 'bg-brand-600' : 'bg-slate-200'
                              }`}
                            />
                          </div>
                          <span className="text-[10px] text-slate-500 tabular-nums">
                            {pt.date.slice(5)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              )}

              <Card>
                <CardHeader
                  title="用户使用时长排行榜"
                  subtitle={`共 ${usageData.userRanking.length} 位用户，按周期内真实前台停留时长排序`}
                  icon={<Clock className="h-4 w-4" />}
                />
                {usageData.userRanking.length === 0 ? (
                  <EmptyState icon={<Users className="h-8 w-8" />} title="暂无用户数据" />
                ) : (
                  <div className="divide-y divide-slate-100">
                    {usageData.userRanking.map((row, idx) => {
                      const maxRankSec = Math.max(1, usageData.userRanking[0]?.activeSeconds || 1);
                      const barPct =
                        row.activeSeconds > 0
                          ? Math.max(4, Math.round((row.activeSeconds / maxRankSec) * 100))
                          : 0;
                      return (
                        <div
                          key={row.userId}
                          className="flex flex-col justify-between gap-2.5 py-3 sm:flex-row sm:items-center"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[11px] font-bold text-slate-600 tabular-nums">
                                {idx + 1}
                              </span>
                              <span className="text-sm font-bold text-slate-900">
                                {row.nickname || row.username}
                              </span>
                              <span className="font-mono text-xs text-slate-500">
                                @{row.username}
                              </span>
                              {row.role === 'admin' && <Badge tone="brand">管理员</Badge>}
                              {row.isDisabled && <Badge tone="danger">已禁用</Badge>}
                            </div>
                            <div className="h-1.5 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
                              <div
                                style={{ width: `${barPct}%` }}
                                className="h-full rounded-full bg-brand-600"
                              />
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500 tabular-nums">
                              <span>活跃 {row.activeDays} 天</span>
                              <span>刷题 {formatDuration(row.practiceSeconds)}</span>
                              <span>考试 {formatDuration(row.examSeconds)}</span>
                              <span>最近活跃：{formatDateTime(row.lastActiveAt)}</span>
                              {row.lastPath && <span>末次页面：{row.lastPath}</span>}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-sm font-bold text-brand-700 tabular-nums">
                              {formatDuration(row.activeSeconds)}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                void openUserUsageDetail(
                                  row.userId,
                                  `${row.nickname || row.username} (@${row.username})`
                                )
                              }
                            >
                              每日明细
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            </>
          ) : null}
        </div>
      )}

      {/* -------------------- TAB 4: 全站题库管理 -------------------- */}
      {activeTab === 'banks' && (
        <div className="space-y-4">
          <Card padding="sm" className="flex flex-wrap items-center justify-between gap-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void loadBanks();
              }}
              className="flex flex-wrap items-center gap-2"
            >
              <input
                type="text"
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                placeholder="搜题库名 / 分类 / 归属人..."
                className={`${INPUT_CLS} h-8 w-52 text-xs`}
              />
              <select
                value={bankVisFilter}
                onChange={(e) => setBankVisFilter(e.target.value as '' | 'public' | 'private')}
                className={`${SELECT_CLS} h-8 text-xs`}
              >
                <option value="">全部可见性（含他人私有）</option>
                <option value="public">公开共享</option>
                <option value="private">个人私有</option>
              </select>
              <Button type="submit" size="sm" variant="secondary">
                查询
              </Button>
            </form>
            <span className="text-xs text-slate-500 tabular-nums">共 {banks.length} 个题库</span>
          </Card>

          {loadingBanks ? (
            <div className="py-12 text-center text-sm text-slate-500">加载全站题库...</div>
          ) : banks.length === 0 ? (
            <EmptyState icon={<BookOpen className="h-8 w-8" />} title="暂无匹配题库" />
          ) : (
            <div className="space-y-2.5">
              {banks.map((b) => (
                <Card key={b.id} padding="sm" className="sm:p-4">
                  <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/banks/${b.id}`}
                          className="text-sm font-bold text-slate-900 hover:text-brand-600"
                        >
                          {b.title}
                        </Link>
                        <Badge tone="brand">{b.category}</Badge>
                        <Badge tone={b.visibility === 'public' ? 'success' : 'neutral'}>
                          {b.visibility === 'public' ? (
                            <>
                              <Globe className="h-3 w-3" /> 公开
                            </>
                          ) : (
                            <>
                              <Lock className="h-3 w-3" /> 私有
                            </>
                          )}
                        </Badge>
                        {(b.shareEnabled || b.sharedUserCount > 0) && (
                          <Badge tone="ai">
                            私密分享{b.sharedUserCount > 0 ? ` (${b.sharedUserCount}人)` : ''}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 tabular-nums">
                        <span>
                          归属：{b.ownerNickname || b.ownerUsername} (@{b.ownerUsername})
                        </span>
                        <span>
                          {b.questionCount} 题（已评 {b.ratedCount} 题 · {b.chapterCount} 章）
                        </span>
                        <span>克隆 {b.cloneCount} 次</span>
                        <span>更新：{formatDateTime(b.updatedAt)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <Link to={`/banks/${b.id}`}>
                        <Button size="sm" variant="secondary" icon={<ExternalLink className="h-3.5 w-3.5" />}>
                          管理内容
                        </Button>
                      </Link>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          void handleUpdateBank(b, {
                            visibility: b.visibility === 'public' ? 'private' : 'public',
                          })
                        }
                      >
                        {b.visibility === 'public' ? '转为私有' : '设为公开'}
                      </Button>
                      {b.shareEnabled && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleUpdateBank(b, { disableShare: true })}
                        >
                          停用分享码
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<ArrowRightLeft className="h-3.5 w-3.5" />}
                        onClick={() => void openTransferBankModal(b)}
                      >
                        转移归属
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => void handleDeleteBank(b)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* -------------------- TAB 5: 考场与 AI 任务 -------------------- */}
      {activeTab === 'exams' && (
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="全站考场统筹"
              subtitle={`共 ${exams.length} 场考试，管理员可跨账号启停考场、进入考情分析或清理`}
              icon={<ClipboardCheck className="h-4 w-4" />}
            />
            {loadingOps ? (
              <div className="py-8 text-center text-sm text-slate-500">加载考场中...</div>
            ) : exams.length === 0 ? (
              <EmptyState icon={<ClipboardCheck className="h-8 w-8" />} title="暂无考场" />
            ) : (
              <div className="divide-y divide-slate-100">
                {exams.map((ex) => (
                  <div
                    key={ex.id}
                    className="flex flex-col justify-between gap-2.5 py-3 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900">{ex.title}</span>
                        <Badge tone={ex.status === 'active' ? 'success' : 'danger'}>
                          {ex.status === 'active' ? '进行中' : '已关闭'}
                        </Badge>
                        <Badge tone={ex.examType === 'published' ? 'ai' : 'neutral'}>
                          {ex.examType === 'published' ? '组织发布' : '个人模拟'}
                        </Badge>
                        <span className="font-mono text-xs text-brand-700">码:{ex.shareCode}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600 tabular-nums">
                        <span>
                          创建者：{ex.creatorNickname || ex.creatorUsername} (@{ex.creatorUsername})
                        </span>
                        <span>
                          {ex.questionCount} 题 · {ex.durationMinutes} 分钟
                        </span>
                        <span>
                          交卷 {ex.submissionCount} 人
                          {ex.avgScore !== null ? ` · 均分 ${ex.avgScore}` : ''}
                          {ex.passRate !== null ? ` · 及格率 ${ex.passRate}%` : ''}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => navigate(`/exams/${ex.id}/analytics`)}
                      >
                        考情统计
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleToggleExamStatus(ex)}
                      >
                        {ex.status === 'active' ? '关闭考场' : '重新开启'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => void handleDeleteExam(ex)}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader
              title="全站后台 AI 转换任务监控"
              subtitle={`最近 ${aiJobs.length} 条后台任务，不泄露用户原文或 API Key`}
              icon={<Cpu className="h-4 w-4" />}
            />
            {aiJobs.length === 0 ? (
              <EmptyState icon={<Cpu className="h-8 w-8" />} title="暂无后台 AI 任务" />
            ) : (
              <div className="divide-y divide-slate-100">
                {aiJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex flex-col justify-between gap-2 py-2.5 sm:flex-row sm:items-center"
                  >
                    <div className="min-w-0 space-y-1 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-slate-900">
                          {job.sourceFilename || '文本直传清洗任务'}
                        </span>
                        <Badge
                          tone={
                            job.status === 'completed'
                              ? 'success'
                              : job.status === 'failed'
                                ? 'danger'
                                : job.status === 'running' || job.status === 'queued'
                                  ? 'ai'
                                  : 'neutral'
                          }
                        >
                          {job.status} ({job.progressPct}%)
                        </Badge>
                        {job.modelUsed && <span className="font-mono text-slate-500">{job.modelUsed}</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-4 text-slate-600 tabular-nums">
                        <span>
                          发起人：{job.nickname || job.username} (@{job.username})
                        </span>
                        <span>{job.sourceCharCount} 字符</span>
                        <span>导入 {job.importedCount} 题</span>
                        <span>创建时间：{formatDateTime(job.createdAt)}</span>
                      </div>
                      {job.errorMessage && (
                        <div className="text-[11px] text-rose-600">{job.errorMessage}</div>
                      )}
                    </div>
                    {job.status !== 'running' && job.status !== 'queued' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => void handleDeleteAiJob(job)}
                      >
                        清理
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* -------------------- TAB 6: 审计日志 -------------------- */}
      {activeTab === 'audit' && (
        <Card>
          <CardHeader
            title="管理员操作审计日志"
            subtitle="记录最近 80 条管理员敏感变更，便于合规溯源"
            icon={<History className="h-4 w-4" />}
          />
          {loadingAudit ? (
            <div className="py-10 text-center text-sm text-slate-500">加载审计日志...</div>
          ) : auditLogs.length === 0 ? (
            <EmptyState icon={<History className="h-8 w-8" />} title="暂无管理员操作记录" />
          ) : (
            <div className="divide-y divide-slate-100">
              {auditLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex flex-col justify-between gap-1.5 py-2.5 text-xs sm:flex-row sm:items-center"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{AUDIT_ACTION_LABELS[log.action] || log.action}</Badge>
                    <span className="font-semibold text-slate-800">{log.actorName || '系统'}</span>
                    <span className="text-slate-600">→ {log.targetLabel || log.targetId}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 tabular-nums">
                    {formatDateTime(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ==================== 弹窗区 ==================== */}
      <Modal open={showCreateUser} onClose={() => setShowCreateUser(false)} title="管理员新建用户">
        <form onSubmit={handleCreateUser} className="space-y-3.5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>用户名 (3~32位英文/数字/_/-)</label>
              <input
                type="text"
                required
                value={newUserForm.username}
                onChange={(e) => setNewUserForm({ ...newUserForm, username: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>显示昵称</label>
              <input
                type="text"
                value={newUserForm.nickname}
                onChange={(e) => setNewUserForm({ ...newUserForm, nickname: e.target.value })}
                placeholder="默认同用户名"
                className={INPUT_CLS}
              />
            </div>
          </div>
          <div>
            <label className={LABEL_CLS}>邮箱</label>
            <input
              type="email"
              required
              value={newUserForm.email}
              onChange={(e) => setNewUserForm({ ...newUserForm, email: e.target.value })}
              className={INPUT_CLS}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS}>初始密码 (至少 6 位)</label>
              <input
                type="password"
                required
                minLength={6}
                value={newUserForm.password}
                onChange={(e) => setNewUserForm({ ...newUserForm, password: e.target.value })}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS}>系统角色</label>
              <select
                value={newUserForm.role}
                onChange={(e) =>
                  setNewUserForm({
                    ...newUserForm,
                    role: e.target.value === 'admin' ? 'admin' : 'member',
                  })
                }
                className={`${SELECT_CLS} w-full`}
              >
                <option value="member">普通成员 (member)</option>
                <option value="admin">系统管理员 (admin)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreateUser(false)}>
              取消
            </Button>
            <Button type="submit" loading={creatingUser}>
              确认创建
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(resetPwdTarget)}
        onClose={() => setResetPwdTarget(null)}
        title={`重置密码 · ${resetPwdTarget?.username || ''}`}
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          <div>
            <label className={LABEL_CLS}>新密码（至少 6 位）</label>
            <input
              type="password"
              required
              minLength={6}
              value={newPasswordInput}
              onChange={(e) => setNewPasswordInput(e.target.value)}
              placeholder="输入新密码"
              className={INPUT_CLS}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setResetPwdTarget(null)}>
              取消
            </Button>
            <Button type="submit" loading={resettingPwd}>
              确认重置
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(detailUserTarget)}
        onClose={() => setDetailUserTarget(null)}
        title={`近 30 天使用时长明细 · ${detailUserTarget?.label || ''}`}
        maxWidthClass="max-w-xl"
      >
        {loadingUserDetail ? (
          <div className="py-10 text-center text-sm text-slate-500">正在加载逐日明细...</div>
        ) : detailUserUsage ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center text-xs tabular-nums">
              <div className="rounded-lg border border-slate-200 p-2.5">
                <div className="text-slate-500">近30天总时长</div>
                <div className="mt-1 text-sm font-bold text-brand-700">
                  {formatDuration(detailUserUsage.summary.totalSeconds)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2.5">
                <div className="text-slate-500">专项刷题</div>
                <div className="mt-1 text-sm font-bold text-emerald-700">
                  {formatDuration(detailUserUsage.summary.practiceSeconds)}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2.5">
                <div className="text-slate-500">在线考试</div>
                <div className="mt-1 text-sm font-bold text-indigo-700">
                  {formatDuration(detailUserUsage.summary.examSeconds)}
                </div>
              </div>
            </div>

            {!detailUserUsage.userDaily || detailUserUsage.userDaily.length === 0 ? (
              <EmptyState icon={<Clock className="h-7 w-7" />} title="近 30 天暂无前台时长记录" />
            ) : (
              <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 px-3">
                {detailUserUsage.userDaily.map((d) => (
                  <div
                    key={d.date}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs tabular-nums"
                  >
                    <div>
                      <span className="font-bold text-slate-900">{d.date}</span>
                      {d.lastPath && (
                        <span className="ml-2 text-[11px] text-slate-500">{d.lastPath}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-slate-600">
                      <span>刷题 {formatDuration(d.practiceSeconds)}</span>
                      <span>考试 {formatDuration(d.examSeconds)}</span>
                      <span className="font-bold text-brand-700">
                        总 {formatDuration(d.activeSeconds)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(transferBankTarget)}
        onClose={() => setTransferBankTarget(null)}
        title={`转移题库归属 · ${transferBankTarget?.title || ''}`}
      >
        <form onSubmit={handleConfirmTransferBank} className="space-y-4">
          <div>
            <label className={LABEL_CLS}>选择新的归属用户</label>
            <select
              value={transferOwnerId}
              onChange={(e) => setTransferOwnerId(e.target.value)}
              className={`${SELECT_CLS} w-full`}
            >
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nickname || u.username} (@{u.username})
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTransferBankTarget(null)}>
              取消
            </Button>
            <Button type="submit" loading={transferringBank}>
              确认转移
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
