package com.kaoshibao.pro.data.remote

import com.kaoshibao.pro.data.model.AddBankShareMemberRequest
import com.kaoshibao.pro.data.model.AdminAiConfigResponse
import com.kaoshibao.pro.data.model.AdminAiJobsResponse
import com.kaoshibao.pro.data.model.AdminAuditLogsResponse
import com.kaoshibao.pro.data.model.AdminBanksResponse
import com.kaoshibao.pro.data.model.AdminCreateUserRequest
import com.kaoshibao.pro.data.model.AdminExamsResponse
import com.kaoshibao.pro.data.model.AdminOverviewResponse
import com.kaoshibao.pro.data.model.AdminPolicyResponse
import com.kaoshibao.pro.data.model.AdminResetPasswordRequest
import com.kaoshibao.pro.data.model.AdminUpdateBankRequest
import com.kaoshibao.pro.data.model.AdminUpdateExamRequest
import com.kaoshibao.pro.data.model.AdminUpdateUserRequest
import com.kaoshibao.pro.data.model.AdminUsageResponse
import com.kaoshibao.pro.data.model.AdminUsersListResponse
import com.kaoshibao.pro.data.model.AiExplainRequest
import com.kaoshibao.pro.data.model.AiExplainResponse
import com.kaoshibao.pro.data.model.AiJobSingleResponse
import com.kaoshibao.pro.data.model.AiJobsListResponse
import com.kaoshibao.pro.data.model.AiRateBankRequest
import com.kaoshibao.pro.data.model.AiRateBankResponse
import com.kaoshibao.pro.data.model.AiTestRequest
import com.kaoshibao.pro.data.model.AiTestResponse
import com.kaoshibao.pro.data.model.AuthResponse
import com.kaoshibao.pro.data.model.BankDetailResponse
import com.kaoshibao.pro.data.model.BankShareMembersResponse
import com.kaoshibao.pro.data.model.BankShareSettings
import com.kaoshibao.pro.data.model.BanksListResponse
import com.kaoshibao.pro.data.model.BatchImportRequest
import com.kaoshibao.pro.data.model.BatchImportResponse
import com.kaoshibao.pro.data.model.BootstrapStatusResponse
import com.kaoshibao.pro.data.model.ChangePasswordRequest
import com.kaoshibao.pro.data.model.CreateAiJobTextRequest
import com.kaoshibao.pro.data.model.CreateBankRequest
import com.kaoshibao.pro.data.model.CreateExamRequest
import com.kaoshibao.pro.data.model.CreateExamResponse
import com.kaoshibao.pro.data.model.DashboardResponse
import com.kaoshibao.pro.data.model.ExamAssemblyPreviewRequest
import com.kaoshibao.pro.data.model.ExamAssemblyPreviewResponse
import com.kaoshibao.pro.data.model.ExamJoinResponse
import com.kaoshibao.pro.data.model.ExamSubmissionDetailResponse
import com.kaoshibao.pro.data.model.ExamSubmitRequest
import com.kaoshibao.pro.data.model.ExamSubmitResponse
import com.kaoshibao.pro.data.model.ExamsListResponse
import com.kaoshibao.pro.data.model.HealthResponse
import com.kaoshibao.pro.data.model.HeartbeatRequest
import com.kaoshibao.pro.data.model.HeartbeatResponse
import com.kaoshibao.pro.data.model.IdResponse
import com.kaoshibao.pro.data.model.ImportExtractResponse
import com.kaoshibao.pro.data.model.JoinBankShareRequest
import com.kaoshibao.pro.data.model.JoinBankShareResponse
import com.kaoshibao.pro.data.model.LoginRequest
import com.kaoshibao.pro.data.model.MeResponse
import com.kaoshibao.pro.data.model.MistakesResponse
import com.kaoshibao.pro.data.model.OkResponse
import com.kaoshibao.pro.data.model.ParseTextRequest
import com.kaoshibao.pro.data.model.ParseTextResponse
import com.kaoshibao.pro.data.model.PracticeSessionResponse
import com.kaoshibao.pro.data.model.RegisterRequest
import com.kaoshibao.pro.data.model.SaveNoteRequest
import com.kaoshibao.pro.data.model.SavePracticeProgressRequest
import com.kaoshibao.pro.data.model.SearchResponse
import com.kaoshibao.pro.data.model.SharedBankPreviewResponse
import com.kaoshibao.pro.data.model.SubmitPracticeAnswerRequest
import com.kaoshibao.pro.data.model.SubmitPracticeAnswerResponse
import com.kaoshibao.pro.data.model.SystemPolicyDto
import com.kaoshibao.pro.data.model.ToggleQuestionRequest
import com.kaoshibao.pro.data.model.ToggleQuestionResponse
import com.kaoshibao.pro.data.model.UpdateAdminAiConfigRequest
import com.kaoshibao.pro.data.model.UpdateBankShareRequest
import com.kaoshibao.pro.data.model.UpdateBankVisibilityRequest
import com.kaoshibao.pro.data.model.UpdateSettingsRequest
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

    /* -------------------- Practice, Mistakes & Search -------------------- */

    @GET("api/practice/dashboard")
    suspend fun getDashboard(): DashboardResponse

    @GET("api/practice/session")
    suspend fun getPracticeSession(
        @Query("bankId") bankId: String,
        @Query("mode") mode: String = "sequential",
        @Query("chapterId") chapterId: String? = null,
        @Query("type") type: String? = null,
        @Query("difficultyTier") difficultyTier: String? = null,
        @Query("minStar") minStar: Int? = null,
        @Query("excludeMastered") excludeMastered: Boolean? = null,
        @Query("onlyUnanswered") onlyUnanswered: Boolean? = null
    ): PracticeSessionResponse

    @PUT("api/practice/progress")
    suspend fun savePracticeProgress(@Body body: SavePracticeProgressRequest): OkResponse

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

    @GET("api/exams/join/{shareCode}")
    suspend fun joinExam(
        @Path("shareCode") shareCode: String,
        @Query("password") password: String? = null
    ): ExamJoinResponse

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
    ): com.kaoshibao.pro.data.model.AppUpdateCheckResponse

    @POST("api/app-update/admin/sync")
    suspend fun syncAdminAppUpdate(): com.kaoshibao.pro.data.model.AppUpdateSyncResponse
}
