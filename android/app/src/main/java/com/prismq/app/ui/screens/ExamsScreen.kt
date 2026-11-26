package com.prismq.app.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.prismq.app.data.model.CreateExamRequest
import com.prismq.app.data.model.DifficultyRatioDto
import com.prismq.app.data.model.ExamAssemblyPreviewRequest
import com.prismq.app.data.model.ExamAssemblyPreviewResponse
import com.prismq.app.data.model.ExamSubmissionItem
import com.prismq.app.data.model.ExamSummary
import com.prismq.app.data.model.QuestionBankSummary
import com.prismq.app.data.model.ShareQrInfoResponse
import com.prismq.app.data.model.assemblyStrategyLabel
import com.prismq.app.data.remote.ApiClient
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.components.SelfTestBuilderDialog
import com.prismq.app.ui.components.KsbBadge
import com.prismq.app.ui.components.KsbBanner
import com.prismq.app.ui.components.KsbCard
import com.prismq.app.ui.components.KsbEmptyView
import com.prismq.app.ui.components.KsbLoadingView
import com.prismq.app.ui.components.KsbOutlineButton
import com.prismq.app.ui.components.KsbPrimaryButton
import com.prismq.app.ui.components.KsbSegmentedControl
import com.prismq.app.ui.theme.KsbTheme
import com.prismq.app.util.QrShareUtil
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private val ASSEMBLY_STRATEGIES = listOf(
    "balanced" to "难度均衡(3:5:2)",
    "easy_first" to "基础递进(6:3:1)",
    "hard_focus" to "攻坚拔高(1.5:3.5:5)",
    "high_star" to "高星核心精选",
    "custom_ratio" to "自定义比例",
    "random" to "纯随机"
)

private val EXAM_MIN_STAR_OPTIONS = listOf(0 to "不限星级", 3 to "≥3★", 4 to "≥4★", 5 to "5★")
private val END_WINDOW_OPTIONS = listOf(
    0 to "不限截止",
    60 to "1小时后截止",
    180 to "3小时后截止",
    -1 to "今日23:59截止"
)

