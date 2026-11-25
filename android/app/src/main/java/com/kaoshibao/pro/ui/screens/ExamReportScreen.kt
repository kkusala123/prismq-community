package com.kaoshibao.pro.ui.screens

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kaoshibao.pro.data.model.ExamSubmissionDetailResponse
import com.kaoshibao.pro.data.model.difficultyLabel
import com.kaoshibao.pro.data.model.formatDurationSeconds
import com.kaoshibao.pro.data.model.questionTypeLabel
import com.kaoshibao.pro.data.remote.ApiClient
import com.kaoshibao.pro.ui.MainViewModel
import com.kaoshibao.pro.ui.components.KsbBadge
import com.kaoshibao.pro.ui.components.KsbBanner
import com.kaoshibao.pro.ui.components.KsbCard
import com.kaoshibao.pro.ui.components.KsbLoadingView
import com.kaoshibao.pro.ui.theme.KsbTheme

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ExamReportScreen(
    submissionId: String,
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = KsbTheme.colors
    var detail by remember { mutableStateOf<ExamSubmissionDetailResponse?>(null) }
    var onlyWrong by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

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
                            Text(
                                text = "耗时 ${formatDurationSeconds(sub.durationSeconds.toLong())} · 切屏 ${sub.tabSwitchCount} 次",
                                fontSize = 11.sp,
                                color = palette.textSecondary
                            )
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
                            Text(
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
                                        Text(
                                            text = "${opt.key}. ${opt.content}",
                                            fontSize = 12.sp,
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
                                Text(
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
                        }
                    }
                }
            }
        }
    }
}
