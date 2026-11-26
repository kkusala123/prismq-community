package com.prismq.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.prismq.app.data.model.BankStatsSummary
import com.prismq.app.data.model.ChapterItem
import com.prismq.app.data.model.CreateExamRequest
import com.prismq.app.data.model.QuestionBankSummary
import com.prismq.app.data.model.QuestionItem
import com.prismq.app.data.remote.ApiClient
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.theme.KsbTheme
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

private val SELF_TEST_TYPES = listOf(
    "single" to "单选题",
    "multiple" to "多选题",
    "boolean" to "判断题",
    "fill" to "填空题",
    "short" to "简答题"
)

private val SELF_TEST_STRATEGIES = listOf(
    "random" to "全随机",
    "balanced" to "难度均衡",
    "easy_first" to "基础巩固",
    "hard_focus" to "难题攻坚",
    "high_star" to "高星核心"
)

private val SELF_TEST_DURATIONS = listOf(15, 30, 45, 60)

private fun distributePresetCounts(
    target: Int,
    avail: Map<String, Int>
): Map<String, Int> {
    val result = mutableMapOf("single" to 0, "multiple" to 0, "boolean" to 0, "fill" to 0, "short" to 0)
    val totalAvail = SELF_TEST_TYPES.sumOf { (t, _) -> avail[t] ?: 0 }
    if (totalAvail <= 0 || target <= 0) return result
    val clamped = target.coerceAtMost(totalAvail)
    val weights = mapOf("single" to 0.45, "boolean" to 0.25, "multiple" to 0.20, "fill" to 0.08, "short" to 0.02)
    val active = SELF_TEST_TYPES.map { it.first }.filter { (avail[it] ?: 0) > 0 }
    val wSum = active.sumOf { weights[it] ?: 0.1 }.coerceAtLeast(0.1)

    var assigned = 0
    for (t in active) {
        val maxN = avail[t] ?: 0
        val share = ((clamped * (weights[t] ?: 0.1)) / wSum).roundToInt().coerceIn(0, maxN)
        result[t] = share
        assigned += share
    }
    var rem = clamped - assigned
    while (rem > 0) {
        var moved = false
        for (t in active) {
            if (rem <= 0) break
            val maxN = avail[t] ?: 0
            val cur = result[t] ?: 0
            if (cur < maxN) {
                result[t] = cur + 1
                rem -= 1
                moved = true
            }
        }
        if (!moved) break
    }
    return result
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SelfTestBuilderDialog(
    viewModel: MainViewModel,
    banks: List<QuestionBankSummary>,
    fixedBankId: String? = null,
    fixedBankTitle: String = "",
    fixedChapters: List<ChapterItem> = emptyList(),
    fixedQuestions: List<QuestionItem> = emptyList(),
    fixedStats: BankStatsSummary? = null,
    onDismiss: () -> Unit,
    onCreated: (shareCode: String) -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()

    var selectedBankId by remember { mutableStateOf(fixedBankId ?: banks.firstOrNull()?.id.orEmpty()) }
    var bankMenuOpen by remember { mutableStateOf(false) }
    var bankTitle by remember { mutableStateOf(fixedBankTitle) }
    var chapters by remember { mutableStateOf(fixedChapters) }
    var questions by remember { mutableStateOf(fixedQuestions) }
    var stats by remember { mutableStateOf(fixedStats) }
    var loadingBank by remember { mutableStateOf(false) }

    val selectedChapters = remember { mutableStateMapOf<String, Boolean>() }
    val counts = remember {
        mutableStateMapOf("single" to 0, "multiple" to 0, "boolean" to 0, "fill" to 0, "short" to 0)
    }
    var customTitle by remember { mutableStateOf("") }
    var strategy by remember { mutableStateOf("random") }
    var durationMinutes by remember { mutableIntStateOf(30) }
    var shuffleQuestions by remember { mutableStateOf(true) }
    var shuffleOptions by remember { mutableStateOf(true) }
    var creating by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(selectedBankId) {
        if (fixedBankId != null || selectedBankId.isBlank()) return@LaunchedEffect
        loadingBank = true
        errorMsg = null
        selectedChapters.clear()
        try {
            val detail = viewModel.api().getBankDetail(selectedBankId)
            bankTitle = detail.bank.title
            chapters = detail.chapters
            questions = detail.questions
            stats = detail.stats
        } catch (e: Exception) {
            errorMsg = ApiClient.parseError(e)
        } finally {
            loadingBank = false
        }
    }

    val activeChapterIds = selectedChapters.filterValues { it }.keys.toSet()
    val availCounts = remember(stats, questions, activeChapterIds.size) {
        val out = mutableMapOf("single" to 0, "multiple" to 0, "boolean" to 0, "fill" to 0, "short" to 0)
        if (activeChapterIds.isEmpty() && stats?.typeCounts?.isNotEmpty() == true) {
            for ((t, _) in SELF_TEST_TYPES) {
                out[t] = stats?.typeCounts?.get(t) ?: 0
            }
        } else {
            for (q in questions) {
                if (activeChapterIds.isNotEmpty() && q.chapterId !in activeChapterIds) continue
                out[q.type] = (out[q.type] ?: 0) + 1
            }
        }
        out
    }

    LaunchedEffect(availCounts) {
        val totalAvail = availCounts.values.sum()
        if (totalAvail <= 0) {
            for ((t, _) in SELF_TEST_TYPES) counts[t] = 0
            return@LaunchedEffect
        }
        var currentSum = 0
        for ((t, _) in SELF_TEST_TYPES) {
            val clamped = (counts[t] ?: 0).coerceIn(0, availCounts[t] ?: 0)
            counts[t] = clamped
            currentSum += clamped
        }
        if (currentSum == 0) {
            val preset = distributePresetCounts(minOf(20, totalAvail), availCounts)
            for ((t, v) in preset) counts[t] = v
        }
    }

    val totalPicked = SELF_TEST_TYPES.sumOf { (t, _) -> counts[t] ?: 0 }
    val totalAvail = availCounts.values.sum()

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = palette.card,
        title = { Text("自由自测组卷", fontWeight = FontWeight.Bold) },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (errorMsg != null) {
                    KsbBanner(text = errorMsg ?: "", isError = true)
                }

                if (fixedBankId == null && banks.isNotEmpty()) {
                    val chosen = banks.firstOrNull { it.id == selectedBankId }?.title ?: "请选择题库"
                    ExposedDropdownMenuBox(
                        expanded = bankMenuOpen,
                        onExpandedChange = { bankMenuOpen = !bankMenuOpen }
                    ) {
                        OutlinedTextField(
                            value = chosen,
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
                                        bankMenuOpen = false
                                    }
                                )
                            }
                        }
                    }
                } else if (bankTitle.isNotBlank()) {
                    Text(
                        text = "题库：$bankTitle（可选共 $totalAvail 题）",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = palette.textSecondary
                    )
                }

                OutlinedTextField(
                    value = customTitle,
                    onValueChange = { customTitle = it },
                    label = { Text("自测卷名称（可选）") },
                    placeholder = { Text("${bankTitle.ifBlank { "题库" }} 自由自测卷", fontSize = 12.sp) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )

                if (chapters.isNotEmpty()) {
                    Text("按章节筛选（不选则全库抽取）", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        chapters.forEach { ch ->
                            val isSel = selectedChapters[ch.id] == true
                            FilterChip(
                                selected = isSel,
                                onClick = { selectedChapters[ch.id] = !isSel },
                                label = { Text("${ch.title}(${ch.questionCount})", fontSize = 11.sp) }
                            )
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("自选各题型数量", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Text("已选 $totalPicked / $totalAvail 题", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.brand)
                }

                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    listOf(10, 20, 30).forEach { n ->
                        OutlinedButton(
                            onClick = {
                                val p = distributePresetCounts(n, availCounts)
                                for ((t, v) in p) counts[t] = v
                            },
                            enabled = totalAvail > 0,
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text("${n}题快测", fontSize = 11.sp)
                        }
                    }
                    OutlinedButton(
                        onClick = { for ((t, _) in SELF_TEST_TYPES) counts[t] = 0 },
                        contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("清零", fontSize = 11.sp)
                    }
                }

                if (loadingBank) {
                    Text("正在读取题型数量...", fontSize = 12.sp, color = palette.textMuted)
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        SELF_TEST_TYPES.forEach { (typeKey, label) ->
                            val avail = availCounts[typeKey] ?: 0
                            val cur = counts[typeKey] ?: 0
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (cur > 0) palette.brandSoft.copy(alpha = 0.45f) else palette.canvas,
                                border = BorderStroke(1.dp, if (cur > 0) palette.brand else palette.border),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Column {
                                        Text(label, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                        Text("可用 $avail 题", fontSize = 11.sp, color = palette.textMuted)
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        IconButton(
                                            onClick = { counts[typeKey] = (cur - 1).coerceAtLeast(0) },
                                            enabled = cur > 0,
                                            modifier = Modifier.size(30.dp)
                                        ) {
                                            Icon(Icons.Default.Remove, contentDescription = "减1", modifier = Modifier.size(16.dp))
                                        }
                                        Text(
                                            text = cur.toString(),
                                            fontSize = 14.sp,
                                            fontWeight = FontWeight.ExtraBold,
                                            color = if (cur > 0) palette.brandDark else palette.textMuted,
                                            textAlign = TextAlign.Center,
                                            modifier = Modifier.width(34.dp)
                                        )
                                        IconButton(
                                            onClick = { counts[typeKey] = (cur + 1).coerceAtMost(avail) },
                                            enabled = cur < avail,
                                            modifier = Modifier.size(30.dp)
                                        ) {
                                            Icon(Icons.Default.Add, contentDescription = "加1", modifier = Modifier.size(16.dp))
                                        }
                                        if (avail > 0) {
                                            TextButton(
                                                onClick = { counts[typeKey] = avail },
                                                contentPadding = PaddingValues(horizontal = 4.dp, vertical = 0.dp)
                                            ) {
                                                Text("全选", fontSize = 11.sp)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                Text("抽题策略", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    SELF_TEST_STRATEGIES.forEach { (k, lbl) ->
                        FilterChip(
                            selected = strategy == k,
                            onClick = { strategy = k },
                            label = { Text(lbl, fontSize = 11.sp) }
                        )
                    }
                }

                Text("自测限时", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    SELF_TEST_DURATIONS.forEach { m ->
                        FilterChip(
                            selected = durationMinutes == m,
                            onClick = { durationMinutes = m },
                            label = { Text("${m}分钟", fontSize = 11.sp) }
                        )
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("题目与选项乱序（不计切屏惩罚）", fontSize = 12.sp, color = palette.textSecondary)
                    Switch(checked = shuffleQuestions, onCheckedChange = { shuffleQuestions = it; shuffleOptions = it })
                }
            }
        },
        confirmButton = {
            KsbPrimaryButton(
                text = "开始自测 (${totalPicked}题)",
                loading = creating,
                enabled = selectedBankId.isNotBlank() && totalPicked > 0,
                onClick = {
                    creating = true
                    errorMsg = null
                    scope.launch {
                        try {
                            val reqCounts = counts.filterValues { it > 0 }
                            val created = viewModel.api().createExam(
                                CreateExamRequest(
                                    bankId = selectedBankId,
                                    title = customTitle.trim().ifEmpty { "${bankTitle.ifBlank { "题库" }} 自由自测卷" },
                                    examType = "mock",
                                    totalQuestions = totalPicked,
                                    counts = reqCounts,
                                    chapterIds = activeChapterIds.toList().ifEmpty { null },
                                    strategy = strategy,
                                    durationMinutes = durationMinutes,
                                    shuffleQuestions = shuffleQuestions,
                                    shuffleOptions = shuffleOptions,
                                    strictAntiCheat = false,
                                    autoSubmitOnCheat = false,
                                    blockEmulator = false,
                                    maxTabSwitches = 99,
                                    maxAttempts = 99
                                )
                            )
                            onDismiss()
                            onCreated(created.shareCode)
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
            TextButton(onClick = onDismiss) { Text("取消") }
        }
    )
}
