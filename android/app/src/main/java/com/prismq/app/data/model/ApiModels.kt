package com.prismq.app.data.model

import kotlinx.serialization.Serializable

@Serializable
data class ApiErrorResponse(
    val error: String = "请求失败"
)

@Serializable
data class HealthResponse(
    val status: String = "",
    val dbEngine: String = "",
    val timestamp: String = ""
)

@Serializable
data class BootstrapStatusResponse(
    val needsSetup: Boolean = false,
    val allowRegistration: Boolean = true
)

@Serializable
data class RegisterRequest(
    val username: String,
    val email: String,
    val password: String,
    val nickname: String
)

@Serializable
data class LoginRequest(
    val account: String,
    val password: String
)

@Serializable
data class PersonalAiConfigDto(
    val baseUrl: String = "",
    val apiKey: String = "",
    val model: String = ""
)

@Serializable
data class UserSettingsDto(
    val removeAfterCorrectCount: Int = 3,
    val autoNextOnCorrect: Boolean = true,
    val autoNextDelayMs: Int = 650,
    val switchAnimationMs: Int = 260,
    val aiConfig: PersonalAiConfigDto? = null
)

@Serializable
data class PublicUser(
    val id: String = "",
    val username: String = "",
    val email: String = "",
    val nickname: String = "",
    val role: String = "member",
    val isDisabled: Boolean = false,
    val lastActiveAt: String? = null,
    val totalActiveSeconds: Long = 0,
    val settings: UserSettingsDto = UserSettingsDto(),
    val hasPersonalAiKey: Boolean = false,
    val systemAiAvailable: Boolean = false,
    val createdAt: String = ""
)

@Serializable
data class AuthResponse(
    val token: String = "",
    val user: PublicUser = PublicUser()
)

@Serializable
data class MeResponse(
    val user: PublicUser = PublicUser()
)

@Serializable
data class UpdateSettingsRequest(
    val nickname: String? = null,
    val removeAfterCorrectCount: Int? = null,
    val autoNextOnCorrect: Boolean? = null,
    val autoNextDelayMs: Int? = null,
    val switchAnimationMs: Int? = null,
    val clearPersonalAiKey: Boolean? = null,
    val aiConfig: PersonalAiConfigDto? = null
)

@Serializable
data class ChangePasswordRequest(
    val oldPassword: String,
    val newPassword: String
)

@Serializable
data class OkResponse(
    val ok: Boolean = true
)

@Serializable
data class HeartbeatRequest(
    val deltaSeconds: Int,
    val mode: String = "general",
    val path: String = ""
)

@Serializable
data class HeartbeatResponse(
    val ok: Boolean = true,
    val usageDate: String = "",
    val addedSeconds: Int = 0
)

@Serializable
data class AdminAiConfigDto(
    val baseUrl: String = "",
    val model: String = "",
    val apiKey: String = "",
    val hasApiKey: Boolean = false,
    val allowMemberUseSystemKey: Boolean = true
)

@Serializable
data class AdminAiConfigResponse(
    val aiConfig: AdminAiConfigDto = AdminAiConfigDto()
)

@Serializable
data class UpdateAdminAiConfigRequest(
    val baseUrl: String,
    val model: String,
    val apiKey: String = "",
    val allowMemberUseSystemKey: Boolean = true,
    val clearApiKey: Boolean = false
)

/* -------------------- Banks, Stats, Rating & Private Sharing -------------------- */

@Serializable
data class QuestionOption(
    val key: String = "",
    val content: String = ""
)

@Serializable
data class QuestionRecordState(
    val answeredCount: Int = 0,
    val correctCount: Int = 0,
    val wrongCount: Int = 0,
    val consecutiveCorrect: Int = 0,
    val inMistakeBook: Boolean = false,
    val isMastered: Boolean = false,
    val isFavorited: Boolean = false,
    val note: String = "",
    val lastAnswer: String? = null,
    val lastIsCorrect: Boolean? = null
)

@Serializable
data class QuestionItem(
    val id: String = "",
    val bankId: String = "",
    val bankTitle: String? = null,
    val chapterId: String? = null,
    val chapterTitle: String? = null,
    val type: String = "single",
    val stem: String = "",
    val options: List<QuestionOption> = emptyList(),
    val answer: String = "",
    val explanation: String = "",
    val difficulty: Int = 2,
    val starRating: Int = 0,
    val ratingReason: String = "",
    val ratedAt: String? = null,
    val tags: List<String> = emptyList(),
    val sortOrder: Int = 0,
    val createdAt: String = "",
    val record: QuestionRecordState? = null
)

@Serializable
data class QuestionBankSummary(
    val id: String = "",
    val ownerId: String = "",
    val ownerName: String = "",
    val title: String = "",
    val description: String = "",
    val category: String = "默认分类",
    val visibility: String = "private",
    val cloneCount: Int = 0,
    val questionCount: Int = 0,
    val chapterCount: Int = 0,
    val practicedCount: Int = 0,
    val mistakeCount: Int = 0,
    val masteredCount: Int = 0,
    val lastProgressIndex: Int = 0,
    val sharedWithMe: Boolean = false,
    val sharedUserCount: Int = 0,
    val shareEnabled: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = ""
)

