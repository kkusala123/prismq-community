export type QuestionType = 'single' | 'multiple' | 'boolean' | 'fill' | 'short';

export type UserRole = 'admin' | 'member';

export interface QuestionOption {
  key: string;
  content: string;
}

export interface AIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  allowMemberUseSystemKey?: boolean;
}

export interface UserSettings {
  removeAfterCorrectCount: number;
  autoNextOnCorrect: boolean;
  autoNextDelayMs?: number;
  switchAnimationMs?: number;
  aiConfig?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
  };
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  nickname: string;
  role: UserRole;
  isDisabled?: boolean;
  lastActiveAt?: string | null;
  totalActiveSeconds?: number;
  settings: UserSettings;
  hasPersonalAiKey: boolean;
  systemAiAvailable: boolean;
  createdAt: string;
}

export interface QuestionBankSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  title: string;
  description: string;
  category: string;
  visibility: 'private' | 'public';
  cloneCount: number;
  questionCount: number;
  chapterCount: number;
  practicedCount: number;
  mistakeCount: number;
  masteredCount: number;
  lastProgressIndex?: number;
  sharedWithMe?: boolean;
  sharedUserCount?: number;
  shareEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BankShareMember {
  userId: string;
  username: string;
  email: string;
  nickname: string;
  via: 'direct' | 'code';
  createdAt: string;
}

export interface BankShareSettings {
  bankId: string;
  shareEnabled: boolean;
  shareCode: string;
  hasSharePassword: boolean;
  members: BankShareMember[];
}

export interface ChapterItem {
  id: string;
  bankId: string;
  title: string;
  sortOrder: number;
  questionCount: number;
}

export interface QuestionRecordState {
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  consecutiveCorrect: number;
  inMistakeBook: boolean;
  isMastered: boolean;
  isFavorited: boolean;
  note: string;
  lastAnswer: string | null;
  lastIsCorrect: boolean | null;
}

export interface QuestionItem {
  id: string;
  bankId: string;
  chapterId: string | null;
  chapterTitle?: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation: string;
  difficulty: number;
  starRating: number;
  ratingReason?: string;
  ratedAt?: string | null;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  record?: QuestionRecordState;
}

export type DifficultyTier = 'easy' | 'medium' | 'hard';

export interface BankStatsSummary {
  typeCounts: Record<QuestionType, number>;
  difficultyCounts: {
    easy: number;
    medium: number;
    hard: number;
  };
  ratedCount: number;
  totalCount: number;
  avgDifficulty: number;
  avgStarRating: number;
}

export type ExamAssemblyStrategy =
  | 'balanced'
  | 'easy_first'
  | 'hard_focus'
  | 'high_star'
  | 'custom_ratio'
  | 'random';

export interface ExamAssemblyMeta {
  strategy: ExamAssemblyStrategy;
  difficultyRatio?: {
    easy: number;
    medium: number;
    hard: number;
  };
  minStarRating?: number;
  actualDistribution: {
    easy: number;
    medium: number;
    hard: number;
    avgDifficulty: number;
    avgStarRating: number;
    ratedCount: number;
  };
}

export interface ParsedQuestionDraft {
  tempId: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer: string;
  explanation: string;
  chapterTitle: string;
  difficulty: number;
  tags: string[];
  errors: string[];
  warnings: string[];
  sourceLine?: number;
  isDuplicate?: boolean;
  aiInferredAnswer?: boolean;
}

export interface ImportValidationSummary {
  total: number;
  validCount: number;
  errorCount: number;
  warningCount: number;
  duplicateCount: number;
}

export type AiJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface AiConversionJobOptions {
  defaultChapter?: string;
  preserveOriginalWording: boolean;
  autoGenerateExplanation: boolean;
  autoInferMissingAnswer: boolean;
}

