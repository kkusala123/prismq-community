package com.kaoshibao.pro

import com.kaoshibao.pro.data.local.AppPreferences
import com.kaoshibao.pro.data.model.AdminOverviewResponse
import com.kaoshibao.pro.data.model.AdminUsageResponse
import com.kaoshibao.pro.data.model.AdminUsersListResponse
import com.kaoshibao.pro.data.model.AiJobsListResponse
import com.kaoshibao.pro.data.model.AiRateBankResponse
import com.kaoshibao.pro.data.model.AuthResponse
import com.kaoshibao.pro.data.model.BankDetailResponse
import com.kaoshibao.pro.data.model.BankShareSettings
import com.kaoshibao.pro.data.model.BootstrapStatusResponse
import com.kaoshibao.pro.data.model.DashboardResponse
import com.kaoshibao.pro.data.model.ExamAssemblyPreviewResponse
import com.kaoshibao.pro.data.model.ExamJoinResponse
import com.kaoshibao.pro.data.model.ExamSubmissionDetailResponse
import com.kaoshibao.pro.data.model.ImportExtractResponse
import com.kaoshibao.pro.data.model.PracticeSessionResponse
import com.kaoshibao.pro.data.model.PublicUser
import com.kaoshibao.pro.data.model.SavePracticeProgressRequest
import com.kaoshibao.pro.data.model.UpdateSettingsRequest
import com.kaoshibao.pro.data.model.assemblyStrategyLabel
import com.kaoshibao.pro.data.model.difficultyLabel
import com.kaoshibao.pro.data.model.difficultyTierLabel
import com.kaoshibao.pro.data.model.displayName
import com.kaoshibao.pro.data.model.formatDurationSeconds
import com.kaoshibao.pro.data.model.sanitizeDisplayName
import com.kaoshibao.pro.data.remote.ApiClient
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ApiModelsTest {

    @Test
    fun customServerUrlNormalizationSupportsHttpAndHttps() {
        assertEquals("http://10.0.2.2:3000", AppPreferences.DEFAULT_SERVER_URL)
        assertEquals(
            "http://192.168.1.50:3000",
            AppPreferences.normalizeServerUrl("http://192.168.1.50:3000/")
        )
        assertEquals(
            "https://prismq.example.com",
            AppPreferences.normalizeServerUrl("prismq.example.com/")
        )
        assertNotNull(ApiClient.getApi())
    }

    @Test
    fun decodesAuthAndDashboardResponses() {
        val authJson = """
            {
              "token": "jwt-token-123",
              "user": {
                "id": "u-1",
                "username": "alice",
                "email": "alice@example.com",
                "nickname": "Alice",
                "role": "admin",
                "settings": { "removeAfterCorrectCount": 3, "autoNextOnCorrect": true },
                "hasPersonalAiKey": false,
                "systemAiAvailable": true,
                "createdAt": "2026-11-24T10:00:00.000Z"
              }
            }
        """.trimIndent()
        val auth = ApiClient.json.decodeFromString<AuthResponse>(authJson)
        assertEquals("jwt-token-123", auth.token)
        assertEquals("admin", auth.user.role)
        assertTrue(auth.user.systemAiAvailable)

        val dashJson = """
            {
              "stats": {
                "myBanksCount": 2,
                "totalAnswered": 40,
                "totalCorrect": 32,
                "accuracy": 80,
                "mistakeCount": 5,
                "masteredCount": 12,
                "favoriteCount": 6
              },
              "recentBanks": [
                {
                  "id": "b-1",
                  "title": "计算机网络",
                  "category": "计算机",
                  "visibility": "private",
                  "lastQuestionIndex": 7,
                  "lastMode": "sequential",
                  "questionCount": 50,
                  "practicedCount": 20
                }
              ],
              "publicBanks": [],
              "activeExams": []
            }
        """.trimIndent()
        val dash = ApiClient.json.decodeFromString<DashboardResponse>(dashJson)
        assertEquals(80, dash.stats.accuracy)
        assertEquals(7, dash.recentBanks.first().lastQuestionIndex)
    }

    @Test
    fun decodesPracticeSessionImportAndExamReportResponses() {
        val sessionJson = """
            {
              "lastProgressIndex": 0,
              "questions": [
                {
                  "id": "q-1",
                  "bankId": "b-1",
                  "chapterTitle": "第一章",
                  "type": "single",
                  "stem": "HTTP 默认端口？",
                  "options": [{"key": "A", "content": "80"}, {"key": "B", "content": "443"}],
                  "answer": "A",
                  "explanation": "HTTP 默认 80 端口",
                  "record": {
                    "answeredCount": 1,
                    "correctCount": 1,
                    "wrongCount": 0,
                    "consecutiveCorrect": 1,
                    "inMistakeBook": false,
                    "isMastered": false,
                    "isFavorited": true,
                    "note": "重点记忆"
                  }
                }
              ]
            }
        """.trimIndent()
        val session = ApiClient.json.decodeFromString<PracticeSessionResponse>(sessionJson)
        assertEquals(1, session.questions.size)
        assertTrue(session.questions.first().record?.isFavorited == true)

        val importJson = """
            {
              "mode": "structured",
              "sourceFormat": "word-paragraph",
              "filename": "test.docx",
              "count": 1,
              "drafts": [
                {
                  "tempId": "d-1",
                  "type": "boolean",
                  "stem": "TCP 面向连接",
                  "options": [{"key":"A","content":"正确"},{"key":"B","content":"错误"}],
                  "answer": "A",
                  "explanation": "",
                  "chapterTitle": "网络基础",
                  "difficulty": 1,
                  "tags": [],
                  "errors": [],
                  "warnings": []
                }
              ],
              "summary": {"total": 1, "validCount": 1, "errorCount": 0, "warningCount": 0, "duplicateCount": 0},
              "canonicalText": ""
            }
        """.trimIndent()
        val imp = ApiClient.json.decodeFromString<ImportExtractResponse>(importJson)
        assertEquals("word-paragraph", imp.sourceFormat)
        assertEquals(1, imp.summary.validCount)

        val examJoinJson = """
            {
              "requiresPassword": false,
              "requiresLogin": false,
              "exam": {
                "id": "e-1",
                "title": "期中测试",
                "shareCode": "ABCD1234",
                "durationMinutes": 45,
                "totalScore": 100,
                "passScore": 60,
                "status": "active",
                "questionCount": 1
              },
              "questions": [
                {
                  "questionId": "q-1",
                  "type": "single",
                  "stem": "测试题",
                  "options": [{"key": "A", "content": "选项1"}],
                  "score": 100
                }
              ]
            }
        """.trimIndent()
        val join = ApiClient.json.decodeFromString<ExamJoinResponse>(examJoinJson)
        assertFalse(join.requiresPassword)
        assertEquals(100.0, join.questions.first().score, 0.01)

        val reportJson = """
            {
              "submission": {
                "id": "s-1",
                "examId": "e-1",
                "examTitle": "期中测试",
                "participantName": "Alice",
                "score": 100,
                "isPassed": true,
                "correctCount": 1,
                "totalQuestions": 1,
                "durationSeconds": 35,
                "tabSwitchCount": 0,
                "gradingDetail": {
                  "q-1": {
                    "isCorrect": true,
                    "earnedScore": 100,
                    "maxScore": 100,
                    "userAnswer": "A",
                    "correctAnswer": "A",
                    "explanation": "解析"
                  }
                }
              },
              "questions": [
                {
                  "questionId": "q-1",
                  "type": "single",
                  "stem": "测试题",
                  "options": [{"key": "A", "content": "选项1"}],
                  "answer": "A",
                  "explanation": "解析",
                  "score": 100
                }
              ]
            }
        """.trimIndent()
        val report = ApiClient.json.decodeFromString<ExamSubmissionDetailResponse>(reportJson)
        assertNotNull(report.submission.gradingDetail["q-1"])
        assertTrue(report.submission.isPassed)
    }

    @Test
    fun decodesV2RatingSharingAssemblyJobsAndAdminPayloads() {
        val bootstrap = ApiClient.json.decodeFromString<BootstrapStatusResponse>(
            """{"needsSetup":false,"allowRegistration":false}"""
        )
        assertFalse(bootstrap.needsSetup)
        assertFalse(bootstrap.allowRegistration)

        val bankDetailJson = """
            {
              "bank": {
                "id": "b-1",
                "title": "Java 高级题库",
                "visibility": "private",
                "canEdit": true,
                "shareEnabled": true,
                "shareCode": "JAVA8899",
                "hasSharePassword": true
              },
              "chapters": [],
              "questions": [
                {
                  "id": "q-10",
                  "bankId": "b-1",
                  "type": "single",
                  "stem": "JVM 垃圾回收分代模型",
                  "options": [{"key":"A","content":"新生代与老年代"}],
                  "answer": "A",
                  "difficulty": 4,
                  "starRating": 5,
                  "ratingReason": "核心高频底层考点"
                }
              ],
              "stats": {
                "totalCount": 123,
                "ratedCount": 80,
                "avgDifficulty": 2.65,
                "avgStarRating": 3.85,
                "typeCounts": {"single": 90, "multiple": 20, "boolean": 13},
                "difficultyCounts": {"easy": 45, "medium": 58, "hard": 20}
              }
            }
        """.trimIndent()
        val detail = ApiClient.json.decodeFromString<BankDetailResponse>(bankDetailJson)
        assertTrue(detail.bank.shareEnabled)
        assertEquals("JAVA8899", detail.bank.shareCode)
        assertEquals(5, detail.questions.first().starRating)
        assertEquals(123, detail.stats?.totalCount)
        assertEquals(20, detail.stats?.difficultyCounts?.hard)

        val shareSettings = ApiClient.json.decodeFromString<BankShareSettings>(
            """
            {
              "bankId": "b-1",
              "shareEnabled": true,
              "shareCode": "JAVA8899",
              "hasSharePassword": true,
              "members": [
                {"userId":"u-2","username":"bob","nickname":"Bob","via":"direct","createdAt":"2026-11-24"}
              ]
            }
            """.trimIndent()
        )
        assertEquals(1, shareSettings.members.size)
        assertEquals("bob", shareSettings.members.first().username)

        val rateResp = ApiClient.json.decodeFromString<AiRateBankResponse>(
            """
            {
              "ratedCount": 20,
              "processedCount": 20,
              "remainingUnrated": 103,
              "modelUsed": "deepseek-chat",
              "results": [{"id":"q-10","difficulty":4,"starRating":5,"reason":"核心高频"}]
            }
            """.trimIndent()
        )
        assertEquals(20, rateResp.ratedCount)
        assertEquals(103, rateResp.remainingUnrated)

        val jobsResp = ApiClient.json.decodeFromString<AiJobsListResponse>(
            """
            {
              "activeCount": 1,
              "jobs": [
                {
                  "id": "job-1",
                  "status": "running",
                  "sourceFilename": "java.docx",
                  "progressPct": 55,
                  "currentChunk": 2,
                  "totalChunks": 4,
                  "autoImport": true
                }
              ]
            }
            """.trimIndent()
        )
        assertEquals(1, jobsResp.activeCount)
        assertEquals(55, jobsResp.jobs.first().progressPct)

        val previewResp = ApiClient.json.decodeFromString<ExamAssemblyPreviewResponse>(
            """
            {
              "poolStats": {
                "total": 123,
                "typeCounts": {"single": 90},
                "difficultyCounts": {"easy": 45, "medium": 58, "hard": 20},
                "ratedCount": 80
              },
              "projected": {
                "totalPicked": 20,
                "typeBreakdown": {"single": 20},
                "meta": {
                  "strategy": "balanced",
                  "minStarRating": 3,
                  "actualDistribution": {
                    "easy": 6,
                    "medium": 10,
                    "hard": 4,
                    "avgDifficulty": 2.8,
                    "avgStarRating": 4.1,
                    "ratedCount": 20
                  }
                }
              },
              "warnings": []
            }
            """.trimIndent()
        )
        assertEquals(20, previewResp.projected.totalPicked)
        assertEquals(4, previewResp.projected.meta.actualDistribution.hard)

        val adminOverview = ApiClient.json.decodeFromString<AdminOverviewResponse>(
            """
            {
              "dbEngine": "postgres",
              "policy": {"allowRegistration": false},
              "users": {"total": 25, "admins": 2, "disabled": 1, "todayActive": 8, "last7dActive": 19},
              "content": {"totalBanks": 14, "publicBanks": 3, "privateBanks": 11, "totalQuestions": 980, "ratedQuestions": 640},
              "learning": {"totalAnswered": 3200, "totalCorrect": 2680, "accuracyPercent": 84},
              "exams": {"totalExams": 9, "activeExams": 4, "totalSubmissions": 42},
              "aiJobs": {"total": 12, "running": 1, "failed": 0},
              "usage": {"todaySeconds": 5400, "last7dSeconds": 39600, "totalSeconds": 180000},
              "dailyTrend": [{"date":"2026-11-24","activeUsers":8,"activeSeconds":5400,"practiceSeconds":4200,"examSeconds":1200}]
            }
            """.trimIndent()
        )
        assertEquals("postgres", adminOverview.dbEngine)
        assertFalse(adminOverview.policy.allowRegistration)
        assertEquals(25, adminOverview.users.total)

        val adminUsage = ApiClient.json.decodeFromString<AdminUsageResponse>(
            """
            {
              "days": "7",
              "summary": {"totalSeconds": 39600, "practiceSeconds": 30000, "examSeconds": 9600, "activeUsers": 12, "avgSecondsPerActiveUser": 3300},
              "userRanking": [{"userId":"u-1","username":"alice","nickname":"Alice","activeSeconds":7200,"activeDays":5}],
              "userDaily": [{"date":"2026-11-24","activeSeconds":1800,"heartbeatCount":60}]
            }
            """.trimIndent()
        )
        assertEquals(12, adminUsage.summary.activeUsers)
        assertEquals(7200L, adminUsage.userRanking.first().activeSeconds)

        val adminUsers = ApiClient.json.decodeFromString<AdminUsersListResponse>(
            """{"users":[{"id":"u-1","username":"alice","role":"admin","totalActiveSeconds":7200,"bankCount":4}]}"""
        )
        assertEquals("admin", adminUsers.users.first().role)
    }

    @Test
    fun formatsLabelsAndDurationsCleanly() {
        assertEquals("简单", difficultyLabel(1))
        assertEquals("困难", difficultyLabel(5))
        assertEquals("中等(3)", difficultyTierLabel("medium"))
        assertEquals("难度均衡 (3:5:2)", assemblyStrategyLabel("balanced"))
        assertEquals("0 分钟", formatDurationSeconds(0))
        assertEquals("45 秒", formatDurationSeconds(45))
        assertEquals("15 分钟", formatDurationSeconds(900))
        assertEquals("2 小时 5 分", formatDurationSeconds(7500))
    }

    @Test
    fun omitsNullsOnPartialSettingsAndSanitizesDisplayNames() {
        val partialJson = ApiClient.json.encodeToString(
            UpdateSettingsRequest(autoNextDelayMs = 450, switchAnimationMs = 180)
        )
        assertFalse(partialJson.contains("\"nickname\""))
        assertFalse(partialJson.contains(":null"))
        assertTrue(partialJson.contains("450"))
        assertTrue(partialJson.contains("180"))

        assertEquals("alice", sanitizeDisplayName("null", "alice"))
        assertEquals("bob", sanitizeDisplayName("  ", "bob"))
        assertEquals("charlie", sanitizeDisplayName("UNDEFINED", "charlie"))
        assertEquals("小明", sanitizeDisplayName("小明", "bob"))
        assertEquals("alice", PublicUser(username = "alice", nickname = "null").displayName())
        assertEquals("小明", PublicUser(username = "alice", nickname = "小明").displayName())

        val sess = ApiClient.json.decodeFromString<PracticeSessionResponse>(
            """{"questions":[],"lastProgressIndex":4,"nextUnansweredIndex":2}"""
        )
        assertEquals(4, sess.lastProgressIndex)
        assertEquals(2, sess.nextUnansweredIndex)

        val progJson = ApiClient.json.encodeToString(
            SavePracticeProgressRequest(bankId = "bank-1", currentIndex = 7, mode = "sequential")
        )
        assertTrue(progJson.contains("\"currentIndex\":7"))
    }
}
