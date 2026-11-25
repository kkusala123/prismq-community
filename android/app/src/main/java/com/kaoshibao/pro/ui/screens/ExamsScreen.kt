package com.kaoshibao.pro.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kaoshibao.pro.data.model.CreateExamRequest
import com.kaoshibao.pro.data.model.DifficultyRatioDto
import com.kaoshibao.pro.data.model.ExamAssemblyPreviewRequest
import com.kaoshibao.pro.data.model.ExamAssemblyPreviewResponse
import com.kaoshibao.pro.data.model.ExamSubmissionItem
import com.kaoshibao.pro.data.model.ExamSummary
import com.kaoshibao.pro.data.model.QuestionBankSummary
import com.kaoshibao.pro.data.model.assemblyStrategyLabel
import com.kaoshibao.pro.data.remote.ApiClient
import com.kaoshibao.pro.ui.MainViewModel
import com.kaoshibao.pro.ui.components.KsbBadge
import com.kaoshibao.pro.ui.components.KsbBanner
import com.kaoshibao.pro.ui.components.KsbCard
import com.kaoshibao.pro.ui.components.KsbEmptyView
import com.kaoshibao.pro.ui.components.KsbLoadingView
import com.kaoshibao.pro.ui.components.KsbOutlineButton
import com.kaoshibao.pro.ui.components.KsbPrimaryButton
import com.kaoshibao.pro.ui.components.KsbSegmentedControl
import com.kaoshibao.pro.ui.theme.KsbTheme
import kotlinx.coroutines.launch

private val ASSEMBLY_STRATEGIES = listOf(
    "balanced" to "难度均衡(3:5:2)",
    "easy_first" to "基础递进(6:3:1)",
    "hard_focus" to "攻坚拔高(1.5:3.5:5)",
    "high_star" to "高星核心精选",
    "custom_ratio" to "自定义比例",
    "random" to "纯随机"
)

private val EXAM_MIN_STAR_OPTIONS = listOf(0 to "不限星级", 3 to "≥3★", 4 to "≥4★", 5 to "5★")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ExamsScreen(
    viewModel: MainViewModel,
    onTakeExam: (shareCode: String) -> Unit,
    onOpenReport: (submissionId: String) -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    var activeTab by remember { mutableIntStateOf(0) }
    var exams by remember { mutableStateOf<List<ExamSummary>>(emptyList()) }
    var submissions by remember { mutableStateOf<List<ExamSubmissionItem>>(emptyList()) }
    var banks by remember { mutableStateOf<List<QuestionBankSummary>>(emptyList()) }

    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var shareCodeInput by remember { mutableStateOf("") }

    var showCreateDialog by remember { mutableStateOf(false) }
    var selectedBankId by remember { mutableStateOf("") }
    var bankMenuOpen by remember { mutableStateOf(false) }
    var examTitle by remember { mutableStateOf("") }
    var totalQuestionsText by remember { mutableStateOf("20") }
    var durationText by remember { mutableStateOf("45") }
    var strategy by remember { mutableStateOf("balanced") }
    var minStarRating by remember { mutableIntStateOf(0) }
    var easyRatioText by remember { mutableStateOf("30") }
    var mediumRatioText by remember { mutableStateOf("50") }
    var hardRatioText by remember { mutableStateOf("20") }

    var previewData by remember { mutableStateOf<ExamAssemblyPreviewResponse?>(null) }
    var previewLoading by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }

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
                Icon(Icons.Default.Add, contentDescription = "智能组卷")
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
                if (errorMsg != null) {
                    item { KsbBanner(text = errorMsg!!, isError = true) }
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
                                subtitle = "点击右下角 + 使用智能难度均衡策略抽题组卷",
                                actionText = "发起智能组卷",
                                onAction = { showCreateDialog = true }
                            )
                        }
                    } else {
                        items(exams, key = { it.id }) { exam ->
                            KsbCard {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                        KsbBadge(text = if (exam.examType == "published") "正式发布" else "模拟测验")
                                        KsbBadge(
                                            text = "码 ${exam.shareCode}",
                                            containerColor = palette.cardElevated,
                                            contentColor = palette.textSecondary
                                        )
                                        exam.assemblyMeta?.let { meta ->
                                            KsbBadge(
                                                text = assemblyStrategyLabel(meta.strategy),
                                                containerColor = palette.aiBg,
                                                contentColor = palette.ai
                                            )
                                        }
                                    }
                                    KsbBadge(
                                        text = if (exam.status == "active") "进行中" else "已关闭",
                                        containerColor = if (exam.status == "active") palette.successBg else palette.cardElevated,
                                        contentColor = if (exam.status == "active") palette.success else palette.textMuted
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
                                        text = "难度分布：易${dist.easy} / 中${dist.medium} / 难${dist.hard} · 均难 ${dist.avgDifficulty}${if (dist.avgStarRating > 0) " · 均${dist.avgStarRating}★" else ""}",
                                        fontSize = 11.sp,
                                        color = palette.textMuted
                                    )
                                }
                                Spacer(modifier = Modifier.height(10.dp))
                                KsbPrimaryButton(
                                    text = "进入考试",
                                    enabled = exam.status == "active",
                                    modifier = Modifier.fillMaxWidth(),
                                    onClick = { onTakeExam(exam.shareCode) }
                                )
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
                                            text = "答对 ${sub.correctCount}/${sub.totalQuestions} 题 · 用时 ${sub.durationSeconds} 秒 · 切屏 ${sub.tabSwitchCount} 次",
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
            title = { Text("动态与难度均衡组卷", fontWeight = FontWeight.Bold) },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
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
                                        if (examTitle.isBlank()) examTitle = "${b.title} 智能考卷"
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
                                    previewData = viewModel.api().previewExamAssembly(
                                        ExamAssemblyPreviewRequest(
                                            bankId = selectedBankId,
                                            totalQuestions = totalQuestionsText.toIntOrNull()?.coerceIn(1, 200) ?: 20,
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
                            text = "预计实抽 ${pv.projected.totalPicked} 题：简${dist.easy} / 中${dist.medium} / 难${dist.hard}（均难 ${dist.avgDifficulty}${if (dist.avgStarRating > 0) " · 均${dist.avgStarRating}★" else ""}）",
                            isError = false
                        )
                        if (pv.warnings.isNotEmpty()) {
                            KsbBanner(text = pv.warnings.joinToString("\n"), isError = true)
                        }
                    }
                }
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = "生成并开考",
                    loading = creating,
                    enabled = selectedBankId.isNotBlank() && examTitle.trim().isNotEmpty(),
                    onClick = {
                        creating = true
                        scope.launch {
                            try {
                                val created = viewModel.api().createExam(
                                    CreateExamRequest(
                                        bankId = selectedBankId,
                                        title = examTitle.trim(),
                                        totalQuestions = totalQuestionsText.toIntOrNull()?.coerceIn(1, 200) ?: 20,
                                        durationMinutes = durationText.toIntOrNull()?.coerceIn(5, 300) ?: 45,
                                        strategy = strategy,
                                        difficultyRatio = currentRatio,
                                        minStarRating = minStarRating
                                    )
                                )
                                showCreateDialog = false
                                loadAll()
                                onTakeExam(created.shareCode)
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
}
