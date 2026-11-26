package com.prismq.app.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape
import com.prismq.app.data.model.ExamAnalyticsResponse
import com.prismq.app.data.model.ExamSubmissionItem
import com.prismq.app.data.remote.ApiClient
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.components.KsbBadge
import com.prismq.app.ui.components.KsbBanner
import com.prismq.app.ui.components.KsbCard
import com.prismq.app.ui.components.KsbLoadingView
import com.prismq.app.ui.components.KsbPrimaryButton
import com.prismq.app.ui.theme.KsbTheme
import com.prismq.app.util.QrShareUtil
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val RISK_LABELS = mapOf(
    "emulator" to "虚拟机/模拟器",
    "debugger" to "调试模式",
    "virtual_space" to "多开分身",
    "multi_window" to "分屏/多窗",
    "small_window" to "小窗/悬浮",
    "focus_lost" to "失焦切换",
    "tab_switch" to "切屏离开",
    "devtools" to "DevTools",
    "screenshot" to "截屏"
)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ExamAnalyticsScreen(
    examId: String,
    viewModel: MainViewModel,
    onBack: () -> Unit,
    onOpenSubmissionReport: (submissionId: String) -> Unit
) {
    val palette = KsbTheme.colors
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var data by remember { mutableStateOf<ExamAnalyticsResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var terminating by remember { mutableStateOf(false) }
    var showTerminateConfirm by remember { mutableStateOf(false) }
    var selectedRiskSub by remember { mutableStateOf<ExamSubmissionItem?>(null) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var statusMsg by remember { mutableStateOf<String?>(null) }

    suspend fun fetchAnalytics(silent: Boolean = false) {
        if (!silent && data == null) loading = true
        errorMsg = null
        try {
            data = viewModel.api().getExamAnalytics(examId)
        } catch (e: Exception) {
            errorMsg = ApiClient.parseError(e)
        } finally {
            loading = false
        }
    }

    LaunchedEffect(examId) {
        fetchAnalytics(silent = false)
        while (true) {
            delay(10_000L)
            fetchAnalytics(silent = true)
        }
    }

    Scaffold(
        containerColor = palette.canvas,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.card),
                title = {
                    Text(
                        text = data?.exam?.title ?: "考情与防作弊看板",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.textPrimary,
                        maxLines = 1
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = palette.textPrimary)
                    }
                },
                actions = {
                    val exam = data?.exam
                    if (exam != null) {
                        IconButton(onClick = {
                            scope.launch {
                                try {
                                    val qr = viewModel.api().getExamShareQr(exam.id)
                                    val poster = QrShareUtil.generateSharePosterBitmap(
                                        qrContent = qr.shareUrl,
                                        title = qr.title,
                                        shareCode = qr.shareCode,
                                        subtitle = "扫码或输入分享码参加考试"
                                    )
                                    QrShareUtil.sharePosterToWeChatOrChooser(
                                        context = context,
                                        poster = poster,
                                        shareText = "【PrismQ 棱题考试】${qr.title}\n分享码：${qr.shareCode}\n${qr.shareUrl}",
                                        preferWeChat = true
                                    )
                                } catch (e: Exception) {
                                    errorMsg = ApiClient.parseError(e)
                                }
                            }
                        }) {
                            Icon(Icons.Default.QrCode2, contentDescription = "分享考场二维码", tint = palette.brand)
                        }
                    }
                    IconButton(onClick = { scope.launch { fetchAnalytics(false) } }) {
                        Icon(Icons.Default.Refresh, contentDescription = "刷新", tint = palette.textPrimary)
                    }
                }
            )
        }
    ) { innerPad ->
        if (loading && data == null) {
            Box(modifier = Modifier.padding(innerPad).fillMaxSize()) {
                KsbLoadingView("正在加载考情统计...")
            }
            return@Scaffold
        }

        val analytics = data ?: run {
            Box(modifier = Modifier.padding(innerPad).padding(16.dp)) {
                KsbBanner(text = errorMsg ?: "无法获取考情数据", isError = true)
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (errorMsg != null) item { KsbBanner(text = errorMsg!!, isError = true) }
            if (statusMsg != null) item { KsbBanner(text = statusMsg!!, isError = false) }

            // 考场状态与主动终结操作区
            item {
                KsbCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            KsbBadge(
                                text = if (analytics.exam.status == "active") "考试进行中" else "已终结/关闭",
                                containerColor = if (analytics.exam.status == "active") palette.successBg else palette.errorBg,
                                contentColor = if (analytics.exam.status == "active") palette.success else palette.error
                            )
                            KsbBadge(text = "码 ${analytics.exam.shareCode}")
                        }
                        if (analytics.exam.blockEmulator) {
                            KsbBadge(
                                text = "禁虚拟机",
                                containerColor = palette.errorBg,
                                contentColor = palette.error
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        AnalyticsStatMini("已交卷", "${analytics.summary.submissionCount}人", palette.textPrimary)
                        AnalyticsStatMini("在考中", "${analytics.summary.inProgressCount}人", palette.warning)
                        AnalyticsStatMini("平均分", "${analytics.summary.avgScore}", palette.brand)
                        AnalyticsStatMini("正确率", "${analytics.summary.avgAccuracy}%", palette.success)
                        AnalyticsStatMini("及格率", "${analytics.summary.passRate}%", palette.ai)
                    }
                    if (analytics.exam.status == "active") {
                        Spacer(modifier = Modifier.height(12.dp))
                        KsbPrimaryButton(
                            text = "主动终结考试并统一收卷",
                            loading = terminating,
                            containerColor = palette.error,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { showTerminateConfirm = true }
                        )
                    }
                }
            }

            // 正在考试中的实时监控列表
            if (analytics.activeSessions.isNotEmpty()) {
                item {
                    Text(
                        text = "实时在考监控 (${analytics.activeSessions.size} 人)",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.textPrimary
                    )
                }
                items(analytics.activeSessions, key = { it.id }) { sess ->
                    KsbCard(contentPadding = PaddingValues(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = "${sess.participantName}${if (sess.participantIdentifier.isNotBlank()) " (${sess.participantIdentifier})" else ""}",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = palette.textPrimary
                                )
                                Text(
                                    text = "已作答 ${sess.answeredCount} 题 · 异常 ${sess.tabSwitchCount} 次",
                                    fontSize = 11.sp,
                                    color = if (sess.tabSwitchCount > 0) palette.error else palette.textSecondary
                                )
                            }
                            if (sess.riskFlags.isNotEmpty()) {
                                KsbBadge(
                                    text = sess.riskFlags.joinToString("/") { RISK_LABELS[it] ?: it },
                                    containerColor = palette.errorBg,
                                    contentColor = palette.error
                                )
                            } else {
                                KsbBadge(
                                    text = "环境正常",
                                    containerColor = palette.successBg,
                                    contentColor = palette.success
                                )
                            }
                        }
                    }
                }
            }

            // 成绩排行榜与风控标记
            item {
                Text(
                    text = "成绩排行榜与正确率 (${analytics.submissions.size})",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = palette.textPrimary
                )
            }
            if (analytics.submissions.isEmpty()) {
                item {
                    KsbCard { Text("暂无考生交卷记录", fontSize = 12.sp, color = palette.textSecondary) }
                }
            } else {
                itemsIndexed(analytics.submissions, key = { _, s -> s.id }) { idx, s ->
                    val acc = s.accuracy ?: if (s.totalQuestions > 0) (s.correctCount * 100.0 / s.totalQuestions) else 0.0
                    val hasRisk = s.tabSwitchCount > 0 || s.riskFlags.isNotEmpty()
                    KsbCard(
                        modifier = Modifier.clickable { onOpenSubmissionReport(s.id) },
                        contentPadding = PaddingValues(12.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Text("#${idx + 1}", fontSize = 13.sp, fontWeight = FontWeight.ExtraBold, color = palette.brand)
                                    Text(s.participantName, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                    if (s.terminatedByCreator) {
                                        KsbBadge(text = "统一收卷")
                                    }
                                }
                                Spacer(modifier = Modifier.height(3.dp))
                                Text(
                                    text = "正确率 ${String.format("%.1f", acc)}% · 对 ${s.correctCount}/${s.totalQuestions} · 用时 ${s.durationSeconds}秒",
                                    fontSize = 11.sp,
                                    color = palette.textSecondary
                                )
                                if (hasRisk) {
                                    Spacer(modifier = Modifier.height(4.dp))
                                    FlowRow(
                                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                                        verticalArrangement = Arrangement.spacedBy(4.dp)
                                    ) {
                                        KsbBadge(
                                            text = "违规 ${s.tabSwitchCount} 次",
                                            containerColor = palette.errorBg,
                                            contentColor = palette.error,
                                            modifier = Modifier.clickable { selectedRiskSub = s }
                                        )
                                        s.riskFlags.forEach { flag ->
                                            KsbBadge(
                                                text = RISK_LABELS[flag] ?: flag,
                                                containerColor = palette.errorBg,
                                                contentColor = palette.error
                                            )
                                        }
                                    }
                                }
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(
                                    text = "${s.score} 分",
                                    fontSize = 17.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    color = if (s.isPassed) palette.success else palette.error
                                )
                                KsbBadge(
                                    text = if (s.isPassed) "及格" else "未及格",
                                    containerColor = if (s.isPassed) palette.successBg else palette.errorBg,
                                    contentColor = if (s.isPassed) palette.success else palette.error
                                )
                            }
                        }
                    }
                }
            }

            // 单题正确率统计
            if (analytics.questionStats.isNotEmpty()) {
                item {
                    Text(
                        text = "单题正确率统计（按错题率从高到低）",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.textPrimary
                    )
                }
                items(analytics.questionStats.take(10), key = { it.questionId }) { qs ->
                    KsbCard(contentPadding = PaddingValues(12.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("第 ${qs.index} 题", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                KsbBadge(
                                    text = "正确率 ${qs.correctRate}%",
                                    containerColor = palette.successBg,
                                    contentColor = palette.success
                                )
                                KsbBadge(
                                    text = "错误率 ${qs.errorRate}%",
                                    containerColor = palette.errorBg,
                                    contentColor = palette.error
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                        LinearProgressIndicator(
                            progress = { (qs.correctRate / 100f).coerceIn(0f, 1f) },
                            modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(4.dp)),
                            color = palette.success,
                            trackColor = palette.errorBg
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(qs.stem, fontSize = 12.sp, color = palette.textSecondary, maxLines = 2)
                    }
                }
            }
            if (!loading && errorMsg == null) {
                item {
                    Text(
                        text = "提示：如需修改考场入场口令或为主观简答题人工调分，请使用网页端。",
                        fontSize = 11.sp,
                        color = palette.textMuted,
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
            }
        }
    }

    if (showTerminateConfirm) {
        AlertDialog(
            onDismissRequest = { showTerminateConfirm = false },
            containerColor = palette.card,
            title = { Text("确认主动终结考试", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "终结后考场将立刻关闭，正在答题中的考生会在数秒内按当前最新作答自动交卷评分，确认继续吗？",
                    fontSize = 13.sp,
                    color = palette.textSecondary
                )
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = "立即终结并收卷",
                    loading = terminating,
                    containerColor = palette.error,
                    onClick = {
                        terminating = true
                        scope.launch {
                            try {
                                val res = viewModel.api().terminateExam(examId)
                                showTerminateConfirm = false
                                statusMsg = if (res.terminatedCount > 0) {
                                    "已终结考试，并为 ${res.terminatedCount} 名在线考生自动收卷。"
                                } else {
                                    "已主动终结并关闭该考场。"
                                }
                                fetchAnalytics(false)
                            } catch (e: Exception) {
                                errorMsg = ApiClient.parseError(e)
                            } finally {
                                terminating = false
                            }
                        }
                    }
                )
            },
            dismissButton = {
                TextButton(onClick = { showTerminateConfirm = false }) { Text("取消") }
            }
        )
    }

    selectedRiskSub?.let { sub ->
        AlertDialog(
            onDismissRequest = { selectedRiskSub = null },
            containerColor = palette.card,
            title = { Text("${sub.participantName} · 风控详情", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    sub.deviceInfo?.let { d ->
                        if (d.deviceLabel.isNotBlank()) {
                            Text("设备：${d.deviceLabel}", fontSize = 12.sp, color = palette.textSecondary)
                        }
                    }
                    if (sub.cheatEvents.isEmpty()) {
                        Text("记录到 ${sub.tabSwitchCount} 次异常切换/小窗动作", fontSize = 12.sp)
                    } else {
                        sub.cheatEvents.take(15).forEach { ev ->
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.WarningAmber, contentDescription = null, modifier = Modifier.size(14.dp), tint = palette.error)
                                Text(ev.detail, fontSize = 12.sp, color = palette.error)
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { selectedRiskSub = null }) { Text("知道了") }
            }
        )
    }
}

@Composable
private fun AnalyticsStatMini(label: String, value: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold, color = color)
        Text(label, fontSize = 10.sp, color = KsbTheme.colors.textMuted)
    }
}