@Serializable
data class BanksListResponse(
    val banks: List<QuestionBankSummary> = emptyList()
)

@Serializable
data class CreateBankRequest(
    val title: String,
    val category: String = "默认分类",
    val description: String = "",
    val visibility: String = "private"
)

@Serializable
data class IdResponse(
    val id: String = ""
)

@Serializable
data class ChapterItem(
    val id: String = "",
    val bankId: String = "",
    val title: String = "",
    val sortOrder: Int = 0,
    val questionCount: Int = 0
)

@Serializable
data class DifficultyTierCountsDto(
    val easy: Int = 0,
    val medium: Int = 0,
    val hard: Int = 0
)

@Serializable
data class BankStatsSummary(
    val totalCount: Int = 0,
    val ratedCount: Int = 0,
    val avgDifficulty: Double = 2.0,
    val avgStarRating: Double = 0.0,
    val typeCounts: Map<String, Int> = emptyMap(),
    val difficultyCounts: DifficultyTierCountsDto = DifficultyTierCountsDto()
)

@Serializable
data class BankDetailInfo(
    val id: String = "",
    val ownerId: String = "",
    val ownerName: String = "",
    val title: String = "",
    val description: String = "",
    val category: String = "",
    val visibility: String = "private",
    val cloneCount: Int = 0,
    val canEdit: Boolean = false,
    val isSharedWithMe: Boolean = false,
    val sharedUserCount: Int = 0,
    val shareEnabled: Boolean = false,
    val shareCode: String = "",
    val hasSharePassword: Boolean = false,
    val lastProgressIndex: Int = 0
)

@Serializable
data class BankDetailResponse(
    val bank: BankDetailInfo = BankDetailInfo(),
    val chapters: List<ChapterItem> = emptyList(),
    val questions: List<QuestionItem> = emptyList(),
    val stats: BankStatsSummary? = null
)

@Serializable
data class UpdateBankVisibilityRequest(
    val visibility: String
)

@Serializable
data class BankShareMember(
    val userId: String = "",
    val username: String = "",
    val nickname: String = "",
    val email: String = "",
    val via: String = "direct",
    val createdAt: String = ""
)

@Serializable
data class BankShareSettings(
    val bankId: String = "",
    val shareEnabled: Boolean = false,
    val shareCode: String = "",
    val hasSharePassword: Boolean = false,
    val members: List<BankShareMember> = emptyList()
)

@Serializable
data class UpdateBankShareRequest(
    val shareEnabled: Boolean? = null,
    val resetCode: Boolean? = null,
    val sharePassword: String? = null,
    val clearPassword: Boolean? = null
)

@Serializable
data class AddBankShareMemberRequest(
    val account: String
)

@Serializable
data class BankShareMembersResponse(
    val ok: Boolean = true,
    val members: List<BankShareMember> = emptyList()
)

@Serializable
data class SharedBankPreviewItem(
    val id: String = "",
    val title: String = "",
    val description: String = "",
    val category: String = "",
    val ownerName: String = "",
    val visibility: String = "private",
    val questionCount: Int = 0,
    val requiresPassword: Boolean = false,
    val alreadyAccessible: Boolean = false
)

@Serializable
data class SharedBankPreviewResponse(
    val bank: SharedBankPreviewItem = SharedBankPreviewItem()
)

@Serializable
data class JoinBankShareRequest(
    val shareCode: String,
    val password: String = ""
)

@Serializable
data class JoinBankShareResponse(
    val bankId: String = "",
    val title: String = "",
    val visibility: String = "private"
)

/* -------------------- Practice, Mistakes & Search -------------------- */

@Serializable
data class DashboardStats(
    val myBanksCount: Int = 0,
    val totalAnswered: Int = 0,
    val totalCorrect: Int = 0,
    val accuracy: Int = 0,
    val mistakeCount: Int = 0,
    val masteredCount: Int = 0,
    val favoriteCount: Int = 0
)

@Serializable
data class RecentBankItem(
    val id: String = "",
    val title: String = "",
    val category: String = "",
    val visibility: String = "private",
    val lastQuestionIndex: Int = 0,
    val lastMode: String = "sequential",
    val questionCount: Int = 0,
    val practicedCount: Int = 0
)

@Serializable
data class PublicBankItem(
    val id: String = "",
    val title: String = "",
    val description: String = "",
    val category: String = "",
    val cloneCount: Int = 0,
    val ownerName: String = "",
    val questionCount: Int = 0
)

@Serializable
data class ActiveExamItem(
    val id: String = "",
    val title: String = "",
    val shareCode: String = "",
    val durationMinutes: Int = 60,
    val examType: String = "mock"
)

@Serializable
data class DashboardResponse(
    val stats: DashboardStats = DashboardStats(),
    val recentBanks: List<RecentBankItem> = emptyList(),
    val publicBanks: List<PublicBankItem> = emptyList(),
    val activeExams: List<ActiveExamItem> = emptyList()
)

