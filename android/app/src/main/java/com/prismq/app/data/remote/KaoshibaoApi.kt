package com.prismq.app.data.remote

import com.prismq.app.data.model.AddBankShareMemberRequest
import com.prismq.app.data.model.AdminAiConfigResponse
import com.prismq.app.data.model.AdminAiJobsResponse
import com.prismq.app.data.model.AdminAuditLogsResponse
import com.prismq.app.data.model.AdminBanksResponse
import com.prismq.app.data.model.AdminCreateUserRequest
import com.prismq.app.data.model.AdminExamsResponse
import com.prismq.app.data.model.AdminOverviewResponse
import com.prismq.app.data.model.AdminPolicyResponse
import com.prismq.app.data.model.AdminResetPasswordRequest
import com.prismq.app.data.model.AdminUpdateBankRequest
import com.prismq.app.data.model.AdminUpdateExamRequest
import com.prismq.app.data.model.AdminUpdateUserRequest
import com.prismq.app.data.model.AdminUsageResponse
import com.prismq.app.data.model.AdminUsersListResponse
import com.prismq.app.data.model.AiExplainRequest
import com.prismq.app.data.model.AiExplainResponse
import com.prismq.app.data.model.AiJobSingleResponse
import com.prismq.app.data.model.AiJobsListResponse
import com.prismq.app.data.model.AiRateBankRequest
import com.prismq.app.data.model.AiRateBankResponse
import com.prismq.app.data.model.AiTestRequest
import com.prismq.app.data.model.AiTestResponse
import com.prismq.app.data.model.AuthResponse
import com.prismq.app.data.model.BankDetailResponse
import com.prismq.app.data.model.BankFormatCodeResponse
import com.prismq.app.data.model.BankShareMembersResponse
import com.prismq.app.data.model.BankShareSettings
import com.prismq.app.data.model.BanksListResponse
import com.prismq.app.data.model.BatchImportRequest
import com.prismq.app.data.model.BatchImportResponse
import com.prismq.app.data.model.BootstrapStatusResponse
import com.prismq.app.data.model.ChangePasswordRequest
import com.prismq.app.data.model.CreateAiJobTextRequest
import com.prismq.app.data.model.CreateBankRequest
import com.prismq.app.data.model.CreateExamRequest
import com.prismq.app.data.model.CreateExamResponse
import com.prismq.app.data.model.DashboardResponse
import com.prismq.app.data.model.ExamAnalyticsResponse
import com.prismq.app.data.model.ExamAssemblyPreviewRequest
import com.prismq.app.data.model.ExamAssemblyPreviewResponse
import com.prismq.app.data.model.ExamHeartbeatRequest
import com.prismq.app.data.model.ExamHeartbeatResponse
import com.prismq.app.data.model.ExamJoinResponse
import com.prismq.app.data.model.ExamStartRequest
import com.prismq.app.data.model.ExamStartResponse
import com.prismq.app.data.model.ExamSubmissionDetailResponse
import com.prismq.app.data.model.ExamSubmitRequest
import com.prismq.app.data.model.ExamSubmitResponse
import com.prismq.app.data.model.ExamTerminateResponse
import com.prismq.app.data.model.ExamsListResponse
import com.prismq.app.data.model.HealthResponse
import com.prismq.app.data.model.HeartbeatRequest
import com.prismq.app.data.model.HeartbeatResponse
import com.prismq.app.data.model.IdResponse
import com.prismq.app.data.model.ImportExtractResponse
import com.prismq.app.data.model.JoinBankShareRequest
import com.prismq.app.data.model.JoinBankShareResponse
import com.prismq.app.data.model.LoginRequest
import com.prismq.app.data.model.MeResponse
import com.prismq.app.data.model.MistakesResponse
import com.prismq.app.data.model.OkResponse
import com.prismq.app.data.model.ParseTextRequest
import com.prismq.app.data.model.ParseTextResponse
import com.prismq.app.data.model.PracticeSessionResponse
import com.prismq.app.data.model.RegisterRequest
import com.prismq.app.data.model.ResetPracticeProgressRequest
import com.prismq.app.data.model.ResetPracticeProgressResponse
import com.prismq.app.data.model.SaveNoteRequest
import com.prismq.app.data.model.SavePracticeProgressRequest
import com.prismq.app.data.model.SearchResponse
import com.prismq.app.data.model.ShareQrInfoResponse
import com.prismq.app.data.model.SharedBankPreviewResponse
import com.prismq.app.data.model.SubmitPracticeAnswerRequest
import com.prismq.app.data.model.SubmitPracticeAnswerResponse
import com.prismq.app.data.model.SystemPolicyDto
import com.prismq.app.data.model.ToggleQuestionRequest
import com.prismq.app.data.model.ToggleQuestionResponse
import com.prismq.app.data.model.UpdateAdminAiConfigRequest
import com.prismq.app.data.model.UpdateBankShareRequest
import com.prismq.app.data.model.UpdateBankVisibilityRequest
import com.prismq.app.data.model.UpdateSettingsRequest
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface KaoshibaoApi {

    @GET("api/health")
    suspend fun health(): HealthResponse

    /* -------------------- Auth, Settings & Heartbeat -------------------- */

    @GET("api/auth/bootstrap-status")
    suspend fun bootstrapStatus(): BootstrapStatusResponse

    @POST("api/auth/register")
    suspend fun register(@Body body: RegisterRequest): AuthResponse

    @POST("api/auth/login")
    suspend fun login(@Body body: LoginRequest): AuthResponse

    @GET("api/auth/me")
    suspend fun me(): MeResponse

    @PUT("api/auth/settings")
    suspend fun updateSettings(@Body body: UpdateSettingsRequest): MeResponse

    @PUT("api/auth/password")
    suspend fun changePassword(@Body body: ChangePasswordRequest): OkResponse

    @POST("api/auth/heartbeat")
    suspend fun heartbeat(@Body body: HeartbeatRequest): HeartbeatResponse

    @GET("api/auth/admin/ai-config")
    suspend fun getAdminAiConfig(): AdminAiConfigResponse

    @PUT("api/auth/admin/ai-config")
    suspend fun updateAdminAiConfig(@Body body: UpdateAdminAiConfigRequest): AdminAiConfigResponse

    /* -------------------- Banks, Private Share & Questions -------------------- */

    @GET("api/banks")
    suspend fun listBanks(
        @Query("scope") scope: String = "mine",
        @Query("q") q: String? = null
    ): BanksListResponse

    @GET("api/banks/share/{code}")
    suspend fun previewSharedBank(@Path("code") shareCode: String): SharedBankPreviewResponse

    @POST("api/banks/share/join")
    suspend fun joinSharedBank(@Body body: JoinBankShareRequest): JoinBankShareResponse

    @POST("api/banks")
    suspend fun createBank(@Body body: CreateBankRequest): IdResponse

    @GET("api/banks/{id}")
    suspend fun getBankDetail(
        @Path("id") id: String,
        @Query("chapterId") chapterId: String? = null,
        @Query("type") type: String? = null,
        @Query("difficultyTier") difficultyTier: String? = null,
        @Query("minStar") minStar: Int? = null,
        @Query("q") q: String? = null
    ): BankDetailResponse

    @PUT("api/banks/{id}")
    suspend fun updateBankVisibility(
        @Path("id") id: String,
        @Body body: UpdateBankVisibilityRequest
    ): OkResponse

    @DELETE("api/banks/{id}")
    suspend fun deleteBank(@Path("id") id: String): OkResponse

    @POST("api/banks/{id}/clone")
    suspend fun cloneBank(@Path("id") id: String): IdResponse

    @POST("api/banks/{id}/questions/batch")
    suspend fun batchImportQuestions(
        @Path("id") bankId: String,
        @Body body: BatchImportRequest
    ): BatchImportResponse

    @GET("api/banks/{id}/shares")
    suspend fun getBankShareSettings(@Path("id") id: String): BankShareSettings

    @PUT("api/banks/{id}/share-settings")
    suspend fun updateBankShareSettings(
        @Path("id") id: String,
        @Body body: UpdateBankShareRequest
    ): BankShareSettings

    @POST("api/banks/{id}/shares")
    suspend fun addBankShareMember(
        @Path("id") id: String,
        @Body body: AddBankShareMemberRequest
    ): BankShareMembersResponse

    @DELETE("api/banks/{id}/shares/{targetUserId}")
    suspend fun removeBankShareMember(
        @Path("id") id: String,
        @Path("targetUserId") targetUserId: String
    ): BankShareMembersResponse

    @GET("api/banks/{id}/share-qrcode")
    suspend fun getBankShareQr(@Path("id") id: String): ShareQrInfoResponse

    @POST("api/banks/{id}/format-code")
    suspend fun formatBankCode(@Path("id") id: String): BankFormatCodeResponse

    /* -------------------- Practice, Mistakes & Search -------------------- */

    @GET("api/practice/dashboard")
    suspend fun getDashboard(): DashboardResponse

    @GET("api/practice/session")
    suspend fun getPracticeSession(
        @Query("bankId") bankId: String,
        @Query("mode") mode: String = "sequential",
        @Query("sortBy") sortBy: String? = null,
        @Query("shuffleQuestions") shuffleQuestions: Boolean? = null,
        @Query("chapterId") chapterId: String? = null,
        @Query("type") type: String? = null,
        @Query("difficultyTier") difficultyTier: String? = null,
        @Query("minStar") minStar: Int? = null,
        @Query("excludeMastered") excludeMastered: Boolean? = null,
        @Query("onlyUnanswered") onlyUnanswered: Boolean? = null
    ): PracticeSessionResponse

    @PUT("api/practice/progress")
    suspend fun savePracticeProgress(@Body body: SavePracticeProgressRequest): OkResponse

    @POST("api/practice/reset")
    suspend fun resetPracticeProgress(@Body body: ResetPracticeProgressRequest): ResetPracticeProgressResponse

    @POST("api/practice/answer")
    suspend fun submitPracticeAnswer(@Body body: SubmitPracticeAnswerRequest): SubmitPracticeAnswerResponse

    @POST("api/practice/toggle")
    suspend fun toggleQuestionState(@Body body: ToggleQuestionRequest): ToggleQuestionResponse

    @PUT("api/practice/note")
    suspend fun saveNote(@Body body: SaveNoteRequest): OkResponse

    @DELETE("api/practice/mistakes/{questionId}")
    suspend fun removeFromMistakeBook(@Path("questionId") questionId: String): OkResponse

    @GET("api/practice/mistakes")
    suspend fun listMistakes(
        @Query("tab") tab: String = "mistakes",
        @Query("q") q: String? = null
    ): MistakesResponse

    @GET("api/practice/search")
    suspend fun searchQuestions(
        @Query("q") q: String,
        @Query("bankId") bankId: String? = null
    ): SearchResponse

    /* -------------------- Import -------------------- */

    @Multipart
    @POST("api/import/extract-raw")
    suspend fun extractRawFile(
        @Part file: MultipartBody.Part,
        @Part("defaultChapter") defaultChapter: RequestBody,
        @Part("bankId") bankId: RequestBody
    ): ImportExtractResponse

    @POST("api/import/parse-text")
    suspend fun parseText(@Body body: ParseTextRequest): ParseTextResponse

    /* -------------------- Exams & Dynamic Assembly -------------------- */

    @GET("api/exams")
    suspend fun listExams(): ExamsListResponse

    @POST("api/exams/preview-assembly")
    suspend fun previewExamAssembly(@Body body: ExamAssemblyPreviewRequest): ExamAssemblyPreviewResponse

    @POST("api/exams")
    suspend fun createExam(@Body body: CreateExamRequest): CreateExamResponse

    @GET("api/exams/{id}/analytics")
    suspend fun getExamAnalytics(@Path("id") examId: String): ExamAnalyticsResponse

    @POST("api/exams/{id}/terminate")
    suspend fun terminateExam(@Path("id") examId: String): ExamTerminateResponse

    @GET("api/exams/{id}/qrcode")
    suspend fun getExamShareQr(@Path("id") examId: String): ShareQrInfoResponse

    @GET("api/exams/join/{shareCode}")
    suspend fun joinExam(
        @Path("shareCode") shareCode: String,
        @Query("password") password: String? = null
    ): ExamJoinResponse

    @POST("api/exams/join/{shareCode}/start")
    suspend fun startExamSession(
        @Path("shareCode") shareCode: String,
        @Body body: ExamStartRequest
    ): ExamStartResponse

    @POST("api/exams/join/{shareCode}/heartbeat")
    suspend fun heartbeatExamSession(
        @Path("shareCode") shareCode: String,
        @Body body: ExamHeartbeatRequest
    ): ExamHeartbeatResponse

    @POST("api/exams/join/{shareCode}/submit")
    suspend fun submitExam(
        @Path("shareCode") shareCode: String,
        @Body body: ExamSubmitRequest
    ): ExamSubmitResponse

    @GET("api/exams/submissions/{submissionId}")
    suspend fun getSubmissionDetail(@Path("submissionId") submissionId: String): ExamSubmissionDetailResponse

    /* -------------------- AI Explain, Rating & Background Jobs -------------------- */

    @POST("api/ai/explain")
    suspend fun explainQuestion(@Body body: AiExplainRequest): AiExplainResponse

    @POST("api/ai/test")
    suspend fun testAiConnection(@Body body: AiTestRequest): AiTestResponse

    @POST("api/ai/rate-bank")
    suspend fun rateBankQuestions(@Body body: AiRateBankRequest): AiRateBankResponse

    @Multipart
    @POST("api/ai/jobs")
    suspend fun createAiFileJob(
        @Part file: MultipartBody.Part,
        @Part("defaultChapter") defaultChapter: RequestBody,
        @Part("targetBankId") targetBankId: RequestBody,
        @Part("newBankTitle") newBankTitle: RequestBody,
        @Part("autoImport") autoImport: RequestBody
    ): AiJobSingleResponse

    @POST("api/ai/jobs")
    suspend fun createAiTextJob(@Body body: CreateAiJobTextRequest): AiJobSingleResponse

    @GET("api/ai/jobs")
    suspend fun listAiJobs(@Query("limit") limit: Int = 25): AiJobsListResponse

    @POST("api/ai/jobs/{id}/cancel")
    suspend fun cancelAiJob(@Path("id") id: String): AiJobSingleResponse

    @POST("api/ai/jobs/{id}/retry")
    suspend fun retryAiJob(@Path("id") id: String): AiJobSingleResponse

    @DELETE("api/ai/jobs/{id}")
    suspend fun deleteAiJob(@Path("id") id: String): OkResponse

    /* -------------------- System Admin Console -------------------- */

    @GET("api/admin/overview")
    suspend fun getAdminOverview(): AdminOverviewResponse

    @GET("api/admin/users")
    suspend fun listAdminUsers(
        @Query("q") q: String? = null,
        @Query("role") role: String? = null,
        @Query("status") status: String? = null,
        @Query("sort") sort: String = "usage_desc"
    ): AdminUsersListResponse

    @POST("api/admin/users")
    suspend fun createAdminUser(@Body body: AdminCreateUserRequest): OkResponse

    @PUT("api/admin/users/{id}")
    suspend fun updateAdminUser(
        @Path("id") id: String,
        @Body body: AdminUpdateUserRequest
    ): OkResponse

    @POST("api/admin/users/{id}/reset-password")
    suspend fun resetAdminUserPassword(
        @Path("id") id: String,
        @Body body: AdminResetPasswordRequest
    ): OkResponse

    @DELETE("api/admin/users/{id}")
    suspend fun deleteAdminUser(@Path("id") id: String): OkResponse

    @GET("api/admin/usage")
    suspend fun getAdminUsage(
        @Query("days") days: String = "7",
        @Query("userId") userId: String? = null,
        @Query("q") q: String? = null
    ): AdminUsageResponse

    @GET("api/admin/banks")
    suspend fun listAdminBanks(
        @Query("q") q: String? = null,
        @Query("visibility") visibility: String? = null
    ): AdminBanksResponse

    @PUT("api/admin/banks/{id}")
    suspend fun updateAdminBank(
        @Path("id") id: String,
        @Body body: AdminUpdateBankRequest
    ): OkResponse

    @DELETE("api/admin/banks/{id}")
    suspend fun deleteAdminBank(@Path("id") id: String): OkResponse

    @GET("api/admin/exams")
    suspend fun listAdminExams(): AdminExamsResponse

    @PUT("api/admin/exams/{id}")
    suspend fun updateAdminExam(
        @Path("id") id: String,
        @Body body: AdminUpdateExamRequest
    ): OkResponse

    @DELETE("api/admin/exams/{id}")
    suspend fun deleteAdminExam(@Path("id") id: String): OkResponse

    @GET("api/admin/ai-jobs")
    suspend fun listAdminAiJobs(): AdminAiJobsResponse

    @DELETE("api/admin/ai-jobs/{id}")
    suspend fun deleteAdminAiJob(@Path("id") id: String): OkResponse

    @PUT("api/admin/policy")
    suspend fun updateAdminPolicy(@Body body: SystemPolicyDto): AdminPolicyResponse

    @GET("api/admin/audit-logs")
    suspend fun getAdminAuditLogs(@Query("limit") limit: Int = 80): AdminAuditLogsResponse

    /* -------------------- App Update Push -------------------- */

    @GET("api/app-update/latest")
    suspend fun getLatestAppUpdate(
        @Query("currentVersion") currentVersion: String,
        @Query("currentVersionCode") currentVersionCode: Int
    ): com.prismq.app.data.model.AppUpdateCheckResponse

    @POST("api/app-update/admin/sync")
    suspend fun syncAdminAppUpdate(): com.prismq.app.data.model.AppUpdateSyncResponse
}
