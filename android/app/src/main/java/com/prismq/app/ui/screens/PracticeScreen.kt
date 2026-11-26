package com.prismq.app.ui.screens

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.DragInteraction
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.automirrored.filled.MenuBook
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.Tune
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SheetState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.prismq.app.data.model.AiExplainRequest
import com.prismq.app.data.model.AiExplainResponse
import com.prismq.app.data.model.QuestionItem
import com.prismq.app.data.model.QuestionOption
import com.prismq.app.data.model.QuestionRecordState
import com.prismq.app.data.model.ResetPracticeProgressRequest
import com.prismq.app.data.model.SaveNoteRequest
import com.prismq.app.data.model.SavePracticeProgressRequest
import com.prismq.app.data.model.SubmitPracticeAnswerRequest
import com.prismq.app.data.model.SubmitPracticeAnswerResponse
import com.prismq.app.data.model.ToggleQuestionRequest
import com.prismq.app.data.model.UpdateSettingsRequest
import com.prismq.app.data.model.difficultyLabel
import com.prismq.app.data.model.questionTypeLabel
import com.prismq.app.data.remote.ApiClient
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.components.FormattedContentText
import com.prismq.app.ui.components.KsbBadge
import com.prismq.app.ui.components.KsbBanner
import com.prismq.app.ui.components.KsbCard
import com.prismq.app.ui.components.KsbLoadingView
import com.prismq.app.ui.components.KsbOutlineButton
import com.prismq.app.ui.components.KsbPrimaryButton
import com.prismq.app.ui.theme.KsbTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.Random

private val SHEET_TYPE_ORDER = listOf("single", "multiple", "boolean", "fill", "short")
private val SWITCH_SPEED_PRESETS = listOf(
    0 to "极速无动画",
    180 to "轻快 (180ms)",
    260 to "丝滑 (260ms)",
    420 to "柔和 (420ms)"
)
private val AUTO_NEXT_DELAY_PRESETS = listOf(
    250 to "极快 0.25s",
    450 to "较快 0.45s",
    650 to "标准 0.65s",
    1200 to "偏慢 1.2s"
)