@Serializable
data class PracticeSessionResponse(
    val questions: List<QuestionItem> = emptyList(),
    val lastProgressIndex: Int = 0,
    val nextUnansweredIndex: Int = 0,
    val shuffled: Boolean = false,
    val shuffleSeed: String = ""
)

@Serializable
data class ShareQrInfoResponse(
    val bankId: String? = null,
    val examId: String? = null,
    val title: String = "",
    val shareCode: String = "",
    val shareUrl: String = "",
    val miniProgramPath: String = "",
    val qrDataUrl: String = "",
    val questionCount: Int = 0,
    val requiresPassword: Boolean = false
)

@Serializable
data class BankFormatCodeResponse(
    val ok: Boolean = true,
    val scannedCount: Int = 0,
    val formattedCount: Int = 0
)

@Serializable
data class SavePracticeProgressRequest(
    val bankId: String,
    val currentIndex: Int,
    val mode: String = "sequential"
)

@Serializable
data class ResetPracticeProgressRequest(
    val bankId: String,
    val mode: String = "sequential",
    val questionIds: List<String>? = null
)

@Serializable
data class ResetPracticeProgressResponse(
    val ok: Boolean = true,
    val resetCount: Int = 0,
    val lastQuestionIndex: Int = 0
)

@Serializable
data class SubmitPracticeAnswerRequest(
    val questionId: String,
    val answer: String,
    val currentIndex: Int,
    val mode: String = "sequential"
)

@Serializable
data class SubmitPracticeAnswerResponse(
    val isCorrect: Boolean = false,
    val standardAnswer: String = "",
    val explanation: String = "",
    val removedFromMistakeBook: Boolean = false,
    val threshold: Int = 3,
    val record: QuestionRecordState = QuestionRecordState()
)

@Serializable
data class ToggleQuestionRequest(
    val questionId: String,
    val action: String
)

@Serializable
data class ToggleQuestionResponse(
    val isMastered: Boolean = false,
    val isFavorited: Boolean = false
)

@Serializable
data class SaveNoteRequest(
    val questionId: String,
    val note: String
)

@Serializable
data class MistakesResponse(
    val items: List<QuestionItem> = emptyList(),
    val removeThreshold: Int = 3
)

@Serializable
data class SearchResponse(
    val items: List<QuestionItem> = emptyList()
)

/* -------------------- Import & Background AI Conversion Jobs -------------------- */

@Serializable
data class ParsedQuestionDraft(
    val tempId: String = "",
    val type: String = "single",
    val stem: String = "",
    val options: List<QuestionOption> = emptyList(),
    val answer: String = "",
    val explanation: String = "",
    val chapterTitle: String = "",
    val difficulty: Int = 2,
    val tags: List<String> = emptyList(),
    val errors: List<String> = emptyList(),
    val warnings: List<String> = emptyList(),
    val sourceLine: Int? = null,
    val isDuplicate: Boolean? = null,
    val aiInferredAnswer: Boolean? = null
)

@Serializable
data class ImportValidationSummary(
    val total: Int = 0,
    val validCount: Int = 0,
    val errorCount: Int = 0,
    val warningCount: Int = 0,
    val duplicateCount: Int = 0
)

@Serializable
data class ImportExtractResponse(
    val mode: String = "structured",
    val sourceFormat: String = "",
    val filename: String = "",
    val count: Int = 0,
    val drafts: List<ParsedQuestionDraft> = emptyList(),
    val summary: ImportValidationSummary = ImportValidationSummary(),
    val canonicalText: String = "",
    val rawText: String = ""
)

@Serializable
data class ParseTextRequest(
    val text: String,
    val defaultChapter: String = "",
    val bankId: String? = null
)

@Serializable
data class ParseTextResponse(
    val count: Int = 0,
    val drafts: List<ParsedQuestionDraft> = emptyList(),
    val summary: ImportValidationSummary = ImportValidationSummary(),
    val canonicalText: String = ""
)

@Serializable
data class BatchImportRequest(
    val questions: List<ParsedQuestionDraft>,
    val skipInvalid: Boolean = true
)

@Serializable
data class BatchImportResponse(
    val insertedCount: Int = 0,
    val skippedCount: Int = 0
)

@Serializable
data class AiJobSummary(
    val id: String = "",
    val userId: String = "",
    val jobType: String = "extract",
    val status: String = "queued",
    val sourceFilename: String = "",
    val sourceCharCount: Int = 0,
    val targetBankId: String? = null,
    val newBankTitle: String = "",
    val autoImport: Boolean = false,
    val progressPct: Int = 0,
    val currentChunk: Int = 0,
    val totalChunks: Int = 0,
    val progressMessage: String = "",
    val modelUsed: String = "",
    val detectedAnswerKey: Boolean = false,
    val resultSummary: ImportValidationSummary = ImportValidationSummary(),
    val importedBankId: String? = null,
    val importedCount: Int = 0,
    val skippedCount: Int = 0,
    val errorMessage: String = "",
    val createdAt: String = "",
    val startedAt: String? = null,
    val finishedAt: String? = null,
    val updatedAt: String = ""
)