private fun computeEndsAtIso(windowMinutes: Int): String? {
    if (windowMinutes == 0) return null
    val cal = Calendar.getInstance()
    if (windowMinutes > 0) {
        cal.add(Calendar.MINUTE, windowMinutes)
    } else {
        cal.set(Calendar.HOUR_OF_DAY, 23)
        cal.set(Calendar.MINUTE, 59)
        cal.set(Calendar.SECOND, 59)
    }
    val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    fmt.timeZone = TimeZone.getTimeZone("UTC")
    return fmt.format(Date(cal.timeInMillis))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExamsScreen(
    viewModel: MainViewModel,
    onTakeExam: (shareCode: String) -> Unit,
    onOpenReport: (submissionId: String) -> Unit,
    onOpenAnalytics: (examId: String) -> Unit
) {
    val palette = KsbTheme.colors
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()

    var activeTab by remember { mutableIntStateOf(0) }
    var exams by remember { mutableStateOf<List<ExamSummary>>(emptyList()) }
    var submissions by remember { mutableStateOf<List<ExamSubmissionItem>>(emptyList()) }
    var banks by remember { mutableStateOf<List<QuestionBankSummary>>(emptyList()) }

    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var statusMsg by remember { mutableStateOf<String?>(null) }
    var shareCodeInput by remember { mutableStateOf("") }

    var showCreateDialog by remember { mutableStateOf(false) }
    var showSelfTestDialog by remember { mutableStateOf(false) }
    var useCustomCounts by remember { mutableStateOf(false) }
    val customTypeCounts = remember {
        mutableStateMapOf("single" to "10", "multiple" to "4", "boolean" to "4", "fill" to "2", "short" to "0")
    }
    var selectedBankId by remember { mutableStateOf("") }
    var bankMenuOpen by remember { mutableStateOf(false) }
    var examTitle by remember { mutableStateOf("") }
    var examType by remember { mutableStateOf("published") }
    var totalQuestionsText by remember { mutableStateOf("20") }
    var durationText by remember { mutableStateOf("45") }
    var endWindowOpt by remember { mutableIntStateOf(0) }
    var maxTabText by remember { mutableStateOf("5") }
    var blockEmulator by remember { mutableStateOf(true) }
    var strictAntiCheat by remember { mutableStateOf(true) }
    var strategy by remember { mutableStateOf("balanced") }
    var minStarRating by remember { mutableIntStateOf(0) }
    var easyRatioText by remember { mutableStateOf("30") }
    var mediumRatioText by remember { mutableStateOf("50") }
    var hardRatioText by remember { mutableStateOf("20") }

    var previewData by remember { mutableStateOf<ExamAssemblyPreviewResponse?>(null) }
    var previewLoading by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }

    var terminateTarget by remember { mutableStateOf<ExamSummary?>(null) }
    var terminating by remember { mutableStateOf(false) }

    var qrModalInfo by remember { mutableStateOf<ShareQrInfoResponse?>(null) }
    var qrBitmap by remember { mutableStateOf<Bitmap?>(null) }

    fun loadAll() {
        scope.launch {
            loading = true
            errorMsg = null
            try {
                val res = viewModel.api().listExams()
                exams = res.exams
                submissions = res.submissions
                val bankRes = viewModel.api().listBanks(scope = "all")
                banks = bankRes.banks
                if (selectedBankId.isEmpty() && banks.isNotEmpty()) {
                    selectedBankId = banks.first().id
                }
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { loadAll() }

    Scaffold(
        containerColor = palette.canvas,
        floatingActionButton = {
            FloatingActionButton(
                onClick = {
                    previewData = null
                    showCreateDialog = true
                },
                shape = CircleShape,
                elevation = FloatingActionButtonDefaults.elevation(0.dp, 0.dp),
                containerColor = palette.brand,
                contentColor = Color.White
            ) {
                Icon(Icons.Default.Add, contentDescription = "发起考试")
            }
        }
    ) { innerPad ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad)
        ) {
            androidx.compose.foundation.layout.Box(
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp)
            ) {
                KsbSegmentedControl(
                    items = listOf(
                        "0" to "在线考场 (${exams.size})",
                        "1" to "我的成绩 (${submissions.size})"
                    ),
                    selectedKey = activeTab.toString(),
                    onSelect = { activeTab = it.toIntOrNull() ?: 0 }
                )
            }

            if (loading && exams.isEmpty()) {
                KsbLoadingView("正在加载考试中心...")
                return@Column
            }

            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                if (errorMsg != null) item { KsbBanner(text = errorMsg!!, isError = true) }
                if (statusMsg != null) item { KsbBanner(text = statusMsg!!, isError = false) }

                item {
                    KsbCard {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text("自由自测组卷", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                Text("自由指定单选/多选/判断/填空等题数，交卷即出解析", fontSize = 11.sp, color = palette.textMuted)
                            }
                            KsbOutlineButton(
                                text = "自测组卷",
                                borderColor = palette.warning,
                                contentColor = palette.warning,
                                onClick = { showSelfTestDialog = true }
                            )
                        }
                    }
                }

                item {
                    KsbCard {
                        Text("凭考场分享码直接参试", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedTextField(
                                value = shareCodeInput,
                                onValueChange = { shareCodeInput = it.uppercase() },
                                placeholder = { Text("输入 8 位考场分享码", fontSize = 13.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            KsbPrimaryButton(
                                text = "进入考场",
                                enabled = shareCodeInput.trim().isNotEmpty(),
                                onClick = { onTakeExam(shareCodeInput.trim().uppercase()) }
                            )
                        }
                    }
                }

                if (activeTab == 0) {
                    if (exams.isEmpty()) {
                        item {
                            KsbEmptyView(
                                icon = Icons.Default.Assignment,
                                title = "暂无活跃考场",
                                subtitle = "点击右下角 + 发起组织考试或模拟测验",
                                actionText = "发起考试 / 组卷",
                                onAction = { showCreateDialog = true }
                            )
                        }
                    } else {
                        items(exams, key = { it.id }) { exam ->
                            val isCreator =
                                exam.creatorId == viewModel.currentUser?.id ||
                                    viewModel.currentUser?.role == "admin"

                            KsbCard {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        KsbBadge(text = if (exam.examType == "published") "组织考试" else "模拟测验")
                                        KsbBadge(
                                            text = "码 ${exam.shareCode}",
                                            containerColor = palette.cardElevated,
                                            contentColor = palette.textSecondary
                                        )
                                        if (exam.blockEmulator) {
                                            KsbBadge(
                                                text = "禁虚拟机",
                                                containerColor = palette.errorBg,
                                                contentColor = palette.error
                                            )
                                        }
                                    }
                                    KsbBadge(
                                        text = if (exam.status == "active") "进行中" else "已终结",
                                        containerColor = if (exam.status == "active") palette.successBg else palette.errorBg,
                                        contentColor = if (exam.status == "active") palette.success else palette.error
                                    )
                                }
                                Spacer(modifier = Modifier.height(6.dp))
                                Text(exam.title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "${exam.questionCount} 题 · 总分 ${exam.totalScore.toInt()}（及格 ${exam.passScore.toInt()}）· 时长 ${exam.durationMinutes} 分钟",
                                    fontSize = 12.sp,
                                    color = palette.textSecondary
                                )
                                exam.assemblyMeta?.actualDistribution?.let { dist ->
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = "策略：${assemblyStrategyLabel(exam.assemblyMeta.strategy)} · 易${dist.easy}/中${dist.medium}/难${dist.hard}",
                                        fontSize = 11.sp,
                                        color = palette.textMuted
                                    )
                                }
                                if ((exam.submissionCount ?: 0) > 0 || (exam.inProgressCount ?: 0) > 0) {
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = "在考 ${exam.inProgressCount ?: 0} 人 · 已交卷 ${exam.submissionCount ?: 0} 人 · 均分 ${exam.avgScore ?: 0} · 正确率 ${exam.avgAccuracy ?: 0}% · 及格率 ${exam.passRate ?: 0}%",
                                        fontSize = 11.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = palette.brand
                                    )
                                }
                                Spacer(modifier = Modifier.height(10.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    KsbPrimaryButton(
                                        text = "参试",
                                        enabled = exam.status == "active",
                                        modifier = Modifier.weight(1f),
                                        onClick = { onTakeExam(exam.shareCode) }
                                    )
                                    KsbOutlineButton(
                                        text = "二维码/微信",
                                        onClick = {
                                            scope.launch {
                                                try {
                                                    val qr = viewModel.api().getExamShareQr(exam.id)
                                                    qrBitmap = QrShareUtil.generateSharePosterBitmap(
                                                        qrContent = qr.shareUrl,
                                                        title = qr.title,
                                                        shareCode = qr.shareCode,
                                                        subtitle = "微信扫一扫或输入分享码参加考试"
                                                    )
                                                    qrModalInfo = qr
                                                } catch (e: Exception) {
                                                    errorMsg = ApiClient.parseError(e)
                                                }
                                            }
                                        }
                                    )
                                }
                                if (isCreator) {
                                    Spacer(modifier = Modifier.height(6.dp))
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                                    ) {
                                        KsbOutlineButton(
                                            text = "查看成绩与考情",
                                            borderColor = palette.ai,
                                            contentColor = palette.ai,
                                            modifier = Modifier.weight(1f),
                                            onClick = { onOpenAnalytics(exam.id) }
                                        )
                                        if (exam.status == "active") {
                                            KsbOutlineButton(
                                                text = "终结考试",
                                                borderColor = palette.error,
                                                contentColor = palette.error,
                                                onClick = { terminateTarget = exam }
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                } else {
                    if (submissions.isEmpty()) {
                        item {
                            KsbEmptyView(
                                icon = Icons.Default.Assignment,
                                title = "暂无交卷记录",
                                subtitle = "完成一场在线考试后，成绩单会自动沉淀在这里"
                            )
                        }
                    } else {
                        items(submissions, key = { it.id }) { sub ->
                            val acc = sub.accuracy ?: if (sub.totalQuestions > 0) (sub.correctCount * 100.0 / sub.totalQuestions) else 0.0
                            KsbCard(modifier = Modifier.clickable { onOpenReport(sub.id) }) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = sub.examTitle ?: "考试成绩单",
                                            fontSize = 15.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = palette.textPrimary
                                        )
                                        Spacer(modifier = Modifier.height(2.dp))
                                        Text(
                                            text = "正确率 ${String.format(Locale.US, "%.1f", acc)}% · 对 ${sub.correctCount}/${sub.totalQuestions} 题 · 异常 ${sub.tabSwitchCount} 次",
                                            fontSize = 12.sp,
                                            color = palette.textSecondary
                                        )
                                    }
                                    Column(horizontalAlignment = Alignment.End) {
                                        Text(
                                            text = "${sub.score} 分",
                                            fontSize = 18.sp,
                                            fontWeight = FontWeight.ExtraBold,
                                            color = if (sub.isPassed) palette.success else palette.error
                                        )
                                        KsbBadge(
                                            text = if (sub.isPassed) "及格" else "未及格",
                                            containerColor = if (sub.isPassed) palette.successBg else palette.errorBg,
                                            contentColor = if (sub.isPassed) palette.success else palette.error
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

    if (showCreateDialog) {
        val currentRatio = if (strategy == "custom_ratio") {
            DifficultyRatioDto(
                easy = easyRatioText.toIntOrNull()?.coerceAtLeast(0) ?: 30,
                medium = mediumRatioText.toIntOrNull()?.coerceAtLeast(0) ?: 50,
                hard = hardRatioText.toIntOrNull()?.coerceAtLeast(0) ?: 20
            )
        } else null

        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text("发起考试 / 智能组卷", fontWeight = FontWeight.Bold) },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        FilterChip(
                            selected = examType == "published",
                            onClick = { examType = "published" },
                            label = { Text("组织发布考试", fontSize = 11.sp) }
                        )
                        FilterChip(
                            selected = examType == "mock",
                            onClick = { examType = "mock" },
                            label = { Text("个人模拟测验", fontSize = 11.sp) }
                        )
                    }

                    val chosenTitle = banks.firstOrNull { it.id == selectedBankId }?.title ?: "请选择题库"
                    ExposedDropdownMenuBox(
                        expanded = bankMenuOpen,
                        onExpandedChange = { bankMenuOpen = !bankMenuOpen }
                    ) {
                        OutlinedTextField(
                            value = chosenTitle,
                            onValueChange = {},
                            readOnly = true,
                            label = { Text("来源题库") },
                            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = bankMenuOpen) },
                            modifier = Modifier
                                .fillMaxWidth()
                                .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                        )
                        ExposedDropdownMenu(
                            expanded = bankMenuOpen,
                            onDismissRequest = { bankMenuOpen = false }
                        ) {
                            banks.forEach { b ->
                                DropdownMenuItem(
                                    text = { Text("${b.title} (${b.questionCount}题)") },
                                    onClick = {
                                        selectedBankId = b.id
                                        if (examTitle.isBlank()) examTitle = "${b.title} 在线考核"
                                        previewData = null
                                        bankMenuOpen = false
                                    }
                                )
                            }
                        }
                    }

                    OutlinedTextField(
                        value = examTitle,
                        onValueChange = { examTitle = it },
                        label = { Text("考试标题") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("按各题型分别指定题数", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = palette.textPrimary)
                        Switch(
                            checked = useCustomCounts,
                            onCheckedChange = { useCustomCounts = it; previewData = null }
                        )
                    }

                    if (!useCustomCounts) {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = totalQuestionsText,
                                onValueChange = {
                                    totalQuestionsText = it.filter { c -> c.isDigit() }
                                    previewData = null
                                },
                                label = { Text("抽题数") },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedTextField(
                                value = durationText,
                                onValueChange = { durationText = it.filter { c -> c.isDigit() } },
                                label = { Text("时长(分钟)") },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedTextField(
                                value = maxTabText,
                                onValueChange = { maxTabText = it.filter { c -> c.isDigit() } },
                                label = { Text("限违规次") },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    } else {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf("single" to "单选", "multiple" to "多选", "boolean" to "判断", "fill" to "填空", "short" to "简答").forEach { (k, lbl) ->
                                OutlinedTextField(
                                    value = customTypeCounts[k] ?: "0",
                                    onValueChange = {
                                        customTypeCounts[k] = it.filter { c -> c.isDigit() }
                                        previewData = null
                                    },
                                    label = { Text(lbl, fontSize = 11.sp) },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(
                                value = durationText,
                                onValueChange = { durationText = it.filter { c -> c.isDigit() } },
                                label = { Text("时长(分钟)") },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedTextField(
                                value = maxTabText,
                                onValueChange = { maxTabText = it.filter { c -> c.isDigit() } },
                                label = { Text("限违规次") },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }

                    Text("考场截止时间", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        END_WINDOW_OPTIONS.forEach { (mins, label) ->
                            FilterChip(
                                selected = endWindowOpt == mins,
                                onClick = { endWindowOpt = mins },
                                label = { Text(label, fontSize = 11.sp) }
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("禁止虚拟机 / 模拟器参考", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = palette.error)
                        Switch(checked = blockEmulator, onCheckedChange = { blockEmulator = it })
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("严格防小窗 / 分屏 / 失焦监测", fontSize = 12.sp, color = palette.textPrimary)
                        Switch(checked = strictAntiCheat, onCheckedChange = { strictAntiCheat = it })
                    }

                    Text("组卷策略", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        ASSEMBLY_STRATEGIES.forEach { (key, label) ->
                            FilterChip(
                                selected = strategy == key,
                                onClick = {
                                    strategy = key
                                    previewData = null
                                },
                                label = { Text(label, fontSize = 11.sp) }
                            )
                        }
                    }

                    if (strategy == "custom_ratio") {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            OutlinedTextField(
                                value = easyRatioText,
                                onValueChange = { easyRatioText = it.filter { c -> c.isDigit() }; previewData = null },
                                label = { Text("简%", fontSize = 11.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedTextField(
                                value = mediumRatioText,
                                onValueChange = { mediumRatioText = it.filter { c -> c.isDigit() }; previewData = null },
                                label = { Text("中%", fontSize = 11.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            OutlinedTextField(
                                value = hardRatioText,
                                onValueChange = { hardRatioText = it.filter { c -> c.isDigit() }; previewData = null },
                                label = { Text("难%", fontSize = 11.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                        }
                    }

                    Text("最低星级门槛", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        EXAM_MIN_STAR_OPTIONS.forEach { (star, label) ->
                            FilterChip(
                                selected = minStarRating == star,
                                onClick = {
                                    minStarRating = star
                                    previewData = null
                                },
                                label = { Text(label, fontSize = 11.sp) }
                            )
                        }
                    }

                    KsbOutlineButton(
                        text = if (previewLoading) "预演计算中..." else "实时预演组卷配比",
                        enabled = selectedBankId.isNotBlank() && !previewLoading,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            previewLoading = true
                            scope.launch {
                                try {
                                    val customCountsMap = if (useCustomCounts) {
                                        customTypeCounts.mapValues { it.value.toIntOrNull()?.coerceAtLeast(0) ?: 0 }.filterValues { it > 0 }
                                    } else null
                                    val targetTotal = if (customCountsMap != null) customCountsMap.values.sum().coerceAtLeast(1) else (totalQuestionsText.toIntOrNull()?.coerceIn(1, 200) ?: 20)
                                    previewData = viewModel.api().previewExamAssembly(
                                        ExamAssemblyPreviewRequest(
                                            bankId = selectedBankId,
                                            totalQuestions = targetTotal,
                                            counts = customCountsMap,
                                            strategy = strategy,
                                            difficultyRatio = currentRatio,
                                            minStarRating = minStarRating
                                        )
                                    )
                                } catch (e: Exception) {
                                    errorMsg = ApiClient.parseError(e)
                                } finally {
                                    previewLoading = false
                                }
                            }
                        }
                    )

                    previewData?.let { pv ->
                        val dist = pv.projected.meta.actualDistribution
                        KsbBanner(
                            text = "预计实抽 ${pv.projected.totalPicked} 题：简${dist.easy} / 中${dist.medium} / 难${dist.hard}（均难 ${dist.avgDifficulty}）",
                            isError = false
                        )
                    }
                }
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = if (examType == "published") "发布考试" else "生成并开考",
                    loading = creating,
                    enabled = selectedBankId.isNotBlank() && examTitle.trim().isNotEmpty(),
                    onClick = {
                        creating = true
                        scope.launch {
                            try {
                                val customCountsMap = if (useCustomCounts) {
                                    customTypeCounts.mapValues { it.value.toIntOrNull()?.coerceAtLeast(0) ?: 0 }.filterValues { it > 0 }
                                } else null
                                val targetTotal = if (customCountsMap != null) customCountsMap.values.sum().coerceAtLeast(1) else (totalQuestionsText.toIntOrNull()?.coerceIn(1, 200) ?: 20)
                                val created = viewModel.api().createExam(
                                    CreateExamRequest(
                                        bankId = selectedBankId,
                                        title = examTitle.trim(),
                                        examType = examType,
                                        totalQuestions = targetTotal,
                                        counts = customCountsMap,
                                        durationMinutes = durationText.toIntOrNull()?.coerceIn(1, 600) ?: 45,
                                        endsAt = computeEndsAtIso(endWindowOpt),
                                        maxTabSwitches = maxTabText.toIntOrNull()?.coerceIn(0, 50) ?: 5,
                                        blockEmulator = blockEmulator,
                                        strictAntiCheat = strictAntiCheat,
                                        autoSubmitOnCheat = true,
                                        strategy = strategy,
                                        difficultyRatio = currentRatio,
                                        minStarRating = minStarRating
                                    )
                                )
                                showCreateDialog = false
                                loadAll()
                                if (examType == "mock") {
                                    onTakeExam(created.shareCode)
                                } else {
                                    statusMsg = "考场已发布，分享码：${created.shareCode}"
                                }
                            } catch (e: Exception) {
                                errorMsg = ApiClient.parseError(e)
                            } finally {
                                creating = false
                            }
                        }
                    }
                )
            },
            dismissButton = {
                TextButton(onClick = { showCreateDialog = false }) { Text("取消") }
            }
        )
    }

    terminateTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { terminateTarget = null },
            containerColor = palette.card,
            title = { Text("确认主动终结考试", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "确认立即终结「${target.title}」吗？\n考场将立刻关闭，正在答题中的考生将按最新作答自动结算并交卷。",
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
                                val res = viewModel.api().terminateExam(target.id)
                                terminateTarget = null
                                statusMsg = "已终结考场（自动收卷 ${res.terminatedCount} 人）"
                                loadAll()
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
                TextButton(onClick = { terminateTarget = null }) { Text("取消") }
            }
        )
    }

    val qrInfo = qrModalInfo
    val posterBmp = qrBitmap
    if (qrInfo != null && posterBmp != null) {
        AlertDialog(
            onDismissRequest = { qrModalInfo = null },
            containerColor = palette.card,
            title = { Text("考场二维码与微信分享", fontWeight = FontWeight.Bold) },
            text = {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    Image(
                        bitmap = posterBmp.asImageBitmap(),
                        contentDescription = "考场二维码海报",
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(290.dp)
                            .clip(RoundedCornerShape(12.dp))
                    )
                    Text(
                        text = "分享码：${qrInfo.shareCode}",
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.brand
                    )
                    KsbPrimaryButton(
                        text = "转发二维码给微信好友",
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            QrShareUtil.sharePosterToWeChatOrChooser(
                                context = context,
                                poster = posterBmp,
                                shareText = "【PrismQ 棱题考试】${qrInfo.title}\n分享码：${qrInfo.shareCode}\n${qrInfo.shareUrl}",
                                preferWeChat = true
                            )
                        }
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        KsbOutlineButton(
                            text = "保存相册",
                            modifier = Modifier.weight(1f),
                            onClick = {
                                QrShareUtil.saveBitmapToGallery(
                                    context,
                                    posterBmp,
                                    "PrismQ_Exam_${qrInfo.shareCode}.png"
                                )
                                statusMsg = "已保存考场二维码图片到相册"
                                qrModalInfo = null
                            }
                        )
                        KsbOutlineButton(
                            text = "复制文案",
                            modifier = Modifier.weight(1f),
                            onClick = {
                                clipboard.setText(
                                    AnnotatedString("【PrismQ 棱题考试】${qrInfo.title}\n分享码：${qrInfo.shareCode}\n链接：${qrInfo.shareUrl}")
                                )
                                statusMsg = "已复制考场分享链接与口令"
                                qrModalInfo = null
                            }
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { qrModalInfo = null }) { Text("关闭") }
            }
        )
    }

    if (showSelfTestDialog) {
        SelfTestBuilderDialog(
            viewModel = viewModel,
            banks = banks,
            onDismiss = { showSelfTestDialog = false },
            onCreated = { code ->
                loadAll()
                onTakeExam(code)
            }
        )
    }
}