private fun parseRecordedSelectedKeys(type: String, recordedAnswer: String?): List<String> {
    val raw = recordedAnswer?.trim().orEmpty().uppercase()
    if (raw.isEmpty()) return emptyList()
    return when (type) {
        "multiple" -> raw.filter { it in 'A'..'H' }.map { it.toString() }.distinct().sorted()
        "single", "boolean" -> {
            val firstLetter = raw.firstOrNull { it in 'A'..'H' }
            if (firstLetter != null) listOf(firstLetter.toString()) else listOf(raw)
        }
        else -> emptyList()
    }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PracticeScreen(
    bankId: String,
    mode: String,
    initialRecite: Boolean,
    chapterId: String?,
    typeFilter: String?,
    difficultyTierFilter: String?,
    minStarFilter: Int,
    launchKey: Long = 0L,
    viewModel: MainViewModel,
    onBack: () -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    var questions by remember { mutableStateOf<List<QuestionItem>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    var reciteMode by remember { mutableStateOf(initialRecite) }
    var shuffleQuestions by remember { mutableStateOf(mode == "random") }
    var shuffleNonce by remember { mutableIntStateOf(0) }
    var shuffleOptions by remember { mutableStateOf(mode == "random") }
    var excludeMastered by remember { mutableStateOf(mode == "unmastered") }
    var onlyUnanswered by remember { mutableStateOf(mode == "unanswered") }
    var sortBy by remember {
        mutableStateOf(
            when (mode) {
                "difficulty_asc" -> "difficulty_asc"
                "difficulty_desc" -> "difficulty_desc"
                else -> "default"
            }
        )
    }
    var canEditBank by remember { mutableStateOf(false) }

    var showSheet by remember { mutableStateOf(false) }
    var showPrefsSheet by remember { mutableStateOf(false) }
    var showCompletionDialog by remember { mutableStateOf(false) }
    var showResetConfirmDialog by remember { mutableStateOf(false) }
    var resettingProgress by remember { mutableStateOf(false) }
    var progressClearedForRound by remember { mutableStateOf(false) }
    var completionSnapshot by remember { mutableStateOf<Triple<Int, Int, Int>?>(null) }
    var completionShownForRound by remember { mutableStateOf(false) }
    var showNoteDialog by remember { mutableStateOf(false) }
    var noteDraft by remember { mutableStateOf("") }
    var savingNote by remember { mutableStateOf(false) }
    var jumpNumberInput by remember { mutableStateOf("") }

    val submittedMap = remember { mutableStateMapOf<String, SubmitPracticeAnswerResponse>() }
    val redoIds = remember { mutableStateMapOf<String, Boolean>() }
    val submittingIds = remember { mutableStateMapOf<String, Boolean>() }
    val aiExplainMap = remember { mutableStateMapOf<String, AiExplainResponse>() }
    val aiErrorMap = remember { mutableStateMapOf<String, String>() }
    val aiLoadingMap = remember { mutableStateMapOf<String, Boolean>() }

    var autoNextJob by remember { mutableStateOf<Job?>(null) }
    var initialIndex by remember { mutableIntStateOf(0) }
    var sessionVersion by remember { mutableIntStateOf(0) }

    LaunchedEffect(
        launchKey,
        bankId,
        mode,
        sortBy,
        shuffleQuestions,
        shuffleNonce,
        chapterId,
        typeFilter,
        difficultyTierFilter,
        minStarFilter,
        excludeMastered,
        onlyUnanswered
    ) {
        autoNextJob?.cancel()
        loading = true
        errorMsg = null
        showCompletionDialog = false
        completionShownForRound = false
        progressClearedForRound = false
        completionSnapshot = null
        submittedMap.clear()
        redoIds.clear()
        submittingIds.clear()
        try {
            val res = viewModel.api().getPracticeSession(
                bankId = bankId,
                mode = mode,
                sortBy = if (sortBy != "default") sortBy else null,
                shuffleQuestions = if (shuffleQuestions) true else null,
                chapterId = chapterId,
                type = typeFilter,
                difficultyTier = difficultyTierFilter,
                minStar = if (minStarFilter > 0) minStarFilter else null,
                excludeMastered = if (excludeMastered) true else null,
                onlyUnanswered = if (onlyUnanswered) true else null
            )
            questions = res.questions
            val isResumableMode = !shuffleQuestions && (mode == "sequential" || mode == "difficulty_asc" || mode == "difficulty_desc")
            initialIndex = if (isResumableMode && res.questions.isNotEmpty()) {
                when {
                    res.lastProgressIndex in res.questions.indices -> res.lastProgressIndex
                    res.nextUnansweredIndex in res.questions.indices -> res.nextUnansweredIndex
                    else -> 0
                }
            } else 0
            sessionVersion += 1
            if (bankId != "all") {
                try {
                    canEditBank = viewModel.api().getBankDetail(bankId).bank.canEdit
                } catch (_: Exception) {
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            errorMsg = ApiClient.parseError(e)
        } finally {
            loading = false
        }
    }

    val eyeCare = viewModel.eyeCare
    val fontSize = viewModel.fontSize
    val bgColor = if (eyeCare) palette.eyeCareBg else palette.canvas
    val cardBg = if (eyeCare) palette.eyeCareCard else palette.card
    val cardBorder = if (eyeCare) palette.eyeCareBorder else palette.border

    val pagerState = rememberPagerState(
        initialPage = initialIndex,
        pageCount = { maxOf(1, questions.size) }
    )

    // 仅在会话重新加载时定位初始断点，避免答对/收藏/笔记触发 updateRecord 后误跳回断点
    LaunchedEffect(sessionVersion) {
        if (sessionVersion > 0 && questions.isNotEmpty()) {
            pagerState.scrollToPage(initialIndex.coerceIn(0, questions.lastIndex))
        }
    }

    val effectiveProgressMode = if (sortBy != "default") sortBy else mode

    // 仅在用户主动拖拽翻页时取消待执行的自动切题，防止 animateScrollToPage 中途 currentPage 切换自我取消导致卡在半屏
    LaunchedEffect(pagerState.interactionSource) {
        try {
            pagerState.interactionSource.interactions.collect { interaction ->
                if (interaction is DragInteraction.Start) {
                    autoNextJob?.cancel()
                }
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
        }
    }

    // 仅在页面完全稳定停靠（settledPage）后防抖保存断点，保证 120fps 滑动零额外计算开销
    LaunchedEffect(pagerState.settledPage, sessionVersion, effectiveProgressMode) {
        val page = pagerState.settledPage
        val resumable = mode == "sequential" || mode == "difficulty_asc" || mode == "difficulty_desc"
        if (
            sessionVersion > 0 &&
            questions.isNotEmpty() &&
            bankId != "all" &&
            !shuffleQuestions &&
            resumable &&
            chapterId == null &&
            typeFilter == null &&
            difficultyTierFilter == null &&
            minStarFilter == 0 &&
            !excludeMastered &&
            !onlyUnanswered &&
            !progressClearedForRound
        ) {
            delay(400L)
            if (pagerState.settledPage == page) {
                try {
                    viewModel.api().savePracticeProgress(
                        SavePracticeProgressRequest(
                            bankId = bankId,
                            currentIndex = page,
                            mode = effectiveProgressMode
                        )
                    )
                } catch (_: Exception) {
                }
            }
        }
    }

    val currentIdx = pagerState.currentPage.coerceIn(0, maxOf(0, questions.lastIndex))
    val currentQ = questions.getOrNull(currentIdx)
    val autoNext = viewModel.currentUser?.settings?.autoNextOnCorrect ?: true
    val switchAnimMs = viewModel.switchAnimationMs
    val autoNextDelayMs = viewModel.autoNextDelayMs

    fun updateRecord(qId: String, updater: (QuestionRecordState?) -> QuestionRecordState) {
        questions = questions.map { item ->
            if (item.id == qId) item.copy(record = updater(item.record)) else item
        }
    }

    fun animateJumpTo(targetPage: Int) {
        autoNextJob?.cancel()
        if (questions.isEmpty()) return
        val clamped = targetPage.coerceIn(0, questions.lastIndex)
        scope.launch {
            if (switchAnimMs <= 0) {
                pagerState.scrollToPage(clamped)
            } else {
                val spec = if (switchAnimMs == 260) {
                    spring<Float>(
                        dampingRatio = Spring.DampingRatioNoBouncy,
                        stiffness = Spring.StiffnessMediumLow
                    )
                } else {
                    tween(durationMillis = switchAnimMs)
                }
                pagerState.animateScrollToPage(
                    page = clamped,
                    animationSpec = spec
                )
            }
        }
    }

    fun jumpFromSheet(targetPage: Int, sheetState: SheetState) {
        autoNextJob?.cancel()
        if (questions.isEmpty()) {
            showSheet = false
            return
        }
        val clamped = targetPage.coerceIn(0, questions.lastIndex)
        scope.launch {
            try {
                pagerState.scrollToPage(clamped)
            } finally {
                try {
                    sheetState.hide()
                } catch (_: Exception) {
                }
                showSheet = false
            }
        }
    }

    fun syncTimingToServer(nextAutoDelay: Int, nextSwitchAnim: Int) {
        viewModel.updatePracticeTiming(nextAutoDelay, nextSwitchAnim)
        scope.launch {
            try {
                val res = viewModel.api().updateSettings(
                    UpdateSettingsRequest(
                        autoNextDelayMs = nextAutoDelay,
                        switchAnimationMs = nextSwitchAnim
                    )
                )
                viewModel.replaceUser(res.user)
            } catch (_: Exception) {
            }
        }
    }

    suspend fun resetProgressOnServer() {
        if (questions.isEmpty() && bankId == "all") return
        try {
            viewModel.api().resetPracticeProgress(
                ResetPracticeProgressRequest(
                    bankId = bankId,
                    mode = effectiveProgressMode,
                    questionIds = if (bankId == "all") questions.map { it.id } else null
                )
            )
        } catch (_: Exception) {
        }
    }

    fun clearLocalAndRestart(reshuffle: Boolean) {
        autoNextJob?.cancel()
        showCompletionDialog = false
        completionShownForRound = false
        progressClearedForRound = false
        completionSnapshot = null
        submittedMap.clear()
        questions = questions.map { item ->
            redoIds[item.id] = true
            item.copy(
                record = item.record?.copy(
                    answeredCount = 0,
                    lastAnswer = null,
                    lastIsCorrect = null
                )
            )
        }
        scope.launch {
            if (questions.isNotEmpty()) {
                pagerState.scrollToPage(0)
            }
        }
        if (reshuffle) {
            if (!shuffleQuestions) {
                shuffleQuestions = true
            } else {
                shuffleNonce += 1
            }
        }
    }

    fun openCompletionAndClear() {
        autoNextJob?.cancel()
        val roundAnswered = questions.count { item ->
            redoIds[item.id] != true && (submittedMap.containsKey(item.id) || (item.record?.answeredCount ?: 0) > 0)
        }
        val roundCorrect = questions.count { item ->
            if (redoIds[item.id] == true) false
            else submittedMap[item.id]?.isCorrect ?: (item.record?.lastIsCorrect == true)
        }
        completionSnapshot = Triple(roundAnswered, roundCorrect, questions.size)
        progressClearedForRound = true
        scope.launch { resetProgressOnServer() }
        showCompletionDialog = true
    }

    Scaffold(
        containerColor = bgColor,
        topBar = {
            Column(modifier = Modifier.background(bgColor)) {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = bgColor),
                    title = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Text(
                                text = if (reciteMode) "背题" else "刷题",
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold,
                                color = palette.textPrimary
                            )
                            if (questions.isNotEmpty()) {
                                KsbBadge(text = "${currentIdx + 1}/${questions.size}")
                            }
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = palette.textPrimary)
                        }
                    },
                    actions = {
                        IconButton(
                            onClick = { showResetConfirmDialog = true },
                            enabled = !resettingProgress && questions.isNotEmpty()
                        ) {
                            Icon(Icons.Default.Refresh, contentDescription = "一键重置进度", tint = palette.textPrimary)
                        }
                        IconButton(onClick = { showPrefsSheet = true }) {
                            Icon(Icons.Default.Tune, contentDescription = "刷题偏好与动画速度", tint = palette.brand)
                        }
                    }
                )
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    FilterChip(
                        selected = reciteMode,
                        onClick = { reciteMode = !reciteMode },
                        shape = RoundedCornerShape(50),
                        leadingIcon = { Icon(Icons.AutoMirrored.Filled.MenuBook, contentDescription = null, modifier = Modifier.size(15.dp)) },
                        label = { Text(if (reciteMode) "背题中" else "背题", fontSize = 12.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = palette.successBg,
                            selectedLabelColor = palette.success
                        )
                    )
                    FilterChip(
                        selected = shuffleQuestions,
                        onClick = {
                            if (!shuffleQuestions) {
                                shuffleQuestions = true
                            } else {
                                shuffleNonce += 1
                            }
                        },
                        shape = RoundedCornerShape(50),
                        leadingIcon = { Icon(Icons.Default.Shuffle, contentDescription = null, modifier = Modifier.size(15.dp)) },
                        label = { Text(if (shuffleQuestions) "重新洗牌" else "乱序出题", fontSize = 12.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = palette.aiBg,
                            selectedLabelColor = palette.ai
                        )
                    )
                    FilterChip(
                        selected = shuffleOptions,
                        onClick = { shuffleOptions = !shuffleOptions },
                        shape = RoundedCornerShape(50),
                        leadingIcon = { Icon(Icons.Default.Shuffle, contentDescription = null, modifier = Modifier.size(15.dp)) },
                        label = { Text("选项乱序", fontSize = 12.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = palette.brandSoft,
                            selectedLabelColor = palette.brandDark
                        )
                    )
                    FilterChip(
                        selected = excludeMastered,
                        onClick = { excludeMastered = !excludeMastered },
                        shape = RoundedCornerShape(50),
                        leadingIcon = { Icon(Icons.Default.ContentCut, contentDescription = null, modifier = Modifier.size(15.dp)) },
                        label = { Text("未斩题", fontSize = 12.sp) }
                    )
                    FilterChip(
                        selected = onlyUnanswered,
                        onClick = { onlyUnanswered = !onlyUnanswered },
                        shape = RoundedCornerShape(50),
                        label = { Text("仅未做", fontSize = 12.sp) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = palette.brandSoft,
                            selectedLabelColor = palette.brandDark
                        )
                    )
                    if (mode == "sequential" || mode == "difficulty_asc" || mode == "difficulty_desc") {
                        listOf(
                            "default" to "默认序",
                            "difficulty_asc" to "由易到难",
                            "difficulty_desc" to "由难到易"
                        ).forEach { (key, label) ->
                            FilterChip(
                                selected = sortBy == key,
                                onClick = { sortBy = key },
                                shape = RoundedCornerShape(50),
                                label = { Text(label, fontSize = 12.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = palette.brandSoft,
                                    selectedLabelColor = palette.brandDark
                                )
                            )
                        }
                    }
                }
            }
        },
        bottomBar = {
            if (questions.isNotEmpty() && currentQ != null) {
                Surface(
                    color = palette.card,
                    shadowElevation = 0.dp
                ) {
                    Column {
                        HorizontalDivider(thickness = 0.5.dp, color = palette.border)
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .navigationBarsPadding()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                        IconButton(
                            enabled = currentIdx > 0,
                            onClick = { animateJumpTo(currentIdx - 1) }
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "上一题",
                                tint = if (currentIdx > 0) palette.textPrimary else palette.textMuted
                            )
                        }

                        Row(verticalAlignment = Alignment.CenterVertically) {
                            val isFav = currentQ.record?.isFavorited == true
                            val isMast = currentQ.record?.isMastered == true
                            IconButton(
                                onClick = {
                                    scope.launch {
                                        try {
                                            val res = viewModel.api().toggleQuestionState(
                                                ToggleQuestionRequest(currentQ.id, "favorite")
                                            )
                                            updateRecord(currentQ.id) { old ->
                                                (old ?: QuestionRecordState()).copy(
                                                    isFavorited = res.isFavorited,
                                                    isMastered = res.isMastered
                                                )
                                            }
                                        } catch (e: Exception) {
                                            errorMsg = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            ) {
                                Icon(
                                    imageVector = if (isFav) Icons.Default.Bookmark else Icons.Default.BookmarkBorder,
                                    contentDescription = "收藏",
                                    tint = if (isFav) palette.warning else palette.textSecondary
                                )
                            }

                            IconButton(
                                onClick = {
                                    scope.launch {
                                        try {
                                            val res = viewModel.api().toggleQuestionState(
                                                ToggleQuestionRequest(currentQ.id, "master")
                                            )
                                            updateRecord(currentQ.id) { old ->
                                                (old ?: QuestionRecordState()).copy(
                                                    isFavorited = res.isFavorited,
                                                    isMastered = res.isMastered
                                                )
                                            }
                                        } catch (e: Exception) {
                                            errorMsg = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            ) {
                                Icon(
                                    imageVector = Icons.Default.ContentCut,
                                    contentDescription = "斩题",
                                    tint = if (isMast) palette.success else palette.textSecondary
                                )
                            }

                            IconButton(
                                onClick = {
                                    noteDraft = currentQ.record?.note ?: ""
                                    showNoteDialog = true
                                }
                            ) {
                                Icon(
                                    imageVector = Icons.Default.EditNote,
                                    contentDescription = "笔记",
                                    tint = if (!currentQ.record?.note.isNullOrBlank()) palette.brand else palette.textSecondary
                                )
                            }
                        }

                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = palette.brandSoft,
                            border = BorderStroke(1.dp, palette.brandBorder),
                            modifier = Modifier.clickable {
                                jumpNumberInput = ""
                                showSheet = true
                            }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(5.dp)
                            ) {
                                Icon(Icons.Default.GridView, contentDescription = null, tint = palette.brand, modifier = Modifier.size(16.dp))
                                Text(
                                    text = "${currentIdx + 1}/${questions.size}",
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = palette.brandDark
                                )
                            }
                        }

                        if (currentIdx < questions.lastIndex) {
                            IconButton(
                                onClick = { animateJumpTo(currentIdx + 1) }
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.ArrowForward,
                                    contentDescription = "下一题",
                                    tint = palette.textPrimary
                                )
                            }
                        } else {
                            TextButton(
                                onClick = { openCompletionAndClear() }
                            ) {
                                Text(
                                    text = "完成",
                                    fontSize = 13.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = palette.brand
                                )
                            }
                        }
                    }
                    }
                }
            }
        }
    ) { innerPad ->
        if (loading) {
            Box(modifier = Modifier.padding(innerPad).fillMaxSize()) {
                KsbLoadingView("正在加载题目队列...")
            }
            return@Scaffold
        }

        if (questions.isEmpty()) {
            Box(modifier = Modifier.padding(innerPad).padding(16.dp).fillMaxSize()) {
                KsbBanner(
                    text = errorMsg ?: if (onlyUnanswered) "当前题目已全部作答完成" else "当前筛选模式下没有可练习的题目",
                    isError = errorMsg != null
                )
            }
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad)
        ) {
            errorMsg?.let { msg ->
                Box(modifier = Modifier.padding(horizontal = 14.dp, vertical = 6.dp)) {
                    KsbBanner(text = msg, isError = true)
                }
            }

            // 双侧预加载 1 题 + 间距 12.dp，保证手机左右滑屏接力丝滑不留白
            HorizontalPager(
                state = pagerState,
                beyondViewportPageCount = 1,
                pageSpacing = 12.dp,
                key = { idx ->
                    questions.getOrNull(idx)?.let { "${sessionVersion}_${it.id}_$idx" } ?: "empty_$idx"
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
            ) { pageIdx ->
                val q = questions.getOrNull(pageIdx) ?: return@HorizontalPager
                val isRedo = redoIds[q.id] == true
                val submitted = if (isRedo) null else submittedMap[q.id]
                val hasHistory = !isRedo &&
                    submitted == null &&
                    q.record != null &&
                    q.record.answeredCount > 0 &&
                    q.record.lastIsCorrect != null
                val showReveal = reciteMode || submitted != null || hasHistory
                val recordedAnswer = if (isRedo) null else (submitted?.record?.lastAnswer ?: q.record?.lastAnswer)

                PracticeQuestionPage(
                    question = q,
                    index = pageIdx,
                    total = questions.size,
                    reciteMode = reciteMode,
                    shuffleOptions = shuffleOptions,
                    showReveal = showReveal,
                    hasHistory = hasHistory,
                    recordedAnswer = recordedAnswer,
                    attemptVersion = if (isRedo) 1 else 0,
                    isSubmitting = submittingIds[q.id] == true,
                    submitted = submitted,
                    fontSize = fontSize,
                    cardBg = cardBg,
                    cardBorder = cardBorder,
                    eyeCare = eyeCare,
                    canEditBank = canEditBank,
                    aiExplain = aiExplainMap[q.id],
                    aiError = aiErrorMap[q.id],
                    aiLoading = aiLoadingMap[q.id] == true,
                    onRedo = {
                        autoNextJob?.cancel()
                        redoIds[q.id] = true
                        submittedMap.remove(q.id)
                    },
                    onSubmitAnswer = { answer ->
                        if (submittingIds[q.id] == true) return@PracticeQuestionPage
                        autoNextJob?.cancel()
                        submittingIds[q.id] = true
                        errorMsg = null
                        scope.launch {
                            try {
                                val res = viewModel.api().submitPracticeAnswer(
                                    SubmitPracticeAnswerRequest(
                                        questionId = q.id,
                                        answer = answer,
                                        currentIndex = pageIdx,
                                        mode = effectiveProgressMode
                                    )
                                )
                                redoIds.remove(q.id)
                                submittedMap[q.id] = res
                                updateRecord(q.id) { res.record }
                                val allDone = questions.isNotEmpty() && questions.all { item ->
                                    val rec = if (item.id == q.id) res.record else item.record
                                    redoIds[item.id] != true && (submittedMap.containsKey(item.id) || (rec?.answeredCount ?: 0) > 0)
                                }
                                if ((pageIdx >= questions.lastIndex || allDone) && !completionShownForRound) {
                                    completionShownForRound = true
                                    progressClearedForRound = true
                                    delay(360L)
                                    openCompletionAndClear()
                                } else {
                                    progressClearedForRound = false
                                    if (res.isCorrect && autoNext && !reciteMode && pageIdx < questions.lastIndex) {
                                        autoNextJob = scope.launch {
                                            delay(autoNextDelayMs.toLong())
                                            if (pagerState.settledPage == pageIdx && !pagerState.isScrollInProgress && !reciteMode && !showSheet) {
                                                if (switchAnimMs <= 0) {
                                                    pagerState.scrollToPage(pageIdx + 1)
                                                } else if (switchAnimMs == 260) {
                                                    pagerState.animateScrollToPage(
                                                        page = pageIdx + 1,
                                                        animationSpec = spring(
                                                            dampingRatio = Spring.DampingRatioNoBouncy,
                                                            stiffness = Spring.StiffnessMediumLow
                                                        )
                                                    )
                                                } else {
                                                    pagerState.animateScrollToPage(
                                                        page = pageIdx + 1,
                                                        animationSpec = tween(durationMillis = switchAnimMs)
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            } catch (e: Exception) {
                                errorMsg = ApiClient.parseError(e)
                            } finally {
                                submittingIds[q.id] = false
                            }
                        }
                    },
                    onAskAiExplain = { saveToQ ->
                        aiLoadingMap[q.id] = true
                        aiErrorMap.remove(q.id)
                        scope.launch {
                            try {
                                val res = viewModel.api().explainQuestion(
                                    AiExplainRequest(
                                        questionId = q.id,
                                        userAnswer = submitted?.record?.lastAnswer ?: q.record?.lastAnswer,
                                        saveToQuestion = saveToQ
                                    )
                                )
                                aiExplainMap[q.id] = res
                            } catch (e: Exception) {
                                aiErrorMap[q.id] = ApiClient.parseError(e)
                            } finally {
                                aiLoadingMap[q.id] = false
                            }
                        }
                    }
                )
            }
        }
    }

    // 刷题偏好与动画速度设置抽屉
    if (showPrefsSheet) {
        ModalBottomSheet(
            onDismissRequest = { showPrefsSheet = false },
            containerColor = palette.card
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("刷题外观与切题节奏", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("每次刷题乱序出题", fontSize = 13.sp, color = palette.textPrimary)
                    Switch(checked = shuffleQuestions, onCheckedChange = { shuffleQuestions = it })
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("黑夜模式（Obsidian）", fontSize = 13.sp, color = palette.textPrimary)
                    Switch(checked = viewModel.darkMode, onCheckedChange = { viewModel.setDarkModeEnabled(it) })
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("护眼底色", fontSize = 13.sp, color = palette.textPrimary)
                    Switch(checked = eyeCare, onCheckedChange = { viewModel.updatePracticeAppearance(fontSize, it) })
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("字号大小", fontSize = 13.sp, color = palette.textPrimary)
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf("sm" to "小 A-", "md" to "中 A", "lg" to "大 A+").forEach { (sz, label) ->
                            FilterChip(
                                selected = fontSize == sz,
                                onClick = { viewModel.updatePracticeAppearance(sz, eyeCare) },
                                label = { Text(label, fontSize = 12.sp) }
                            )
                        }
                    }
                }

                Text("切题动画时长", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = palette.textSecondary)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    SWITCH_SPEED_PRESETS.forEach { (ms, label) ->
                        FilterChip(
                            selected = switchAnimMs == ms,
                            onClick = { syncTimingToServer(autoNextDelayMs, ms) },
                            label = { Text(label, fontSize = 11.sp) }
                        )
                    }
                }

                Text("答对自动跳下一题延迟", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = palette.textSecondary)
                Row(
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    AUTO_NEXT_DELAY_PRESETS.forEach { (ms, label) ->
                        FilterChip(
                            selected = autoNextDelayMs == ms,
                            onClick = { syncTimingToServer(ms, switchAnimMs) },
                            label = { Text(label, fontSize = 11.sp) }
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))
            }
        }
    }

    // 按题型分组的答题卡 ModalBottomSheet（含直达题号跳转 & 跳至首个未做）
    if (showSheet && questions.isNotEmpty()) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        val correctCnt = questions.count { it.record?.lastIsCorrect == true }
        val wrongCnt = questions.count { it.record?.lastIsCorrect == false }
        val doneCnt = correctCnt + wrongCnt
        val todoCnt = questions.size - doneCnt
        val firstUnansweredIdx = questions.indexOfFirst { (it.record?.answeredCount ?: 0) == 0 }
        val grouped = remember(questions) {
            val baseGroups = SHEET_TYPE_ORDER.mapNotNull { t ->
                val list = questions.mapIndexedNotNull { idx, item ->
                    if (item.type == t) idx to item else null
                }
                if (list.isEmpty()) null else questionTypeLabel(t) to list
            }
            val otherList = questions.mapIndexedNotNull { idx, item ->
                if (item.type !in SHEET_TYPE_ORDER) idx to item else null
            }
            if (otherList.isNotEmpty()) baseGroups + ("其他题型" to otherList) else baseGroups
        }

        ModalBottomSheet(
            onDismissRequest = { showSheet = false },
            sheetState = sheetState,
            containerColor = palette.card
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("答题卡", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        if (firstUnansweredIdx >= 0) {
                            KsbOutlineButton(
                                text = "跳未做 #${firstUnansweredIdx + 1}",
                                onClick = { jumpFromSheet(firstUnansweredIdx, sheetState) }
                            )
                        }
                        KsbBadge(text = "已做 $doneCnt / ${questions.size}")
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { (doneCnt.toFloat() / questions.size).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(4.dp)),
                    color = palette.brand,
                    trackColor = palette.cardElevated
                )
                Spacer(modifier = Modifier.height(10.dp))

                // 快捷输入题号跳转
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = jumpNumberInput,
                        onValueChange = { raw -> jumpNumberInput = raw.filter { it.isDigit() }.take(5) },
                        placeholder = { Text("输入题号 1~${questions.size}", fontSize = 12.sp) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.weight(1f)
                    )
                    val targetNum = jumpNumberInput.toIntOrNull()
                    KsbPrimaryButton(
                        text = "跳转",
                        enabled = targetNum != null && targetNum in 1..questions.size,
                        onClick = {
                            if (targetNum != null && targetNum in 1..questions.size) {
                                jumpFromSheet(targetNum - 1, sheetState)
                            }
                        }
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("对 $correctCnt", fontSize = 12.sp, color = palette.success, fontWeight = FontWeight.SemiBold)
                    Text("错 $wrongCnt", fontSize = 12.sp, color = palette.error, fontWeight = FontWeight.SemiBold)
                    Text("未做 $todoCnt", fontSize = 12.sp, color = palette.textSecondary)
                }
                Spacer(modifier = Modifier.height(10.dp))
                HorizontalDivider(color = palette.border)
                Spacer(modifier = Modifier.height(10.dp))

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(290.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    grouped.forEach { (typeTitle, items) ->
                        Column {
                            Text(
                                text = "$typeTitle (${items.size})",
                                fontSize = 12.sp,
                                fontWeight = FontWeight.Bold,
                                color = palette.textSecondary
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp),
                                modifier = Modifier.padding(2.dp)
                            ) {
                                items.forEach { (idx, item) ->
                                    val isCur = idx == currentIdx
                                    val isRight = item.record?.lastIsCorrect == true
                                    val isWrong = item.record?.lastIsCorrect == false
                                    val cellBg = when {
                                        isCur && !isRight && !isWrong -> palette.brand
                                        isRight -> palette.successBg
                                        isWrong -> palette.errorBg
                                        else -> palette.cardElevated
                                    }
                                    val cellBorder = when {
                                        isCur -> palette.brand
                                        isRight -> palette.success
                                        isWrong -> palette.error
                                        else -> palette.borderInput
                                    }
                                    val cellFg = when {
                                        isCur && !isRight && !isWrong -> Color.White
                                        isRight -> palette.success
                                        isWrong -> palette.error
                                        else -> palette.textSecondary
                                    }
                                    Box(
                                        modifier = Modifier
                                            .size(40.dp)
                                            .background(cellBg, RoundedCornerShape(8.dp))
                                            .border(if (isCur) 2.dp else 1.dp, cellBorder, RoundedCornerShape(8.dp))
                                            .clickable { jumpFromSheet(idx, sheetState) },
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Text(
                                            text = "${idx + 1}",
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = cellFg,
                                            textDecoration = if (item.record?.isMastered == true) TextDecoration.LineThrough else null
                                        )
                                        if (item.record?.isFavorited == true) {
                                            Box(
                                                modifier = Modifier
                                                    .align(Alignment.TopEnd)
                                                    .padding(3.dp)
                                                    .size(6.dp)
                                                    .background(palette.warning, CircleShape)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
            }
        }
    }

    if (showCompletionDialog && questions.isNotEmpty()) {
        val snap = completionSnapshot ?: Triple(
            questions.count { item ->
                redoIds[item.id] != true && (submittedMap.containsKey(item.id) || (item.record?.answeredCount ?: 0) > 0)
            },
            questions.count { item ->
                if (redoIds[item.id] == true) false
                else submittedMap[item.id]?.isCorrect ?: (item.record?.lastIsCorrect == true)
            },
            questions.size
        )
        val roundAnswered = snap.first
        val roundCorrect = snap.second
        val roundTotal = snap.third
        val roundAcc = if (roundAnswered > 0) (roundCorrect * 100 / roundAnswered) else 0
        val encourageTitle = when {
            roundAcc >= 90 && roundAnswered > 0 -> "恭喜完成！表现惊艳"
            roundAcc >= 70 -> "恭喜完成！干得漂亮"
            roundAnswered == 0 -> "恭喜完成本轮浏览"
            else -> "恭喜完成！坚持就是胜利"
        }
        val encourageDesc = when {
            roundAcc >= 90 && roundAnswered > 0 -> "正确率高达 $roundAcc%，知识点掌握得非常扎实，继续保持！"
            roundAcc >= 70 -> "本轮正确率 $roundAcc%，再巩固一轮错题会更稳！"
            roundAnswered == 0 -> "可以随时再来一轮作答，或切到背题模式巩固记忆。"
            else -> "万事开头难，复盘解析后再来一轮，提升会非常明显！"
        }
        AlertDialog(
            onDismissRequest = { showCompletionDialog = false },
            containerColor = palette.card,
            title = {
                Text(encourageTitle, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
            },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(encourageDesc, fontSize = 13.sp, lineHeight = 19.sp, color = palette.textSecondary)
                    Text(
                        text = "本轮已答 $roundAnswered/$roundTotal 题 · 答对 $roundCorrect 题 · 正确率 $roundAcc%",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = palette.brand
                    )
                    Text(
                        text = "本轮刷题进度已自动清空，下次进入将从第 1 题开始",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium,
                        color = palette.success
                    )
                }
            },
            confirmButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = { clearLocalAndRestart(true) }) {
                        Text("乱序重刷", color = palette.ai, fontWeight = FontWeight.Bold)
                    }
                    TextButton(onClick = { clearLocalAndRestart(false) }) {
                        Text("立即重刷", color = palette.brand, fontWeight = FontWeight.Bold)
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = {
                        showCompletionDialog = false
                        onBack()
                    }
                ) {
                    Text("返回题库", color = palette.textSecondary)
                }
            }
        )
    }

    if (showResetConfirmDialog) {
        AlertDialog(
            onDismissRequest = { if (!resettingProgress) showResetConfirmDialog = false },
            containerColor = palette.card,
            title = {
                Text("一键重置进度", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
            },
            text = {
                Text(
                    "确认清空当前刷题进度并从第 1 题重新开始吗？（收藏、笔记与错题本不受影响）",
                    fontSize = 13.sp,
                    lineHeight = 19.sp,
                    color = palette.textSecondary
                )
            },
            confirmButton = {
                TextButton(
                    enabled = !resettingProgress,
                    onClick = {
                        resettingProgress = true
                        scope.launch {
                            try {
                                progressClearedForRound = true
                                resetProgressOnServer()
                                clearLocalAndRestart(shuffleQuestions)
                            } finally {
                                resettingProgress = false
                                showResetConfirmDialog = false
                            }
                        }
                    }
                ) {
                    Text(if (resettingProgress) "清空中..." else "确认重置", color = palette.error, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(
                    enabled = !resettingProgress,
                    onClick = { showResetConfirmDialog = false }
                ) {
                    Text("取消", color = palette.textSecondary)
                }
            }
        )
    }

    if (showNoteDialog && currentQ != null) {
        AlertDialog(
            onDismissRequest = { showNoteDialog = false },
            title = { Text("我的备考笔记", fontWeight = FontWeight.Bold) },
            text = {
                OutlinedTextField(
                    value = noteDraft,
                    onValueChange = { noteDraft = it },
                    placeholder = { Text("记录易错细节或记忆口诀...") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = "保存",
                    loading = savingNote,
                    onClick = {
                        savingNote = true
                        scope.launch {
                            try {
                                viewModel.api().saveNote(SaveNoteRequest(currentQ.id, noteDraft))
                                updateRecord(currentQ.id) { old ->
                                    (old ?: QuestionRecordState()).copy(note = noteDraft)
                                }
                                showNoteDialog = false
                            } catch (e: Exception) {
                                errorMsg = ApiClient.parseError(e)
                            } finally {
                                savingNote = false
                            }
                        }
                    }
                )
            },
            dismissButton = {
                TextButton(onClick = { showNoteDialog = false }) { Text("取消") }
            }
        )
    }
}

@Composable
private fun PracticeQuestionPage(
    question: QuestionItem,
    index: Int,
    total: Int,
    reciteMode: Boolean,
    shuffleOptions: Boolean,
    showReveal: Boolean,
    hasHistory: Boolean,
    recordedAnswer: String?,
    attemptVersion: Int,
    isSubmitting: Boolean,
    submitted: SubmitPracticeAnswerResponse?,
    fontSize: String,
    cardBg: Color,
    cardBorder: Color,
    eyeCare: Boolean,
    canEditBank: Boolean,
    aiExplain: AiExplainResponse?,
    aiError: String?,
    aiLoading: Boolean,
    onRedo: () -> Unit,
    onSubmitAnswer: (String) -> Unit,
    onAskAiExplain: (Boolean) -> Unit
) {
    val palette = KsbTheme.colors
    val stemSp = when (fontSize) {
        "sm" -> 14.sp
        "lg" -> 19.sp
        else -> 16.sp
    }
    val optSp = when (fontSize) {
        "sm" -> 13.sp
        "lg" -> 17.sp
        else -> 15.sp
    }

    val displayedOptions: List<Pair<QuestionOption, String>> = remember(question.id, shuffleOptions) {
        val opts = question.options
        if (!shuffleOptions || question.type == "boolean" || opts.size <= 1) {
            opts.mapIndexed { i, o -> o to (o.key.ifBlank { ('A' + i).toString() }) }
        } else {
            val copy = opts.toMutableList()
            copy.shuffle(Random(question.id.hashCode().toLong()))
            copy.mapIndexed { i, o -> o to ('A' + i).toString() }
        }
    }

    var selectedKeys by remember(question.id, recordedAnswer, attemptVersion) {
        mutableStateOf(parseRecordedSelectedKeys(question.type, recordedAnswer))
    }
    val blankCount = remember(question.id) {
        if (question.type == "fill") maxOf(1, question.answer.split("|").size) else 1
    }
    var fillValues by remember(question.id, recordedAnswer, attemptVersion) {
        val parts = recordedAnswer?.split("|").orEmpty()
        mutableStateOf(List(blankCount) { idx -> parts.getOrElse(idx) { "" } })
    }
    var shortText by remember(question.id, recordedAnswer, attemptVersion) {
        mutableStateOf(if (question.type == "short") recordedAnswer.orEmpty() else "")
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        KsbCard(
            containerColor = cardBg,
            borderColor = if (eyeCare) cardBorder else Color.Transparent,
            cornerRadius = 22.dp,
            contentPadding = PaddingValues(20.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    KsbBadge(
                        text = questionTypeLabel(question.type),
                        containerColor = palette.brand,
                        contentColor = Color.White
                    )
                    KsbBadge(
                        text = difficultyLabel(question.difficulty),
                        containerColor = when {
                            question.difficulty >= 4 -> palette.errorBg
                            question.difficulty <= 2 -> palette.successBg
                            else -> palette.cardElevated
                        },
                        contentColor = when {
                            question.difficulty >= 4 -> palette.error
                            question.difficulty <= 2 -> palette.success
                            else -> palette.textSecondary
                        }
                    )
                    if (question.starRating > 0) {
                        KsbBadge(
                            text = "${question.starRating}★",
                            containerColor = palette.warningBg,
                            contentColor = palette.warning
                        )
                    }
                    if (question.record != null && question.record.answeredCount > 0 && question.record.lastIsCorrect != null) {
                        KsbBadge(
                            text = if (question.record.lastIsCorrect) "已答对" else "上次答错",
                            containerColor = if (question.record.lastIsCorrect) palette.successBg else palette.errorBg,
                            contentColor = if (question.record.lastIsCorrect) palette.success else palette.error
                        )
                    }
                    Text(
                        text = "${index + 1}/$total",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.textSecondary
                    )
                }
                if (!question.chapterTitle.isNullOrBlank()) {
                    KsbBadge(text = question.chapterTitle)
                }
            }

            if (question.record?.inMistakeBook == true) {
                Spacer(modifier = Modifier.height(6.dp))
                KsbBadge(
                    text = "错题本 · 连对 ${question.record.consecutiveCorrect} 次",
                    containerColor = palette.errorBg,
                    contentColor = palette.error
                )
            }

            Spacer(modifier = Modifier.height(12.dp))
            FormattedContentText(
                text = question.stem,
                fontSize = stemSp,
                lineHeight = stemSp * 1.45f,
                fontWeight = FontWeight.Medium,
                color = palette.textPrimary
            )

            Spacer(modifier = Modifier.height(16.dp))

            val stdAnswer = (submitted?.standardAnswer ?: question.answer).uppercase()
            val isMulti = question.type == "multiple"

            if (displayedOptions.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    displayedOptions.forEach { (opt, displayKey) ->
                        val isSelected = selectedKeys.contains(opt.key.uppercase())
                        val isCorrectOpt = stdAnswer.contains(opt.key.uppercase())

                        val optBg = when {
                            showReveal && isCorrectOpt -> palette.successBg
                            showReveal && isSelected && !isCorrectOpt -> palette.errorBg
                            !showReveal && isSelected -> palette.brandSoft
                            else -> if (eyeCare) palette.eyeCareBg else palette.cardElevated
                        }
                        val optBorder = when {
                            showReveal && isCorrectOpt -> palette.success
                            showReveal && isSelected && !isCorrectOpt -> palette.error
                            !showReveal && isSelected -> palette.brand
                            else -> Color.Transparent
                        }
                        val indBg = when {
                            showReveal && isCorrectOpt -> palette.success
                            showReveal && isSelected && !isCorrectOpt -> palette.error
                            !showReveal && isSelected -> palette.brand
                            else -> cardBg
                        }
                        val indText = if ((showReveal && (isCorrectOpt || isSelected)) || (!showReveal && isSelected)) {
                            Color.White
                        } else palette.textSecondary

                        Surface(
                            shape = RoundedCornerShape(14.dp),
                            color = optBg,
                            border = if (optBorder != Color.Transparent) BorderStroke(1.dp, optBorder) else null,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable(enabled = !showReveal && !isSubmitting) {
                                    val optKeyUp = opt.key.uppercase()
                                    if (!isMulti) {
                                        selectedKeys = listOf(optKeyUp)
                                        onSubmitAnswer(optKeyUp)
                                    } else {
                                        selectedKeys = if (selectedKeys.contains(optKeyUp)) {
                                            selectedKeys - optKeyUp
                                        } else {
                                            (selectedKeys + optKeyUp).sorted()
                                        }
                                    }
                                }
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(24.dp)
                                        .background(
                                            indBg,
                                            if (isMulti) RoundedCornerShape(5.dp) else CircleShape
                                        )
                                        .border(
                                            1.dp,
                                            if (indBg == cardBg) palette.borderInput else indBg,
                                            if (isMulti) RoundedCornerShape(5.dp) else CircleShape
                                        ),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(displayKey, fontSize = 12.sp, fontWeight = FontWeight.Bold, color = indText)
                                }
                                FormattedContentText(
                                    text = "$displayKey、${opt.content}",
                                    fontSize = optSp,
                                    lineHeight = optSp * 1.4f,
                                    color = palette.textPrimary,
                                    modifier = Modifier.weight(1f)
                                )
                                if (showReveal && isCorrectOpt) {
                                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = palette.success, modifier = Modifier.size(20.dp))
                                } else if (showReveal && isSelected && !isCorrectOpt) {
                                    Icon(Icons.Default.Close, contentDescription = null, tint = palette.error, modifier = Modifier.size(20.dp))
                                }
                            }
                        }
                    }
                }

                if (isMulti && !showReveal) {
                    Spacer(modifier = Modifier.height(14.dp))
                    KsbPrimaryButton(
                        text = "提交多选答案 (${selectedKeys.joinToString("").ifEmpty { "未选" }})",
                        enabled = selectedKeys.isNotEmpty(),
                        loading = isSubmitting,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { onSubmitAnswer(selectedKeys.joinToString("")) }
                    )
                }
            }

            if (question.type == "fill" && !reciteMode) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    fillValues.forEachIndexed { idx, value ->
                        OutlinedTextField(
                            value = value,
                            onValueChange = { next ->
                                fillValues = fillValues.toMutableList().also { it[idx] = next }
                            },
                            enabled = !showReveal && !isSubmitting,
                            label = { Text("第 ${idx + 1} 空答案") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                    if (!showReveal) {
                        Spacer(modifier = Modifier.height(4.dp))
                        KsbPrimaryButton(
                            text = "提交填空答案",
                            enabled = fillValues.any { it.isNotBlank() },
                            loading = isSubmitting,
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { onSubmitAnswer(fillValues.joinToString("|")) }
                        )
                    }
                }
            }

            if (question.type == "short" && !reciteMode) {
                OutlinedTextField(
                    value = shortText,
                    onValueChange = { shortText = it },
                    enabled = !showReveal && !isSubmitting,
                    label = { Text("输入你的作答要点") },
                    minLines = 3,
                    modifier = Modifier.fillMaxWidth()
                )
                if (!showReveal) {
                    Spacer(modifier = Modifier.height(10.dp))
                    KsbPrimaryButton(
                        text = "提交并核对答案",
                        enabled = shortText.isNotBlank(),
                        loading = isSubmitting,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = { onSubmitAnswer(shortText) }
                    )
                }
            }

            if (showReveal) {
                Spacer(modifier = Modifier.height(16.dp))
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = if (eyeCare) palette.eyeCareBg else palette.cardElevated,
                    border = BorderStroke(1.dp, palette.border),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (submitted != null) {
                            KsbBanner(
                                text = if (submitted.isCorrect) {
                                    if (submitted.removedFromMistakeBook) {
                                        "回答正确！已连对 ${submitted.threshold} 次，自动移出错题本"
                                    } else "回答正确！"
                                } else "回答错误，已自动收录至错题本",
                                isError = !submitted.isCorrect
                            )
                        } else if (hasHistory && question.record != null && question.record.lastIsCorrect != null) {
                            KsbBanner(
                                text = "已作答记录：上次${if (question.record.lastIsCorrect) "回答正确" else "回答错误"}（累计作答 ${question.record.answeredCount} 次）",
                                isError = !question.record.lastIsCorrect
                            )
                        }

                        if (!reciteMode && (submitted != null || hasHistory)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.End
                            ) {
                                TextButton(onClick = onRedo) {
                                    Icon(Icons.Default.Refresh, contentDescription = null, modifier = Modifier.size(15.dp), tint = palette.brand)
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("重做本题", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = palette.brand)
                                }
                            }
                        }

                        val rawAns = submitted?.standardAnswer ?: question.answer
                        val displayAns = when (question.type) {
                            "boolean" -> if (rawAns == "A") "正确 (A)" else if (rawAns == "B") "错误 (B)" else rawAns
                            "fill" -> rawAns.split("|").joinToString("  |  ")
                            else -> rawAns
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            KsbBadge(
                                text = "参考答案",
                                containerColor = palette.success,
                                contentColor = Color.White
                            )
                            Text(
                                text = displayAns,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = palette.success
                            )
                        }

                        Text("试题解析", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textSecondary)
                        FormattedContentText(
                            text = (submitted?.explanation ?: question.explanation).ifBlank {
                                "暂无文字解析，可点击下方「AI 深度讲题」生成解析。"
                            },
                            fontSize = optSp,
                            lineHeight = optSp * 1.45f,
                            color = palette.textPrimary
                        )

                        if (question.ratingReason.isNotBlank()) {
                            Text(
                                text = "AI 命题评价：${question.ratingReason}",
                                fontSize = 12.sp,
                                color = palette.ai
                            )
                        }

                        KsbPrimaryButton(
                            text = "AI 深度讲题",
                            loading = aiLoading,
                            containerColor = palette.ai,
                            onClick = { onAskAiExplain(false) }
                        )

                        if (aiError != null) {
                            KsbBanner(text = aiError, isError = true)
                        }

                        if (aiExplain != null) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = palette.aiBg,
                                border = BorderStroke(1.dp, palette.ai.copy(alpha = 0.35f)),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Column(
                                    modifier = Modifier.padding(12.dp),
                                    verticalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                                        ) {
                                            Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = palette.ai, modifier = Modifier.size(16.dp))
                                            Text(
                                                text = "考点：${aiExplain.keyPoint}",
                                                fontSize = 12.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = palette.ai
                                            )
                                        }
                                        if (canEditBank) {
                                            TextButton(onClick = { onAskAiExplain(true) }) {
                                                Text("写入解析", fontSize = 11.sp, color = palette.ai)
                                            }
                                        }
                                    }
                                    Text(aiExplain.analysis, fontSize = 13.sp, lineHeight = 19.sp, color = palette.textPrimary)
                                    if (aiExplain.mnemonic.isNotBlank()) {
                                        Text(
                                            text = "记忆口诀：${aiExplain.mnemonic}",
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = palette.ai
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