@Serializable
data class AiJobsListResponse(
    val jobs: List<AiJobSummary> = emptyList(),
    val activeCount: Int = 0
)

@Serializable
data class AiJobSingleResponse(
    val job: AiJobSummary = AiJobSummary()
)

@Serializable
data class CreateAiJobTextRequest(
    val rawText: String,
    val sourceFilename: String = "",
    val defaultChapter: String = "",
    val targetBankId: String = "",
    val newBankTitle: String = "",
    val autoImport: Boolean = true,
    val preserveOriginalWording: Boolean = true,
    val autoGenerateExplanation: Boolean = true,
    val autoInferMissingAnswer: Boolean = false
)

/* -------------------- Exams & Dynamic Balanced Assembly -------------------- */

@Serializable
data class DifficultyRatioDto(
    val easy: Int = 30,
    val medium: Int = 50,
    val hard: Int = 20
)

@Serializable
data class ExamAssemblyActualDistribution(
    val easy: Int = 0,
    val medium: Int = 0,
    val hard: Int = 0,
    val avgDifficulty: Double = 2.0,
    val avgStarRating: Double = 0.0,
    val ratedCount: Int = 0
)

@Serializable
data class ExamAssemblyMeta(
    val strategy: String = "balanced",
    val difficultyRatio: DifficultyRatioDto? = null,
    val minStarRating: Int? = null,
    val actualDistribution: ExamAssemblyActualDistribution = ExamAssemblyActualDistribution()
)

@Serializable
data class CheatEventDto(
    val type: String = "",
    val detail: String = "",
    val timestamp: String = ""
)

@Serializable
data class ExamDeviceInfoDto(
    val platform: String = "android",
    val deviceLabel: String = "",
    val isEmulator: Boolean = false,
    val isDebugged: Boolean = false,
    val isVirtualSpace: Boolean = false,
    val isMultiWindow: Boolean = false,
    val reasons: List<String> = emptyList()
)

@Serializable
data class ExamSummary(
    val id: String = "",
    val creatorId: String = "",
    val creatorName: String = "",
    val bankId: String? = null,
    val bankTitle: String? = null,
    val title: String = "",
    val description: String = "",
    val examType: String = "mock",
    val shareCode: String = "",
    val hasPassword: Boolean = false,
    val allowGuest: Boolean = true,
    val durationMinutes: Int = 60,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val endedAt: String? = null,
    val totalScore: Double = 100.0,
    val passScore: Double = 60.0,
    val shuffleQuestions: Boolean = false,
    val shuffleOptions: Boolean = false,
    val maxTabSwitches: Int = 5,
    val maxAttempts: Int = 3,
    val blockEmulator: Boolean = false,
    val strictAntiCheat: Boolean = true,
    val autoSubmitOnCheat: Boolean = true,
    val status: String = "active",
    val questionCount: Int = 0,
    val assemblyMeta: ExamAssemblyMeta? = null,
    val submissionCount: Int? = null,
    val inProgressCount: Int? = null,
    val avgScore: Double? = null,
    val avgAccuracy: Double? = null,
    val passRate: Double? = null,
    val createdAt: String = ""
)

@Serializable
data class GradingDetailItem(
    val isCorrect: Boolean = false,
    val earnedScore: Double = 0.0,
    val maxScore: Double = 0.0,
    val userAnswer: String = "",
    val correctAnswer: String = "",
    val explanation: String = "",
    val comment: String? = null
)

@Serializable
data class ExamSubmissionItem(
    val id: String = "",
    val examId: String = "",
    val examTitle: String? = null,
    val shareCode: String? = null,
    val creatorId: String? = null,
    val userId: String? = null,
    val participantName: String = "",
    val participantIdentifier: String = "",
    val answers: Map<String, String> = emptyMap(),
    val gradingDetail: Map<String, GradingDetailItem> = emptyMap(),
    val score: Double = 0.0,
    val totalScore: Double? = null,
    val passScore: Double? = null,
    val isPassed: Boolean = false,
    val correctCount: Int = 0,
    val totalQuestions: Int = 0,
    val accuracy: Double? = null,
    val durationSeconds: Int = 0,
    val tabSwitchCount: Int = 0,
    val cheatEvents: List<CheatEventDto> = emptyList(),
    val deviceInfo: ExamDeviceInfoDto? = null,
    val riskFlags: List<String> = emptyList(),
    val terminatedByCreator: Boolean = false,
    val startedAt: String = "",
    val submittedAt: String = ""
)

@Serializable
data class ExamsListResponse(
    val exams: List<ExamSummary> = emptyList(),
    val submissions: List<ExamSubmissionItem> = emptyList()
)