export interface AiConversionJobSummary {
  id: string;
  userId: string;
  jobType: 'extract';
  status: AiJobStatus;
  sourceFilename: string;
  sourceCharCount: number;
  options: AiConversionJobOptions;
  targetBankId: string | null;
  newBankTitle: string;
  autoImport: boolean;
  progressPct: number;
  currentChunk: number;
  totalChunks: number;
  progressMessage: string;
  modelUsed: string;
  detectedAnswerKey: boolean;
  resultSummary: ImportValidationSummary;
  importedBankId: string | null;
  importedCount: number;
  skippedCount: number;
  errorMessage: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface AiConversionJobDetail extends AiConversionJobSummary {
  sourceText: string;
  resultDrafts: ParsedQuestionDraft[];
  resultCanonicalText: string;
}

export type PracticeMode =
  | 'sequential'
  | 'random'
  | 'chapter'
  | 'type'
  | 'mistakes'
  | 'favorites'
  | 'unmastered'
  | 'unanswered';

export interface ExamQuestionSnapshot {
  questionId: string;
  type: QuestionType;
  stem: string;
  options: QuestionOption[];
  answer?: string;
  explanation?: string;
  difficulty?: number;
  starRating?: number;
  score: number;
  chapterTitle?: string;
  tags?: string[];
}

export interface CheatEventItem {
  type: string;
  detail: string;
  timestamp: string;
}

export interface ExamDeviceInfo {
  platform?: string;
  deviceLabel?: string;
  isEmulator?: boolean;
  isDebugged?: boolean;
  isVirtualSpace?: boolean;
  isMultiWindow?: boolean;
  reasons?: string[];
}

export interface ExamSummary {
  id: string;
  creatorId: string;
  creatorName?: string;
  bankId: string | null;
  bankTitle?: string;
  title: string;
  description: string;
  examType: 'mock' | 'published';
  shareCode: string;
  hasPassword: boolean;
  allowGuest: boolean;
  durationMinutes: number;
  startsAt?: string | null;
  endsAt?: string | null;
  endedAt?: string | null;
  totalScore: number;
  passScore: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  maxTabSwitches: number;
  maxAttempts: number;
  blockEmulator?: boolean;
  strictAntiCheat?: boolean;
  autoSubmitOnCheat?: boolean;
  status: 'active' | 'closed';
  questionCount: number;
  assemblyMeta?: ExamAssemblyMeta;
  submissionCount?: number;
  inProgressCount?: number;
  avgScore?: number;
  avgAccuracy?: number;
  passRate?: number;
  createdAt: string;
}

export interface GradingDetailItem {
  isCorrect: boolean;
  earnedScore: number;
  maxScore: number;
  userAnswer: string;
  correctAnswer: string;
  explanation: string;
  comment?: string;
}

export interface ExamSubmissionItem {
  id: string;
  examId: string;
  examTitle?: string;
  shareCode?: string;
  userId: string | null;
  participantName: string;
  participantIdentifier: string;
  answers: Record<string, string>;
  gradingDetail: Record<string, GradingDetailItem>;
  score: number;
  totalScore?: number;
  passScore?: number;
  isPassed: boolean;
  correctCount: number;
  totalQuestions: number;
  accuracy?: number;
  durationSeconds: number;
  tabSwitchCount: number;
  cheatEvents?: CheatEventItem[];
  deviceInfo?: ExamDeviceInfo;
  riskFlags?: string[];
  terminatedByCreator?: boolean;
  startedAt: string;
  submittedAt: string;
}

export interface ActiveExamSessionItem {
  id: string;
  examId: string;
  userId: string | null;
  participantName: string;
  participantIdentifier: string;
  status: 'in_progress' | 'submitted' | 'terminated';
  answeredCount: number;
  tabSwitchCount: number;
  cheatEvents: CheatEventItem[];
  deviceInfo: ExamDeviceInfo;
  riskFlags: string[];
  startedAt: string;
  lastHeartbeatAt: string;
}

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选题',
  multiple: '多选题',
  boolean: '判断题',
  fill: '填空题',
  short: '简答题',
};

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: '简单',
  2: '基础',
  3: '中等',
  4: '较难',
  5: '困难',
};

export const DIFFICULTY_TIER_LABELS: Record<DifficultyTier, string> = {
  easy: '简单 (1~2)',
  medium: '中等 (3)',
  hard: '较难 (4~5)',
};

export interface SystemPolicy {
  allowRegistration: boolean;
}

export interface AdminUsageDailyPoint {
  date: string;
  activeUsers: number;
  activeSeconds: number;
  practiceSeconds: number;
  examSeconds: number;
}

