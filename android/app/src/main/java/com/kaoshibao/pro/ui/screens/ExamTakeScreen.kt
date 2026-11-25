package com.kaoshibao.pro.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kaoshibao.pro.data.model.ExamMetaInfo
import com.kaoshibao.pro.data.model.ExamQuestionSnapshot
import com.kaoshibao.pro.data.model.ExamSubmitRequest
import com.kaoshibao.pro.data.model.difficultyLabel
import com.kaoshibao.pro.data.model.questionTypeLabel
import com.kaoshibao.pro.data.remote.ApiClient
import com.kaoshibao.pro.ui.MainViewModel
import com.kaoshibao.pro.ui.components.KsbBadge
import com.kaoshibao.pro.ui.components.KsbBanner
import com.kaoshibao.pro.ui.components.KsbCard
import com.kaoshibao.pro.ui.components.KsbLoadingView
import com.kaoshibao.pro.ui.components.KsbOutlineButton
import com.kaoshibao.pro.ui.components.KsbPrimaryButton
import com.kaoshibao.pro.ui.theme.KsbTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ExamTakeScreen(
    shareCode: String,
    viewModel: MainViewModel,
    onBack: () -> Unit,
    onSubmitted: (submissionId: String) -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current

    var loading by remember { mutableStateOf(true) }
    var submitting by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    var requiresPassword by remember { mutableStateOf(false) }
    var requiresLogin by remember { mutableStateOf(false) }
    var accessPassword by remember { mutableStateOf("") }

    var examMeta by remember { mutableStateOf(ExamMetaInfo()) }
    var questions by remember { mutableStateOf<List<ExamQuestionSnapshot>>(emptyList()) }
    val answers = remember { mutableStateMapOf<String, String>() }

    var started by remember { mutableStateOf(false) }
    var participantName by remember {
        mutableStateOf(
            viewModel.currentUser?.let { it.nickname.ifBlank { it.username } } ?: ""
        )
    }
    var participantIdentifier by remember {
        mutableStateOf(viewModel.currentUser?.username ?: "")
    }
    var remainingSeconds by remember { mutableIntStateOf(3600) }
    var elapsedSeconds by remember { mutableIntStateOf(0) }
    var tabSwitchCount by remember { mutableIntStateOf(0) }
    var startedAtIso by remember { mutableStateOf("") }

    var showAnswerSheet by remember { mutableStateOf(false) }
    var showConfirmSubmit by remember { mutableStateOf(false) }

    fun loadExam(passwordArg: String? = null) {
        scope.launch {
            loading = true
            errorMsg = null
            try {
                val res = viewModel.api().joinExam(shareCode.trim(), passwordArg)
                examMeta = res.exam
                requiresPassword = res.requiresPassword
                requiresLogin = res.requiresLogin
                questions = res.questions
                remainingSeconds = (res.exam.durationMinutes.coerceAtLeast(1)) * 60
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                loading = false
            }
        }
    }

    fun submitNow() {
        if (submitting || questions.isEmpty()) return
        scope.launch {
            submitting = true
            errorMsg = null
            try {
                val res = viewModel.api().submitExam(
                    shareCode = shareCode.trim(),
                    body = ExamSubmitRequest(
                        participantName = participantName.ifBlank { "考生" },
                        participantIdentifier = participantIdentifier.ifBlank { "android-user" },
                        accessPassword = accessPassword,
                        answers = answers.toMap(),
                        durationSeconds = elapsedSeconds,
                        tabSwitchCount = tabSwitchCount,
                        startedAt = startedAtIso
                    )
                )
                onSubmitted(res.submission.id)
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                submitting = false
            }
        }
    }

    LaunchedEffect(shareCode) {
        loadExam(null)
    }

    LaunchedEffect(started) {
        if (!started) return@LaunchedEffect
        while (started && !submitting) {
            delay(1000L)
            elapsedSeconds += 1
            if (remainingSeconds > 0) {
                remainingSeconds -= 1
            } else {
                submitNow()
                break
            }
        }
    }

    DisposableEffect(lifecycleOwner, started) {
        val observer = LifecycleEventObserver { _, event ->
            if (started && !submitting && event == Lifecycle.Event.ON_STOP) {
                tabSwitchCount += 1
                if (examMeta.maxTabSwitches > 0 && tabSwitchCount >= examMeta.maxTabSwitches) {
                    submitNow()
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val pagerState = rememberPagerState(initialPage = 0, pageCount = { questions.size.coerceAtLeast(1) })

    Scaffold(
        containerColor = palette.canvas,
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = examMeta.title.ifBlank { "考场 #$shareCode" },
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = palette.textPrimary,
                            maxLines = 1
                        )
                        if (started && questions.isNotEmpty()) {
                            Text(
                                text = "第 ${pagerState.currentPage + 1} / ${questions.size} 题 · 已切屏 $tabSwitchCount 次",
                                fontSize = 11.sp,
                                color = if (tabSwitchCount > 0) palette.warning else palette.textSecondary
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = palette.textPrimary)
                    }
                },
                actions = {
                    if (started && questions.isNotEmpty()) {
                        val mins = remainingSeconds / 60
                        val secs = remainingSeconds % 60
                        val timerColor = if (remainingSeconds <= 180) palette.error else palette.brandDark
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (remainingSeconds <= 180) palette.errorBg else palette.brandSoft
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(4.dp)
                            ) {
                                Icon(Icons.Default.Timer, contentDescription = null, modifier = Modifier.size(14.dp), tint = timerColor)
                                Text(
                                    text = String.format(Locale.US, "%02d:%02d", mins, secs),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = timerColor
                                )
                            }
                        }
                        Spacer(modifier = Modifier.width(6.dp))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.card)
            )
        },
        bottomBar = {
            if (started && questions.isNotEmpty()) {
                Surface(
                    color = palette.card,
                    border = BorderStroke(1.dp, palette.border)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        KsbOutlineButton(
                            text = "上一题",
                            enabled = pagerState.currentPage > 0,
                            onClick = {
                                scope.launch {
                                    pagerState.animateScrollToPage((pagerState.currentPage - 1).coerceAtLeast(0))
                                }
                            }
                        )
                        KsbOutlineButton(
                            text = "答题卡 ${answers.count { it.value.isNotBlank() }}/${questions.size}",
                            onClick = { showAnswerSheet = true },
                            modifier = Modifier.weight(1f)
                        )
                        if (pagerState.currentPage < questions.lastIndex) {
                            KsbOutlineButton(
                                text = "下一题",
                                onClick = {
                                    scope.launch {
                                        pagerState.animateScrollToPage(pagerState.currentPage + 1)
                                    }
                                }
                            )
                        }
                        KsbPrimaryButton(
                            text = "交卷",
                            loading = submitting,
                            onClick = { showConfirmSubmit = true }
                        )
                    }
                }
            }
        }
    ) { innerPad ->
        when {
            loading -> Box(modifier = Modifier.padding(innerPad)) { KsbLoadingView("正在载入考场试卷...") }
            requiresLogin -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPad)
                        .padding(16.dp)
                ) {
                    KsbBanner(text = "该场考试要求登录后参与，请先确认账号状态。", isError = true)
                }
            }
            requiresPassword -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPad)
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    if (errorMsg != null) KsbBanner(text = errorMsg ?: "", isError = true)
                    KsbCard {
                        Text(examMeta.title.ifBlank { "考场验证" }, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        Spacer(modifier = Modifier.height(6.dp))
                        Text("本场考试已开启访问口令，请输入口令解锁试卷。", fontSize = 12.sp, color = palette.textSecondary)
                        Spacer(modifier = Modifier.height(10.dp))
                        OutlinedTextField(
                            value = accessPassword,
                            onValueChange = { accessPassword = it },
                            label = { Text("考场口令") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        KsbPrimaryButton(
                            text = "验证并进入",
                            onClick = { loadExam(accessPassword.trim()) },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
            !started -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPad)
                        .verticalScroll(rememberScrollState())
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    if (errorMsg != null) KsbBanner(text = errorMsg ?: "", isError = true)
                    KsbCard {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            KsbBadge(text = if (examMeta.examType == "formal") "正式考试" else "模拟测验")
                            KsbBadge(
                                text = "${examMeta.questionCount} 题 · ${examMeta.durationMinutes} 分钟",
                                containerColor = palette.cardElevated,
                                contentColor = palette.textSecondary
                            )
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(examMeta.title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        if (examMeta.description.isNotBlank()) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(examMeta.description, fontSize = 12.sp, color = palette.textSecondary)
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "满分 ${examMeta.totalScore.toInt()} 分 · 及格线 ${examMeta.passScore.toInt()} 分 · 允许切屏 ${examMeta.maxTabSwitches} 次",
                            fontSize = 12.sp,
                            color = palette.textSecondary
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = participantName,
                            onValueChange = { participantName = it },
                            label = { Text("考生姓名") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = participantIdentifier,
                            onValueChange = { participantIdentifier = it },
                            label = { Text("学号/工号（可选）") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(14.dp))
                        KsbPrimaryButton(
                            text = "开始答题计时",
                            enabled = questions.isNotEmpty(),
                            onClick = {
                                val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
                                fmt.timeZone = TimeZone.getTimeZone("UTC")
                                startedAtIso = fmt.format(Date())
                                elapsedSeconds = 0
                                tabSwitchCount = 0
                                started = true
                            },
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }
            }
            else -> {
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(innerPad)
                ) {
                    if (errorMsg != null) {
                        Box(modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) {
                            KsbBanner(text = errorMsg ?: "", isError = true)
                        }
                    }
                    if (examMeta.maxTabSwitches > 0 && tabSwitchCount > 0) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(palette.warningBg)
                                .padding(horizontal = 14.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Icon(Icons.Default.WarningAmber, contentDescription = null, modifier = Modifier.size(15.dp), tint = palette.warning)
                            Text(
                                text = "防切屏监测：已离开页面 $tabSwitchCount / ${examMeta.maxTabSwitches} 次",
                                fontSize = 11.sp,
                                color = palette.warning,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    HorizontalPager(
                        state = pagerState,
                        beyondViewportPageCount = 1,
                        pageSpacing = 12.dp,
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 12.dp),
                        modifier = Modifier.weight(1f)
                    ) { pageIndex ->
                        val q = questions[pageIndex]
                        ExamQuestionItemCard(
                            question = q,
                            index = pageIndex,
                            total = questions.size,
                            currentAnswer = answers[q.questionId] ?: "",
                            onAnswerChange = { nextAns -> answers[q.questionId] = nextAns }
                        )
                    }
                }
            }
        }
    }

    if (showAnswerSheet) {
        ModalBottomSheet(
            onDismissRequest = { showAnswerSheet = false },
            containerColor = palette.card
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("考场答题卡", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Text(
                        text = "已答 ${answers.count { it.value.isNotBlank() }} / ${questions.size}",
                        fontSize = 12.sp,
                        color = palette.textSecondary
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
                LazyVerticalGrid(
                    columns = GridCells.Fixed(6),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.height(260.dp)
                ) {
                    items(questions.size) { idx ->
                        val q = questions[idx]
                        val answered = !answers[q.questionId].isNullOrBlank()
                        val isCurrent = idx == pagerState.currentPage
                        Box(
                            modifier = Modifier
                                .height(42.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(
                                    when {
                                        isCurrent -> palette.brand
                                        answered -> palette.brandSoft
                                        else -> palette.cardElevated
                                    }
                                )
                                .border(
                                    1.dp,
                                    if (isCurrent) palette.brand else palette.border,
                                    RoundedCornerShape(10.dp)
                                )
                                .clickable {
                                    showAnswerSheet = false
                                    scope.launch { pagerState.animateScrollToPage(idx) }
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = "${idx + 1}",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = when {
                                    isCurrent -> Color.White
                                    answered -> palette.brandDark
                                    else -> palette.textSecondary
                                }
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.height(18.dp))
            }
        }
    }

    if (showConfirmSubmit) {
        val unansweredCount = questions.count { answers[it.questionId].isNullOrBlank() }
        AlertDialog(
            onDismissRequest = { showConfirmSubmit = false },
            containerColor = palette.card,
            title = { Text("确认交卷", fontWeight = FontWeight.Bold, color = palette.textPrimary) },
            text = {
                Text(
                    text = if (unansweredCount > 0) {
                        "还有 $unansweredCount 道题未作答，确认立即交卷判分吗？"
                    } else {
                        "所有试题均已作答，确认立即交卷并生成成绩报告？"
                    },
                    fontSize = 13.sp,
                    color = palette.textSecondary
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showConfirmSubmit = false
                        submitNow()
                    }
                ) {
                    Text("确认交卷", color = palette.brand, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showConfirmSubmit = false }) {
                    Text("继续作答", color = palette.textSecondary)
                }
            }
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ExamQuestionItemCard(
    question: ExamQuestionSnapshot,
    index: Int,
    total: Int,
    currentAnswer: String,
    onAnswerChange: (String) -> Unit
) {
    val palette = KsbTheme.colors
    KsbCard(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        contentPadding = PaddingValues(16.dp)
    ) {
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            KsbBadge(text = questionTypeLabel(question.type))
            KsbBadge(
                text = "${question.score.toInt()} 分",
                containerColor = palette.cardElevated,
                contentColor = palette.textSecondary
            )
            question.difficulty?.let { diff ->
                KsbBadge(
                    text = difficultyLabel(diff),
                    containerColor = palette.cardElevated,
                    contentColor = palette.textSecondary
                )
            }
            if ((question.starRating ?: 0) > 0) {
                KsbBadge(
                    text = "${question.starRating}★",
                    containerColor = palette.warningBg,
                    contentColor = palette.warning
                )
            }
        }
        Spacer(modifier = Modifier.height(10.dp))
        Text(
            text = "${index + 1} / $total  ${question.stem}",
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            color = palette.textPrimary,
            lineHeight = 23.sp
        )
        Spacer(modifier = Modifier.height(14.dp))

        if (question.type == "fill" || question.type == "short" || question.options.isEmpty()) {
            OutlinedTextField(
                value = currentAnswer,
                onValueChange = onAnswerChange,
                placeholder = { Text("请输入作答内容...") },
                minLines = if (question.type == "short") 4 else 2,
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(10.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = palette.brand,
                    unfocusedBorderColor = palette.borderInput,
                    focusedTextColor = palette.textPrimary,
                    unfocusedTextColor = palette.textPrimary
                )
            )
        } else {
            val isMulti = question.type == "multiple"
            val selectedSet = currentAnswer.uppercase().filter { it in 'A'..'Z' }.toSet()
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                question.options.forEach { opt ->
                    val keyUp = opt.key.uppercase()
                    val isSelected = if (isMulti) keyUp.firstOrNull() in selectedSet else currentAnswer.equals(opt.key, ignoreCase = true)
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable {
                                if (isMulti) {
                                    val next = selectedSet.toMutableSet()
                                    val ch = keyUp.firstOrNull()
                                    if (ch != null) {
                                        if (ch in next) next.remove(ch) else next.add(ch)
                                    }
                                    onAnswerChange(next.sorted().joinToString(""))
                                } else {
                                    onAnswerChange(keyUp)
                                }
                            },
                        shape = RoundedCornerShape(10.dp),
                        color = if (isSelected) palette.brandSoft else palette.cardElevated,
                        border = BorderStroke(
                            width = if (isSelected) 1.5.dp else 1.dp,
                            color = if (isSelected) palette.brand else palette.border
                        )
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 11.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(26.dp)
                                    .clip(if (isMulti) RoundedCornerShape(6.dp) else CircleShape)
                                    .background(if (isSelected) palette.brand else palette.card)
                                    .border(
                                        1.dp,
                                        if (isSelected) palette.brand else palette.borderInput,
                                        if (isMulti) RoundedCornerShape(6.dp) else CircleShape
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = opt.key,
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (isSelected) Color.White else palette.textSecondary
                                )
                            }
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                text = opt.content,
                                fontSize = 14.sp,
                                color = palette.textPrimary,
                                lineHeight = 20.sp
                            )
                        }
                    }
                }
            }
        }
    }
}