@Serializable
data class CreateExamRequest(
    val bankId: String,
    val title: String,
    val description: String = "",
    val examType: String = "mock",
    val durationMinutes: Int = 60,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val totalQuestions: Int = 20,
    val counts: Map<String, Int>? = null,
    val chapterIds: List<String>? = null,
    val questionScores: Map<String, Double>? = null,
    val strategy: String = "balanced",
    val difficultyRatio: DifficultyRatioDto? = null,
    val minStarRating: Int = 0,
    val totalScore: Int = 100,
    val passScorePercent: Int = 60,
    val shuffleQuestions: Boolean = true,
    val shuffleOptions: Boolean = true,
    val maxTabSwitches: Int = 5,
    val maxAttempts: Int = 3,
    val accessPassword: String = "",
    val allowGuest: Boolean = true,
    val blockEmulator: Boolean = false,
    val strictAntiCheat: Boolean = true,
    val autoSubmitOnCheat: Boolean = true
)

@Serializable
data class CreateExamResponse(
    val id: String = "",
    val examType: String = "mock",
    val shareCode: String = "",
    val totalScore: Double = 100.0,
    val passScore: Double = 60.0,
    val questionCount: Int = 0,
    val typeBreakdown: Map<String, Int> = emptyMap(),
    val assemblyMeta: ExamAssemblyMeta? = null,
    val warnings: List<String> = emptyList()
)

@Serializable
data class ExamAssemblyPreviewRequest(
    val bankId: String,
    val totalQuestions: Int = 20,
    val counts: Map<String, Int>? = null,
    val chapterIds: List<String>? = null,
    val strategy: String = "balanced",
    val difficultyRatio: DifficultyRatioDto? = null,
    val minStarRating: Int = 0
)

@Serializable
data class ExamAssemblyPoolStats(
    val total: Int = 0,
    val typeCounts: Map<String, Int> = emptyMap(),
    val difficultyCounts: DifficultyTierCountsDto = DifficultyTierCountsDto(),
    val ratedCount: Int = 0
)

@Serializable
data class ExamAssemblyProjected(
    val totalPicked: Int = 0,
    val typeBreakdown: Map<String, Int> = emptyMap(),
    val meta: ExamAssemblyMeta = ExamAssemblyMeta()
)

@Serializable
data class ExamAssemblyPreviewResponse(
    val poolStats: ExamAssemblyPoolStats = ExamAssemblyPoolStats(),
    val projected: ExamAssemblyProjected = ExamAssemblyProjected(),
    val warnings: List<String> = emptyList()
)

@Serializable
data class ExamMetaInfo(
    val id: String = "",
    val title: String = "",
    val description: String = "",
    val creatorName: String = "",
    val examType: String = "mock",
    val shareCode: String = "",
    val hasPassword: Boolean = false,
    val allowGuest: Boolean = true,
    val durationMinutes: Int = 60,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val endedAt: String? = null,
    val notStarted: Boolean = false,
    val expired: Boolean = false,
    val totalScore: Double = 100.0,
    val passScore: Double = 60.0,
    val maxTabSwitches: Int = 5,
    val maxAttempts: Int = 3,
    val blockEmulator: Boolean = false,
    val strictAntiCheat: Boolean = true,
    val autoSubmitOnCheat: Boolean = true,
    val status: String = "active",
    val questionCount: Int = 0
)

@Serializable
data class ExamQuestionSnapshot(
    val questionId: String = "",
    val type: String = "single",
    val stem: String = "",
    val options: List<QuestionOption> = emptyList(),
    val answer: String? = null,
    val explanation: String? = null,
    val difficulty: Int? = null,
    val starRating: Int? = null,
    val score: Double = 0.0,
    val chapterTitle: String? = null,
    val tags: List<String> = emptyList()
)

@Serializable
data class ExamJoinResponse(
    val requiresPassword: Boolean = false,
    val requiresLogin: Boolean = false,
    val exam: ExamMetaInfo = ExamMetaInfo(),
    val questions: List<ExamQuestionSnapshot> = emptyList()
)

@Serializable
data class ExamStartRequest(
    val participantName: String = "",
    val participantIdentifier: String = "",
    val accessPassword: String = "",
    val deviceInfo: ExamDeviceInfoDto = ExamDeviceInfoDto(),
    val cheatEvents: List<CheatEventDto> = emptyList()
)

@Serializable
data class ExamStartResponse(
    val sessionId: String = "",
    val startedAt: String = "",
    val serverTime: String = "",
    val effectiveDurationSeconds: Int = 3600
)

@Serializable
data class ExamHeartbeatRequest(
    val sessionId: String,
    val answers: Map<String, String> = emptyMap(),
    val tabSwitchCount: Int = 0,
    val cheatEvents: List<CheatEventDto> = emptyList(),
    val deviceInfo: ExamDeviceInfoDto = ExamDeviceInfoDto()
)

@Serializable
data class ExamHeartbeatResponse(
    val examStatus: String = "active",
    val terminated: Boolean = false,
    val forceSubmitted: Boolean = false,
    val submissionId: String? = null,
    val remainingServerSeconds: Int? = null
)

@Serializable
data class ExamTerminateResponse(
    val ok: Boolean = true,
    val status: String = "closed",
    val endedAt: String = "",
    val terminatedCount: Int = 0
)