export interface AdminOverview {
  dbEngine: string;
  policy: SystemPolicy;
  users: {
    total: number;
    admins: number;
    disabled: number;
    todayActive: number;
    last7dActive: number;
  };
  content: {
    totalBanks: number;
    publicBanks: number;
    privateBanks: number;
    totalQuestions: number;
    ratedQuestions: number;
  };
  learning: {
    totalAnswered: number;
    totalCorrect: number;
    accuracyPercent: number;
  };
  exams: {
    totalExams: number;
    activeExams: number;
    totalSubmissions: number;
  };
  aiJobs: {
    total: number;
    running: number;
    failed: number;
  };
  usage: {
    todaySeconds: number;
    last7dSeconds: number;
    totalSeconds: number;
  };
  dailyTrend: AdminUsageDailyPoint[];
}

export interface AdminUserItem {
  id: string;
  username: string;
  email: string;
  nickname: string;
  role: UserRole;
  isDisabled: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  totalActiveSeconds: number;
  todayActiveSeconds: number;
  last7dActiveSeconds: number;
  practiceSeconds: number;
  examSeconds: number;
  bankCount: number;
  questionCount: number;
  answeredCount: number;
  submissionCount: number;
}

export interface AdminUsageUserRank {
  userId: string;
  username: string;
  nickname: string;
  role: UserRole;
  isDisabled: boolean;
  activeSeconds: number;
  practiceSeconds: number;
  examSeconds: number;
  activeDays: number;
  lastActiveAt: string | null;
  lastPath: string;
}

export interface AdminUsageResponse {
  days: string;
  startDate: string | null;
  summary: {
    totalSeconds: number;
    practiceSeconds: number;
    examSeconds: number;
    activeUsers: number;
    avgSecondsPerActiveUser: number;
  };
  dailyTrend: AdminUsageDailyPoint[];
  userRanking: AdminUsageUserRank[];
  userDaily?: Array<{
    date: string;
    activeSeconds: number;
    practiceSeconds: number;
    examSeconds: number;
    heartbeatCount: number;
    lastPath: string;
  }>;
}

export interface AdminBankItem {
  id: string;
  ownerId: string;
  ownerUsername: string;
  ownerNickname: string;
  title: string;
  description: string;
  category: string;
  visibility: 'private' | 'public';
  cloneCount: number;
  questionCount: number;
  ratedCount: number;
  chapterCount: number;
  shareEnabled: boolean;
  sharedUserCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminExamItem {
  id: string;
  creatorId: string;
  creatorUsername: string;
  creatorNickname: string;
  bankId: string | null;
  bankTitle: string;
  title: string;
  examType: 'mock' | 'published';
  shareCode: string;
  status: 'active' | 'closed';
  questionCount: number;
  durationMinutes: number;
  submissionCount: number;
  avgScore: number | null;
  passRate: number | null;
  createdAt: string;
}

export interface AdminAiJobItem {
  id: string;
  userId: string;
  username: string;
  nickname: string;
  jobType: string;
  status: string;
  sourceFilename: string;
  sourceCharCount: number;
  progressPct: number;
  modelUsed: string;
  importedCount: number;
  errorMessage: string;
  createdAt: string;
  finishedAt: string | null;
}

export interface AdminAuditLogItem {
  id: string;
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  targetLabel: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface AppUpdateReleaseInfo {
  versionName: string;
  versionCode: number;
  tagName: string;
  releaseNotes: string;
  publishedAt: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  downloadUrl: string;
  forceUpdate: boolean;
  syncedAt: string;
}

export interface AppUpdateCheckResponse {
  hasUpdate: boolean;
  currentVersion: string;
  currentVersionCode: number;
  latest: AppUpdateReleaseInfo | null;
  lastCheckedAt: string | null;
}

export interface AppUpdateAdminConfig {
  githubRepo: string;
  hasGithubToken: boolean;
  enabled: boolean;
  pollIntervalMinutes: number;
  forceUpdateMinVersion: string;
}

export interface AppUpdateSyncResult {
  ok: boolean;
  updated: boolean;
  pushedClients: number;
  latest: AppUpdateReleaseInfo | null;
  error?: string;
}

export function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function sanitizeDisplayName(raw: unknown, fallback = ''): string {
  if (raw === undefined || raw === null) return fallback;
  const trimmed = String(raw).trim();
  if (!trimmed) return fallback;
  const lower = trimmed.toLowerCase();
  if (lower === 'null' || lower === 'undefined') return fallback;
  return trimmed;
}
