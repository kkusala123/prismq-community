package com.prismq.app.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.prismq.app.data.model.AiExplainRequest
import com.prismq.app.data.model.AiExplainResponse
import com.prismq.app.data.model.ExamSubmissionDetailResponse
import kotlinx.coroutines.launch
import com.prismq.app.data.model.difficultyLabel
import com.prismq.app.data.model.formatDurationSeconds
import com.prismq.app.data.model.questionTypeLabel
import com.prismq.app.data.remote.ApiClient
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.components.FormattedContentText
import com.prismq.app.ui.components.KsbBadge
import com.prismq.app.ui.components.KsbBanner
import com.prismq.app.ui.components.KsbCard
import com.prismq.app.ui.components.KsbLoadingView
import com.prismq.app.ui.theme.KsbTheme

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ExamReportScreen(
    submissionId: String,
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<ExamSubmissionDetailResponse?>(null) }
    var onlyWrong by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    val aiResults = remember { mutableStateMapOf<String, AiExplainResponse>() }
    val aiLoadingMap = remember { mutableStateMapOf<String, Boolean>() }
    val aiErrors = remember { mutableStateMapOf<String, String>() }

    LaunchedEffect(submissionId) {
        loading = true
        errorMsg = null
        try {
            detail = viewModel.api().getSubmissionDetail(submissionId)
        } catch (e: Exception) {
            errorMsg = ApiClient.parseError(e)
        } finally {
            loading = false
        }
    }

    Scaffold(
        containerColor = palette.canvas,
        topBar = {
            TopAppBar(
                title = { Text("成绩与逐题报告", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = palette.textPrimary)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.card)
            )
        }
    ) { innerPad ->
        when {
            loading -> Box(modifier = Modifier.padding(innerPad)) { KsbLoadingView("正在载入成绩报告...") }
            errorMsg != null -> Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(innerPad)
                    .padding(16.dp)
            ) {
                KsbBanner(text = errorMsg ?: "", isError = true)
            }
            else -> {
                val rep = detail ?: return@Scaffold
                val sub = rep.submission
                val displayQuestions = if (onlyWrong) {
                    rep.questions.filter { q -> sub.gradingDetail[q.questionId]?.isCorrect != true }
                } else rep.questions

                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPad),
                    contentPadding = PaddingValues(14.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    item {
                        KsbCard(
                            containerColor = if (sub.isPassed) palette.successBg else palette.errorBg,
                            borderColor = if (sub.isPassed) palette.success.copy(alpha = 0.4f) else palette.error.copy(alpha = 0.4f)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(
                                        text = sub.examTitle ?: "考试成绩报告",
                                        fontSize = 16.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = palette.textPrimary
                                    )
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = "考生：${sub.participantName.ifBlank { "考生" }} · 答对 ${sub.correctCount}/${sub.totalQuestions} 题",
                                        fontSize = 12.sp,
                                        color = palette.textSecondary
                                    )
                                }
                                Column(horizontalAlignment = Alignment.End) {
                                    Text(
                                        text = "${sub.score.toInt()} 分",
                                        fontSize = 26.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        color = if (sub.isPassed) palette.success else palette.error
                                    )
                                    KsbBadge(
                                        text = if (sub.isPassed) "及格通过" else "暂未及格",
                                        containerColor = palette.card,
                                        contentColor = if (sub.isPassed) palette.success else palette.error
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(8.dp))
                            val accPct = sub.accuracy ?: if (sub.totalQuestions > 0) (sub.correctCount * 100.0 / sub.totalQuestions) else 0.0
                            Text(
                                text = "正确率 ${String.format("%.1f", accPct)}% · 耗时 ${formatDurationSeconds(sub.durationSeconds.toLong())} · 异常 ${sub.tabSwitchCount} 次${if (sub.terminatedByCreator) " · 发起者统一收卷" else ""}",
                                fontSize = 11.sp,
                                color = palette.textSecondary
                            )
                            if (sub.riskFlags.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "风控标记：${sub.riskFlags.joinToString(" / ")}",
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = palette.error
                                )
                            }
                        }
                    }

                    item {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(
                                selected = !onlyWrong,
                                onClick = { onlyWrong = false },
                                label = { Text("全部题目 (${rep.questions.size})", fontSize = 12.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = palette.brandSoft,
                                    selectedLabelColor = palette.brandDark
                                )
                            )
                            FilterChip(
                                selected = onlyWrong,
                                onClick = { onlyWrong = true },
                                label = { Text("只看错题", fontSize = 12.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = palette.errorBg,
                                    selectedLabelColor = palette.error
                                )
                            )
                        }
                    }

                    itemsIndexed(displayQuestions, key = { idx, q -> "${q.questionId}_$idx" }) { idx, q ->
                        val g = sub.gradingDetail[q.questionId]
                        val isCorrect = g?.isCorrect == true
                        KsbCard(
                            borderColor = if (isCorrect) palette.border else palette.error.copy(alpha = 0.45f),
                            contentPadding = PaddingValues(14.dp)
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    KsbBadge(text = "第 ${idx + 1} 题 · ${questionTypeLabel(q.type)}")
                                    q.difficulty?.let { diff ->
                                        KsbBadge(
                                            text = difficultyLabel(diff),
                                            containerColor = palette.cardElevated,
                                            contentColor = palette.textSecondary
                                        )
                                    }
                                    if ((q.starRating ?: 0) > 0) {
                                        KsbBadge(
                                            text = "${q.starRating}★",
                                            containerColor = palette.warningBg,
                                            contentColor = palette.warning
                                        )
                                    }
                                }
                                KsbBadge(
                                    text = "${g?.earnedScore?.toInt() ?: 0} / ${g?.maxScore?.toInt() ?: q.score.toInt()} 分",
                                    containerColor = if (isCorrect) palette.successBg else palette.errorBg,
                                    contentColor = if (isCorrect) palette.success else palette.error
                                )
                            }

                            Spacer(modifier = Modifier.height(8.dp))
                            FormattedContentText(
                                text = q.stem,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Medium,
                                color = palette.textPrimary,
                                lineHeight = 20.sp
                            )

                            if (q.options.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(8.dp))
                                q.options.forEach { opt ->
                                    val stdAns = (g?.correctAnswer ?: q.answer ?: "").uppercase()
                                    val usrAns = (g?.userAnswer ?: "").uppercase()
                                    val isStd = stdAns.contains(opt.key.uppercase())
                                    val isUsr = usrAns.contains(opt.key.uppercase())
                                    val optBg = when {
                                        isStd -> palette.successBg
                                        isUsr && !isCorrect -> palette.errorBg
                                        else -> palette.cardElevated
                                    }
                                    val optColor = when {
                                        isStd -> palette.success
                                        isUsr && !isCorrect -> palette.error
                                        else -> palette.textSecondary
                                    }
                                    Surface(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(vertical = 2.dp),
                                        shape = RoundedCornerShape(8.dp),
                                        color = optBg,
                                        border = BorderStroke(1.dp, palette.border)
                                    ) {
                                        FormattedContentText(
                                            text = "${opt.key}. ${opt.content}",
                                            fontSize = 12.sp,
                                            lineHeight = 18.sp,
                                            color = optColor,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                                        )
                                    }
                                }
                            }

                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                Text(
                                    text = "你的作答：${g?.userAnswer?.ifBlank { "未作答" } ?: "未作答"}",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = if (isCorrect) palette.success else palette.error
                                )
                                Text(
                                    text = "标准答案：${g?.correctAnswer?.ifBlank { q.answer ?: "无" } ?: q.answer ?: "无"}",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.SemiBold,
                                    color = palette.success
                                )
                            }

                            val exp = g?.explanation?.takeIf { it.isNotBlank() } ?: q.explanation.orEmpty()
                            if (exp.isNotBlank()) {
                                Spacer(modifier = Modifier.height(6.dp))
                                FormattedContentText(
                                    text = "解析：$exp",
                                    fontSize = 12.sp,
                                    color = palette.textSecondary,
                                    lineHeight = 18.sp
                                )
                            }
                            if (!g?.comment.isNullOrBlank()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "评语：${g?.comment}",
                                    fontSize = 12.sp,
                                    color = palette.brandDark
                                )
                            }

                            val qKey = q.questionId.ifBlank { "idx_$idx" }
                            val isAiLoading = aiLoadingMap[qKey] == true
                            val aiRes = aiResults[qKey]
                            val aiErr = aiErrors[qKey]

                            Spacer(modifier = Modifier.height(8.dp))
                            OutlinedButton(
                                onClick = {
                                    aiLoadingMap[qKey] = true
                                    aiErrors.remove(qKey)
                                    scope.launch {
                                        try {
                                            val res = viewModel.api().explainQuestion(
                                                AiExplainRequest(
                                                    questionId = q.questionId.takeIf { it.isNotBlank() },
                                                    userAnswer = g?.userAnswer?.takeIf { it.isNotBlank() },
                                                    saveToQuestion = false,
                                                    type = q.type,
                                                    stem = q.stem,
                                                    options = q.options,
                                                    answer = g?.correctAnswer?.takeIf { it.isNotBlank() } ?: q.answer,
                                                    explanation = exp.ifBlank { null }
                                                )
                                            )
                                            aiResults[qKey] = res
                                        } catch (e: Exception) {
                                            aiErrors[qKey] = ApiClient.parseError(e)
                                        } finally {
                                            aiLoadingMap[qKey] = false
                                        }
                                    }
                                },
                                enabled = !isAiLoading,
                                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                                shape = RoundedCornerShape(10.dp),
                                border = BorderStroke(1.dp, palette.brand.copy(alpha = 0.45f)),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = palette.brand)
                            ) {
                                if (isAiLoading) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(14.dp),
                                        strokeWidth = 2.dp,
                                        color = palette.brand
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text("AI 正在生成解析...", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                } else {
                                    Icon(
                                        Icons.Default.AutoAwesome,
                                        contentDescription = null,
                                        modifier = Modifier.size(14.dp),
                                        tint = palette.brand
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        if (aiRes != null) "重新 AI 一键解析" else "AI 一键解析",
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                }
                            }

                            if (!aiErr.isNullOrBlank()) {
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = aiErr,
                                    fontSize = 12.sp,
                                    color = palette.error
                                )
                            }

                            if (aiRes != null) {
                                Spacer(modifier = Modifier.height(8.dp))
                                Surface(
                                    modifier = Modifier.fillMaxWidth(),
                                    shape = RoundedCornerShape(10.dp),
                                    color = palette.brandSoft,
                                    border = BorderStroke(1.dp, palette.brand.copy(alpha = 0.28f))
                                ) {
                                    Column(
                                        modifier = Modifier.padding(10.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        Text(
                                            text = "AI 深度解析",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = palette.brandDark
                                        )
                                        if (aiRes.keyPoint.isNotBlank()) {
                                            Text(
                                                text = "核心考点：${aiRes.keyPoint}",
                                                fontSize = 12.sp,
                                                color = palette.textPrimary
                                            )
                                        }
                                        if (aiRes.analysis.isNotBlank()) {
                                            FormattedContentText(
                                                text = aiRes.analysis,
                                                fontSize = 12.sp,
                                                lineHeight = 18.sp,
                                                color = palette.textSecondary
                                            )
                                        }
                                        if (aiRes.mnemonic.isNotBlank()) {
                                            Text(
                                                text = "记忆口诀：${aiRes.mnemonic}",
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.Medium,
                                                color = palette.brandDark
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