@Serializable
data class ActiveExamSessionDto(
    val id: String = "",
    val examId: String = "",
    val participantName: String = "",
    val participantIdentifier: String = "",
    val answeredCount: Int = 0,
    val tabSwitchCount: Int = 0,
    val cheatEvents: List<CheatEventDto> = emptyList(),
    val deviceInfo: ExamDeviceInfoDto? = null,
    val riskFlags: List<String> = emptyList(),
    val startedAt: String = "",
    val lastHeartbeatAt: String = ""
)

@Serializable
data class ExamAnalyticsExamDto(
    val id: String = "",
    val title: String = "",
    val shareCode: String = "",
    val totalScore: Double = 100.0,
    val passScore: Double = 60.0,
    val durationMinutes: Int = 60,
    val startsAt: String? = null,
    val endsAt: String? = null,
    val endedAt: String? = null,
    val maxTabSwitches: Int = 5,
    val blockEmulator: Boolean = false,
    val status: String = "active"
)

@Serializable
data class ExamAnalyticsSummaryDto(
    val submissionCount: Int = 0,
    val inProgressCount: Int = 0,
    val avgScore: Double = 0.0,
    val avgAccuracy: Double = 0.0,
    val maxScore: Double = 0.0,
    val minScore: Double = 0.0,
    val passCount: Int = 0,
    val passRate: Int = 0,
    val riskSubmissionCount: Int = 0
)

@Serializable
data class ExamQuestionStatDto(
    val index: Int = 0,
    val questionId: String = "",
    val type: String = "single",
    val stem: String = "",
    val chapterTitle: String = "",
    val score: Double = 0.0,
    val correctTimes: Int = 0,
    val wrongTimes: Int = 0,
    val correctRate: Int = 0,
    val errorRate: Int = 0
)

@Serializable
data class ChapterMasteryDto(
    val chapter: String = "",
    val masteryRate: Int = 0
)

@Serializable
data class ExamAnalyticsResponse(
    val exam: ExamAnalyticsExamDto = ExamAnalyticsExamDto(),
    val summary: ExamAnalyticsSummaryDto = ExamAnalyticsSummaryDto(),
    val activeSessions: List<ActiveExamSessionDto> = emptyList(),
    val submissions: List<ExamSubmissionItem> = emptyList(),
    val questionStats: List<ExamQuestionStatDto> = emptyList(),
    val chapterMastery: List<ChapterMasteryDto> = emptyList()
)

@Serializable
data class ExamSubmitRequest(
    val sessionId: String? = null,
    val participantName: String = "",
    val participantIdentifier: String = "",
    val accessPassword: String = "",
    val answers: Map<String, String> = emptyMap(),
    val durationSeconds: Int = 0,
    val tabSwitchCount: Int = 0,
    val cheatEvents: List<CheatEventDto> = emptyList(),
    val deviceInfo: ExamDeviceInfoDto = ExamDeviceInfoDto(),
    val startedAt: String = ""
)

@Serializable
data class ExamSubmitResponse(
    val submission: ExamSubmissionItem = ExamSubmissionItem()
)

@Serializable
data class ExamSubmissionDetailResponse(
    val submission: ExamSubmissionItem = ExamSubmissionItem(),
    val questions: List<ExamQuestionSnapshot> = emptyList()
)

/* -------------------- AI Explain, Connection Test & Bank Star Rating -------------------- */

@Serializable
data class AiExplainRequest(
    val questionId: String? = null,
    val userAnswer: String? = null,
    val saveToQuestion: Boolean = false,
    val type: String? = null,
    val stem: String? = null,
    val options: List<QuestionOption>? = null,
    val answer: String? = null,
    val explanation: String? = null
)

@Serializable
data class AiExplainResponse(
    val keyPoint: String = "",
    val analysis: String = "",
    val mnemonic: String = ""
)

@Serializable
data class AiTestRequest(
    val scope: String = "personal",
    val baseUrl: String = "",
    val apiKey: String = "",
    val model: String = ""
)

@Serializable
data class AiTestResponse(
    val ok: Boolean = false,
    val message: String = "",
    val error: String = "",
    val reply: String = "",
    val endpoint: String = "",
    val latencyMs: Long = 0
)

@Serializable
data class AiRateBankRequest(
    val bankId: String,
    val questionIds: List<String>? = null,
    val onlyUnrated: Boolean = true,
    val limit: Int = 20,
    val offset: Int = 0
)

@Serializable
data class AiRatedItem(
    val id: String = "",
    val difficulty: Int = 2,
    val starRating: Int = 3,
    val reason: String = ""
)

@Serializable
data class AiRateBankResponse(
    val ratedCount: Int = 0,
    val processedCount: Int = 0,
    val remainingUnrated: Int = 0,
    val modelUsed: String = "",
    val results: List<AiRatedItem> = emptyList()
)

/* -------------------- System Admin Console -------------------- */

@Serializable
data class SystemPolicyDto(
    val allowRegistration: Boolean = true
)

@Serializable
data class AdminPolicyResponse(
    val policy: SystemPolicyDto = SystemPolicyDto()
)

@Serializable
data class AdminUsageDailyPoint(
    val date: String = "",
    val activeUsers: Int = 0,
    val activeSeconds: Long = 0,
    val practiceSeconds: Long = 0,
    val examSeconds: Long = 0
)

@Serializable
data class AdminOverviewUsers(
    val total: Int = 0,
    val admins: Int = 0,
    val disabled: Int = 0,
    val todayActive: Int = 0,
    val last7dActive: Int = 0
)

@Serializable
data class AdminOverviewContent(
    val totalBanks: Int = 0,
    val publicBanks: Int = 0,
    val privateBanks: Int = 0,
    val totalQuestions: Int = 0,
    val ratedQuestions: Int = 0
)

@Serializable
data class AdminOverviewLearning(
    val totalAnswered: Long = 0,
    val totalCorrect: Long = 0,
    val accuracyPercent: Int = 0
)

@Serializable
data class AdminOverviewExams(
    val totalExams: Int = 0,
    val activeExams: Int = 0,
    val totalSubmissions: Int = 0
)

@Serializable
data class AdminOverviewAiJobs(
    val total: Int = 0,
    val running: Int = 0,
    val failed: Int = 0
)

@Serializable
data class AdminOverviewUsage(
    val todaySeconds: Long = 0,
    val last7dSeconds: Long = 0,
    val totalSeconds: Long = 0
)

@Serializable
data class AdminOverviewResponse(
    val dbEngine: String = "",
    val policy: SystemPolicyDto = SystemPolicyDto(),
    val users: AdminOverviewUsers = AdminOverviewUsers(),
    val content: AdminOverviewContent = AdminOverviewContent(),
    val learning: AdminOverviewLearning = AdminOverviewLearning(),
    val exams: AdminOverviewExams = AdminOverviewExams(),
    val aiJobs: AdminOverviewAiJobs = AdminOverviewAiJobs(),
    val usage: AdminOverviewUsage = AdminOverviewUsage(),
    val dailyTrend: List<AdminUsageDailyPoint> = emptyList()
)

@Serializable
data class AdminUserItem(
    val id: String = "",
    val username: String = "",
    val email: String = "",
    val nickname: String = "",
    val role: String = "member",
    val isDisabled: Boolean = false,
    val createdAt: String = "",
    val lastActiveAt: String? = null,
    val totalActiveSeconds: Long = 0,
    val todayActiveSeconds: Long = 0,
    val last7dActiveSeconds: Long = 0,
    val practiceSeconds: Long = 0,
    val examSeconds: Long = 0,
    val bankCount: Int = 0,
    val questionCount: Int = 0,
    val answeredCount: Int = 0,
    val submissionCount: Int = 0
)

@Serializable
data class AdminUsersListResponse(
    val users: List<AdminUserItem> = emptyList()
)

@Serializable
data class AdminCreateUserRequest(
    val username: String,
    val email: String,
    val password: String,
    val nickname: String = "",
    val role: String = "member"
)

@Serializable
data class AdminUpdateUserRequest(
    val nickname: String? = null,
    val role: String? = null,
    val isDisabled: Boolean? = null
)

@Serializable
data class AdminResetPasswordRequest(
    val newPassword: String
)

@Serializable
data class AdminUsageSummary(
    val totalSeconds: Long = 0,
    val practiceSeconds: Long = 0,
    val examSeconds: Long = 0,
    val activeUsers: Int = 0,
    val avgSecondsPerActiveUser: Long = 0
)

@Serializable
data class AdminUsageUserRank(
    val userId: String = "",
    val username: String = "",
    val nickname: String = "",
    val role: String = "member",
    val isDisabled: Boolean = false,
    val activeSeconds: Long = 0,
    val practiceSeconds: Long = 0,
    val examSeconds: Long = 0,
    val activeDays: Int = 0,
    val lastActiveAt: String? = null,
    val lastPath: String = ""
)

@Serializable
data class AdminUserDailyItem(
    val date: String = "",
    val activeSeconds: Long = 0,
    val practiceSeconds: Long = 0,
    val examSeconds: Long = 0,
    val heartbeatCount: Int = 0,
    val lastPath: String = ""
)

@Serializable
data class AdminUsageResponse(
    val days: String = "7",
    val startDate: String? = null,
    val summary: AdminUsageSummary = AdminUsageSummary(),
    val dailyTrend: List<AdminUsageDailyPoint> = emptyList(),
    val userRanking: List<AdminUsageUserRank> = emptyList(),
    val userDaily: List<AdminUserDailyItem> = emptyList()
)

@Serializable
data class AdminBankItem(
    val id: String = "",
    val ownerId: String = "",
    val ownerUsername: String = "",
    val ownerNickname: String = "",
    val title: String = "",
    val description: String = "",
    val category: String = "",
    val visibility: String = "private",
    val cloneCount: Int = 0,
    val questionCount: Int = 0,
    val ratedCount: Int = 0,
    val chapterCount: Int = 0,
    val shareEnabled: Boolean = false,
    val sharedUserCount: Int = 0,
    val createdAt: String = "",
    val updatedAt: String = ""
)

@Serializable
data class AdminBanksResponse(
    val banks: List<AdminBankItem> = emptyList()
)

@Serializable
data class AdminUpdateBankRequest(
    val visibility: String? = null,
    val disableShare: Boolean? = null,
    val ownerId: String? = null
)

@Serializable
data class AdminExamItem(
    val id: String = "",
    val creatorId: String = "",
    val creatorUsername: String = "",
    val creatorNickname: String = "",
    val bankId: String? = null,
    val bankTitle: String = "",
    val title: String = "",
    val examType: String = "mock",
    val shareCode: String = "",
    val status: String = "active",
    val questionCount: Int = 0,
    val durationMinutes: Int = 60,
    val submissionCount: Int = 0,
    val avgScore: Double? = null,
    val passRate: Double? = null,
    val createdAt: String = ""
)

@Serializable
data class AdminExamsResponse(
    val exams: List<AdminExamItem> = emptyList()
)

@Serializable
data class AdminUpdateExamRequest(
    val status: String
)

@Serializable
data class AdminAiJobItem(
    val id: String = "",
    val userId: String = "",
    val username: String = "",
    val nickname: String = "",
    val jobType: String = "extract",
    val status: String = "",
    val sourceFilename: String = "",
    val sourceCharCount: Int = 0,
    val progressPct: Int = 0,
    val modelUsed: String = "",
    val importedCount: Int = 0,
    val errorMessage: String = "",
    val createdAt: String = "",
    val finishedAt: String? = null
)

@Serializable
data class AdminAiJobsResponse(
    val jobs: List<AdminAiJobItem> = emptyList()
)

@Serializable
data class AdminAuditLogItem(
    val id: String = "",
    val actorId: String? = null,
    val actorName: String = "",
    val action: String = "",
    val targetType: String = "",
    val targetId: String = "",
    val targetLabel: String = "",
    val createdAt: String = ""
)

@Serializable
data class AdminAuditLogsResponse(
    val logs: List<AdminAuditLogItem> = emptyList()
)

/* -------------------- App Update Push -------------------- */

@Serializable
data class AppUpdateReleaseDto(
    val versionName: String = "",
    val versionCode: Int = 0,
    val tagName: String = "",
    val releaseNotes: String = "",
    val publishedAt: String = "",
    val fileName: String = "",
    val fileSize: Long = 0L,
    val sha256: String = "",
    val downloadUrl: String = "/api/app-update/download",
    val forceUpdate: Boolean = false,
    val syncedAt: String = ""
)

@Serializable
data class AppUpdateCheckResponse(
    val hasUpdate: Boolean = false,
    val currentVersion: String = "",
    val currentVersionCode: Int = 0,
    val latest: AppUpdateReleaseDto? = null,
    val lastCheckedAt: String? = null
)

@Serializable
data class AppUpdateSyncResponse(
    val ok: Boolean = false,
    val updated: Boolean = false,
    val pushedClients: Int = 0,
    val latest: AppUpdateReleaseDto? = null,
    val error: String? = null
)

/* -------------------- UI Label Formatters -------------------- */

fun questionTypeLabel(type: String): String = when (type) {
    "single" -> "单选题"
    "multiple" -> "多选题"
    "boolean" -> "判断题"
    "fill" -> "填空题"
    "short" -> "简答题"
    else -> "题目"
}

fun difficultyLabel(difficulty: Int): String = when (difficulty) {
    1 -> "简单"
    2 -> "基础"
    3 -> "中等"
    4 -> "较难"
    5 -> "困难"
    else -> "难度$difficulty"
}

fun difficultyTierLabel(tier: String): String = when (tier) {
    "easy" -> "简单(1~2)"
    "medium" -> "中等(3)"
    "hard" -> "较难(4~5)"
    else -> "全部难度"
}

fun assemblyStrategyLabel(strategy: String): String = when (strategy) {
    "balanced" -> "难度均衡 (3:5:2)"
    "easy_first" -> "基础递进 (6:3:1)"
    "hard_focus" -> "攻坚拔高 (1.5:3.5:5)"
    "high_star" -> "高星核心精选"
    "custom_ratio" -> "自定义难易比"
    "random" -> "随机抽题"
    else -> "智能组卷"
}

fun formatDurationSeconds(totalSeconds: Long): String {
    val sec = totalSeconds.coerceAtLeast(0L)
    if (sec == 0L) return "0 分钟"
    if (sec < 60L) return "$sec 秒"
    val mins = sec / 60L
    if (mins < 60L) return "$mins 分钟"
    val hours = mins / 60L
    val remMins = mins % 60L
    return if (remMins > 0L) "${hours} 小时 ${remMins} 分" else "${hours} 小时"
}

fun sanitizeDisplayName(raw: String?, fallback: String = ""): String {
    val trimmed = raw?.trim().orEmpty()
    if (trimmed.isEmpty()) return fallback
    if (trimmed.equals("null", ignoreCase = true) || trimmed.equals("undefined", ignoreCase = true)) {
        return fallback
    }
    return trimmed
}

fun PublicUser.displayName(): String =
    sanitizeDisplayName(nickname, sanitizeDisplayName(username, "同学"))
