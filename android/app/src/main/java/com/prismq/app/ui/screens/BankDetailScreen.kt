package com.prismq.app.ui.screens

import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Assignment
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.ContentCut
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.MenuBook
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.prismq.app.data.model.AddBankShareMemberRequest
import com.prismq.app.data.model.AiRateBankRequest
import com.prismq.app.data.model.BankDetailResponse
import com.prismq.app.data.model.BankShareSettings
import com.prismq.app.data.model.CreateExamRequest
import com.prismq.app.data.model.ShareQrInfoResponse
import com.prismq.app.data.model.UpdateBankShareRequest
import com.prismq.app.data.model.UpdateBankVisibilityRequest
import com.prismq.app.data.model.difficultyLabel
import com.prismq.app.data.model.questionTypeLabel
import com.prismq.app.data.model.sanitizeDisplayName
import com.prismq.app.data.remote.ApiClient
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.components.FormattedContentText
import com.prismq.app.ui.components.SelfTestBuilderDialog
import com.prismq.app.ui.components.KsbBadge
import com.prismq.app.ui.components.KsbBanner
import com.prismq.app.ui.components.KsbCard
import com.prismq.app.ui.components.KsbEmptyView
import com.prismq.app.ui.components.KsbLoadingView
import com.prismq.app.ui.components.KsbOutlineButton
import com.prismq.app.ui.components.KsbPrimaryButton
import com.prismq.app.ui.theme.KsbTheme
import com.prismq.app.util.QrShareUtil
import kotlinx.coroutines.launch

private val QUESTION_TYPES = listOf("single", "multiple", "boolean", "fill", "short")
private val DIFFICULTY_TIERS = listOf("" to "全部难度", "easy" to "简单", "medium" to "中等", "hard" to "较难")
private val MIN_STAR_OPTIONS = listOf(0 to "全部星级", 3 to "≥3★", 4 to "≥4★", 5 to "5★精选")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BankDetailScreen(
    bankId: String,
    viewModel: MainViewModel,
    onBack: () -> Unit,
    onStartPractice: (
        bankId: String,
        mode: String,
        recite: Boolean,
        chapterId: String?,
        type: String?,
        difficultyTier: String?,
        minStar: Int
    ) -> Unit,
    onOpenImport: (bankId: String) -> Unit,
    onExamCreated: (shareCode: String) -> Unit
) {
    val palette = KsbTheme.colors
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current

    var detail by remember { mutableStateOf<BankDetailResponse?>(null) }
    var selectedChapterId by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf("") }
    var selectedDifficultyTier by remember { mutableStateOf("") }
    var selectedMinStar by remember { mutableIntStateOf(0) }

    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var statusMsg by remember { mutableStateOf<String?>(null) }
    var showSelfTestDialog by remember { mutableStateOf(false) }

    // DeepSeek 分批打分状态
    var ratingRunning by remember { mutableStateOf(false) }
    var ratingStopRequested by remember { mutableStateOf(false) }
    var ratingDoneCount by remember { mutableIntStateOf(0) }
    var ratingTotalTarget by remember { mutableIntStateOf(0) }
    var singleRatingId by remember { mutableStateOf<String?>(null) }

    // 私密分享设置弹窗
    var showShareDialog by remember { mutableStateOf(false) }
    var shareSettings by remember { mutableStateOf<BankShareSettings?>(null) }
    var shareLoading by remember { mutableStateOf(false) }
    var sharePasswordInput by remember { mutableStateOf("") }
    var inviteAccountInput by remember { mutableStateOf("") }
    var shareDialogMsg by remember { mutableStateOf<String?>(null) }
    var shareDialogErr by remember { mutableStateOf<String?>(null) }

    // 题库二维码 / 微信分享弹窗与代码格式化状态
    var showQrModal by remember { mutableStateOf(false) }
    var qrLoading by remember { mutableStateOf(false) }
    var qrInfo by remember { mutableStateOf<ShareQrInfoResponse?>(null) }
    var qrBitmap by remember { mutableStateOf<Bitmap?>(null) }
    var formattingCode by remember { mutableStateOf(false) }

    fun loadDetail(silent: Boolean = false) {
        scope.launch {
            if (!silent && detail == null) loading = true
            errorMsg = null
            try {
                detail = viewModel.api().getBankDetail(
                    id = bankId,
                    chapterId = selectedChapterId.ifEmpty { null },
                    type = selectedType.ifEmpty { null },
                    difficultyTier = selectedDifficultyTier.ifEmpty { null },
                    minStar = if (selectedMinStar > 0) selectedMinStar else null
                )
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(bankId, selectedChapterId, selectedType, selectedDifficultyTier, selectedMinStar) {
        loadDetail(silent = false)
    }

    DisposableEffect(lifecycleOwner, bankId, selectedChapterId, selectedType, selectedDifficultyTier, selectedMinStar) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && detail != null && !ratingRunning) {
                loadDetail(silent = true)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    fun startBatchedRating(onlyUnrated: Boolean) {
        val currentStats = detail?.stats
        val target = if (onlyUnrated) {
            ((currentStats?.totalCount ?: detail?.questions?.size ?: 0) - (currentStats?.ratedCount ?: 0)).coerceAtLeast(0)
        } else {
            currentStats?.totalCount ?: detail?.questions?.size ?: 0
        }
        if (target <= 0 && onlyUnrated) {
            statusMsg = "当前题库已全部完成星级与难度评级。"
            return
        }

        ratingRunning = true
        ratingStopRequested = false
        ratingDoneCount = 0
        ratingTotalTarget = target
        errorMsg = null
        statusMsg = null

        scope.launch {
            var totalRated = 0
            var offset = 0
            var lastModel = ""
            var lastRemaining = 0
            val batchLimit = 20

            try {
                for (round in 0 until 50) {
                    if (ratingStopRequested) break
                    val res = viewModel.api().rateBankQuestions(
                        AiRateBankRequest(
                            bankId = bankId,
                            onlyUnrated = onlyUnrated,
                            limit = batchLimit,
                            offset = if (onlyUnrated) 0 else offset
                        )
                    )
                    totalRated += res.ratedCount
                    if (res.modelUsed.isNotBlank()) lastModel = res.modelUsed
                    lastRemaining = res.remainingUnrated
                    ratingDoneCount = if (onlyUnrated) {
                        totalRated
                    } else {
                        minOf(target, offset + res.processedCount)
                    }

                    // 每批落库后立即刷新 UI 统计与题卡
                    detail = viewModel.api().getBankDetail(
                        id = bankId,
                        chapterId = selectedChapterId.ifEmpty { null },
                        type = selectedType.ifEmpty { null },
                        difficultyTier = selectedDifficultyTier.ifEmpty { null },
                        minStar = if (selectedMinStar > 0) selectedMinStar else null
                    )

                    if (ratingStopRequested) break
                    if (res.ratedCount == 0 && res.processedCount == 0) break
                    if (onlyUnrated) {
                        if (res.remainingUnrated == 0 || res.ratedCount == 0) break
                    } else {
                        offset += res.processedCount
                        if (res.processedCount < batchLimit || offset >= target) break
                    }
                }

                statusMsg = when {
                    ratingStopRequested -> "已暂停评级（已成功保存 $totalRated 题，下次可继续补评）。"
                    totalRated == 0 && onlyUnrated -> "当前题库全部题目均已完成星级与难度评级。"
                    else -> "DeepSeek ($lastModel) 已完成 $totalRated 题评级并保存${if (lastRemaining > 0) "，剩余 $lastRemaining 题" else "，全库均已评级"}。"
                }
            } catch (e: Exception) {
                val msg = ApiClient.parseError(e)
                errorMsg = if (totalRated > 0) "已保存 $totalRated 题，本轮中断：$msg" else msg
                loadDetail()
            } finally {
                ratingRunning = false
            }
        }
    }

    fun openShareSheet() {
        showShareDialog = true
        shareLoading = true
        shareDialogErr = null
        shareDialogMsg = null
        scope.launch {
            try {
                shareSettings = viewModel.api().getBankShareSettings(bankId)
            } catch (e: Exception) {
                shareDialogErr = ApiClient.parseError(e)
            } finally {
                shareLoading = false
            }
        }
    }

    Scaffold(
        containerColor = palette.canvas,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.card),
                title = {
                    Text(
                        text = detail?.bank?.title ?: "题库详情",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.textPrimary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = palette.textPrimary)
                    }
                },
                actions = {
                    val b = detail?.bank
                    if (b != null) {
                        if (b.canEdit) {
                            IconButton(
                                enabled = !formattingCode,
                                onClick = {
                                    formattingCode = true
                                    scope.launch {
                                        try {
                                            val res = viewModel.api().formatBankCode(bankId)
                                            statusMsg = if (res.formattedCount > 0) {
                                                "已扫描 ${res.scannedCount} 题，规范了 ${res.formattedCount} 道代码题格式。"
                                            } else {
                                                "已扫描 ${res.scannedCount} 题，代码格式均已规范。"
                                            }
                                            loadDetail(silent = true)
                                        } catch (e: Exception) {
                                            errorMsg = ApiClient.parseError(e)
                                        } finally {
                                            formattingCode = false
                                        }
                                    }
                                }
                            ) {
                                Icon(Icons.Default.Code, contentDescription = "规范代码格式", tint = palette.brand)
                            }
                        }
                        if (b.visibility == "public" || b.canEdit || b.shareEnabled) {
                            IconButton(onClick = {
                                showQrModal = true
                                qrLoading = true
                                scope.launch {
                                    try {
                                        val info = viewModel.api().getBankShareQr(bankId)
                                        qrInfo = info
                                        qrBitmap = QrShareUtil.generateSharePosterBitmap(
                                            qrContent = info.shareUrl,
                                            title = info.title,
                                            shareCode = info.shareCode,
                                            subtitle = "共 ${info.questionCount} 道题 · 扫码或输入分享码加入"
                                        )
                                    } catch (e: Exception) {
                                        errorMsg = ApiClient.parseError(e)
                                        showQrModal = false
                                    } finally {
                                        qrLoading = false
                                    }
                                }
                            }) {
                                Icon(Icons.Default.QrCode2, contentDescription = "二维码与微信分享", tint = palette.brand)
                            }
                        }
                        if (b.canEdit && b.visibility == "private") {
                            IconButton(onClick = { openShareSheet() }) {
                                Icon(Icons.Default.Share, contentDescription = "私密分享", tint = palette.ai)
                            }
                        }
                    }
                }
            )
        }
    ) { innerPad ->
        if (loading && detail == null) {
            Box(modifier = Modifier.padding(innerPad).fillMaxSize()) {
                KsbLoadingView("正在加载题库详情...")
            }
            return@Scaffold
        }

        val currentDetail = detail
        if (currentDetail == null) {
            Box(modifier = Modifier.padding(innerPad).padding(16.dp).fillMaxSize()) {
                KsbBanner(text = errorMsg ?: "无法加载该题库", isError = true)
            }
            return@Scaffold
        }

        val bank = currentDetail.bank
        val chapters = currentDetail.chapters
        val questions = currentDetail.questions
        val stats = currentDetail.stats
        val unratedCount = stats?.let { (it.totalCount - it.ratedCount).coerceAtLeast(0) } ?: 0

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (errorMsg != null) {
                item { KsbBanner(text = errorMsg!!, isError = true) }
            }
            if (statusMsg != null) {
                item { KsbBanner(text = statusMsg!!, isError = false) }
            }

            // 题库摘要卡
            item {
                KsbCard {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        KsbBadge(text = bank.category.ifBlank { "默认分类" })
                        KsbBadge(
                            text = if (bank.visibility == "public") "公开共享" else "个人私有",
                            containerColor = if (bank.visibility == "public") palette.successBg else palette.cardElevated,
                            contentColor = if (bank.visibility == "public") palette.success else palette.textSecondary
                        )
                        if (bank.isSharedWithMe) {
                            KsbBadge(text = "好友私密分享", containerColor = palette.aiBg, contentColor = palette.ai)
                        }
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(bank.title, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = palette.textPrimary)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = bank.description.ifBlank { "暂无简介说明" },
                        fontSize = 12.sp,
                        color = palette.textSecondary
                    )
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "创建者：${sanitizeDisplayName(bank.ownerName, "匿名")} · 共 ${stats?.totalCount ?: questions.size} 题",
                        fontSize = 12.sp,
                        color = palette.textMuted
                    )
                    Spacer(modifier = Modifier.height(12.dp))

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        if (bank.canEdit) {
                            KsbPrimaryButton(
                                text = "导题 / AI 洗题",
                                onClick = { onOpenImport(bank.id) },
                                modifier = Modifier.weight(1f)
                            )
                            if (bank.visibility == "private") {
                                KsbOutlineButton(
                                    text = "私密分享",
                                    borderColor = palette.ai,
                                    contentColor = palette.ai,
                                    onClick = { openShareSheet() }
                                )
                            }
                            KsbOutlineButton(
                                text = if (bank.visibility == "public") "转私有" else "公开",
                                onClick = {
                                    scope.launch {
                                        try {
                                            val nextVis = if (bank.visibility == "public") "private" else "public"
                                            viewModel.api().updateBankVisibility(
                                                bank.id,
                                                UpdateBankVisibilityRequest(nextVis)
                                            )
                                            loadDetail()
                                        } catch (e: Exception) {
                                            errorMsg = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            )
                        } else {
                            KsbOutlineButton(
                                text = "克隆为我的题库",
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    scope.launch {
                                        try {
                                            val res = viewModel.api().cloneBank(bank.id)
                                            statusMsg = "已克隆到「我的题库」"
                                            detail = viewModel.api().getBankDetail(res.id)
                                        } catch (e: Exception) {
                                            errorMsg = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            )
                            if (bank.isSharedWithMe) {
                                val curUserId = viewModel.currentUser?.id
                                KsbOutlineButton(
                                    text = "退出分享",
                                    borderColor = palette.error,
                                    contentColor = palette.error,
                                    onClick = {
                                        if (curUserId == null) return@KsbOutlineButton
                                        scope.launch {
                                            try {
                                                viewModel.api().removeBankShareMember(bank.id, curUserId)
                                                onBack()
                                            } catch (e: Exception) {
                                                errorMsg = ApiClient.parseError(e)
                                            }
                                        }
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // 六大刷题模式金刚格
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        PracticeModeCard(
                            icon = Icons.Default.PlayArrow,
                            title = "顺序刷题",
                            subtitle = if (bank.lastProgressIndex > 0) "续第${bank.lastProgressIndex + 1}题" else "按序攻克",
                            accent = palette.brand,
                            isPrimary = true,
                            modifier = Modifier.weight(1f),
                            onClick = {
                                onStartPractice(bank.id, "sequential", false, selectedChapterId.ifEmpty { null }, null, null, 0)
                            }
                        )
                        PracticeModeCard(
                            icon = Icons.Default.Shuffle,
                            title = "随机乱序",
                            subtitle = "乱序防死记",
                            accent = palette.ai,
                            modifier = Modifier.weight(1f),
                            onClick = {
                                onStartPractice(bank.id, "random", false, selectedChapterId.ifEmpty { null }, null, null, 0)
                            }
                        )
                        PracticeModeCard(
                            icon = Icons.Default.MenuBook,
                            title = "背题模式",
                            subtitle = "答案直显",
                            accent = palette.success,
                            modifier = Modifier.weight(1f),
                            onClick = {
                                onStartPractice(bank.id, "sequential", true, selectedChapterId.ifEmpty { null }, null, null, 0)
                            }
                        )
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        PracticeModeCard(
                            icon = Icons.Default.ContentCut,
                            title = "仅刷未斩",
                            subtitle = "跳过已掌握",
                            accent = Color(0xFF0D9488),
                            modifier = Modifier.weight(1f),
                            onClick = {
                                onStartPractice(bank.id, "unmastered", false, selectedChapterId.ifEmpty { null }, null, null, 0)
                            }
                        )
                        PracticeModeCard(
                            icon = Icons.Default.ErrorOutline,
                            title = "本库错题",
                            subtitle = "错题突破",
                            accent = palette.error,
                            modifier = Modifier.weight(1f),
                            onClick = {
                                onStartPractice(bank.id, "mistakes", false, null, null, null, 0)
                            }
                        )
                        PracticeModeCard(
                            icon = Icons.Default.Assignment,
                            title = "自测组卷",
                            subtitle = "自选单选/判断题量",
                            accent = palette.warning,
                            modifier = Modifier.weight(1f),
                            onClick = { showSelfTestDialog = true }
                        )
                    }
                    Text(
                        text = "提示：如需导出 Excel/Word、打印讲义或逐题新建编辑与章节管理，请使用网页端。",
                        fontSize = 11.sp,
                        color = palette.textMuted
                    )
                }
            }

            // DeepSeek 智能评级与题型/难度分布卡片
            if (stats != null) {
                item {
                    KsbCard {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Icon(Icons.Default.AutoAwesome, contentDescription = null, tint = palette.ai, modifier = Modifier.size(18.dp))
                                Text("DeepSeek 智能评级", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                            }
                            KsbBadge(text = "已评 ${stats.ratedCount}/${stats.totalCount}")
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                            KsbBadge(text = "均难度 ${stats.avgDifficulty}")
                            KsbBadge(
                                text = "均星级 ${if (stats.avgStarRating > 0) "${stats.avgStarRating}★" else "待评"}",
                                containerColor = palette.warningBg,
                                contentColor = palette.warning
                            )
                            Text(
                                text = "简${stats.difficultyCounts.easy} · 中${stats.difficultyCounts.medium} · 难${stats.difficultyCounts.hard}",
                                fontSize = 11.sp,
                                color = palette.textSecondary
                            )
                        }

                        if (ratingRunning) {
                            Spacer(modifier = Modifier.height(10.dp))
                            val prog = if (ratingTotalTarget > 0) {
                                ratingDoneCount.toFloat() / ratingTotalTarget
                            } else 0f
                            LinearProgressIndicator(
                                progress = { prog.coerceIn(0f, 1f) },
                                modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(4.dp)),
                                color = palette.ai,
                                trackColor = palette.cardElevated
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    "分批处理中：$ratingDoneCount / $ratingTotalTarget 题",
                                    fontSize = 11.sp,
                                    color = palette.ai,
                                    fontWeight = FontWeight.SemiBold
                                )
                                TextButton(onClick = { ratingStopRequested = true }) {
                                    Text("停止", fontSize = 12.sp, color = palette.error)
                                }
                            }
                        }

                        if (bank.canEdit && stats.totalCount > 0) {
                            Spacer(modifier = Modifier.height(10.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                                KsbPrimaryButton(
                                    text = if (unratedCount > 0) "DS 评未评题 ($unratedCount)" else "已全部评级",
                                    enabled = !ratingRunning && unratedCount > 0,
                                    loading = ratingRunning,
                                    containerColor = palette.ai,
                                    onClick = { startBatchedRating(onlyUnrated = true) },
                                    modifier = Modifier.weight(1f)
                                )
                                KsbOutlineButton(
                                    text = "全库重评",
                                    enabled = !ratingRunning,
                                    onClick = { startBatchedRating(onlyUnrated = false) }
                                )
                            }
                        }
                    }
                }

                // 题型分类胶囊栏 + 难度/星级筛选 + 一键按筛选刷题
                item {
                    KsbCard(contentPadding = PaddingValues(12.dp)) {
                        Text("按题型分类 & 难度/星级筛选", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        Spacer(modifier = Modifier.height(8.dp))

                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            FilterChip(
                                selected = selectedType.isEmpty(),
                                onClick = { selectedType = "" },
                                label = { Text("全部 (${stats.totalCount})", fontSize = 12.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = palette.brand,
                                    selectedLabelColor = Color.White
                                )
                            )
                            QUESTION_TYPES.forEach { qt ->
                                val cnt = stats.typeCounts[qt] ?: 0
                                val active = selectedType == qt
                                FilterChip(
                                    selected = active,
                                    onClick = { selectedType = if (active) "" else qt },
                                    label = { Text("${questionTypeLabel(qt)} ($cnt)", fontSize = 12.sp) },
                                    colors = FilterChipDefaults.filterChipColors(
                                        selectedContainerColor = palette.brand,
                                        selectedLabelColor = Color.White
                                    )
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(4.dp))
                        Row(
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            DIFFICULTY_TIERS.forEach { (tier, label) ->
                                FilterChip(
                                    selected = selectedDifficultyTier == tier,
                                    onClick = { selectedDifficultyTier = tier },
                                    label = { Text(label, fontSize = 11.sp) }
                                )
                            }
                            MIN_STAR_OPTIONS.forEach { (star, label) ->
                                FilterChip(
                                    selected = selectedMinStar == star,
                                    onClick = { selectedMinStar = star },
                                    label = { Text(label, fontSize = 11.sp) }
                                )
                            }
                        }

                        if (selectedType.isNotEmpty() || selectedDifficultyTier.isNotEmpty() || selectedMinStar > 0 || selectedChapterId.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                                KsbPrimaryButton(
                                    text = "按当前筛选专练 (${questions.size}题)",
                                    enabled = questions.isNotEmpty(),
                                    modifier = Modifier.weight(1f),
                                    onClick = {
                                        onStartPractice(
                                            bank.id,
                                            if (selectedType.isNotEmpty()) "type" else "sequential",
                                            false,
                                            selectedChapterId.ifEmpty { null },
                                            selectedType.ifEmpty { null },
                                            selectedDifficultyTier.ifEmpty { null },
                                            selectedMinStar
                                        )
                                    }
                                )
                                KsbOutlineButton(
                                    text = "重置",
                                    onClick = {
                                        selectedType = ""
                                        selectedDifficultyTier = ""
                                        selectedMinStar = 0
                                        selectedChapterId = ""
                                    }
                                )
                            }
                        }
                    }
                }
            }

            // 章节过滤芯片条
            if (chapters.isNotEmpty()) {
                item {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        FilterChip(
                            selected = selectedChapterId.isEmpty(),
                            onClick = { selectedChapterId = "" },
                            label = { Text("全部章节", fontSize = 12.sp) }
                        )
                        chapters.forEach { ch ->
                            FilterChip(
                                selected = selectedChapterId == ch.id,
                                onClick = { selectedChapterId = ch.id },
                                label = { Text("${ch.title} (${ch.questionCount})", fontSize = 12.sp) }
                            )
                        }
                    }
                }
            }

            // 试题列表
            if (questions.isEmpty()) {
                item {
                    KsbEmptyView(
                        icon = Icons.Default.CloudUpload,
                        title = "当前筛选范围内暂无试题",
                        subtitle = "可调整上方筛选项或前往导题工作台导入试题",
                        actionText = if (bank.canEdit) "立即导题" else null,
                        onAction = if (bank.canEdit) { { onOpenImport(bank.id) } } else null
                    )
                }
            } else {
                itemsIndexed(questions, key = { _, q -> q.id }) { idx, q ->
                    KsbCard(contentPadding = PaddingValues(14.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                                modifier = Modifier.weight(1f)
                            ) {
                                Text("#${idx + 1}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = palette.textSecondary)
                                KsbBadge(
                                    text = questionTypeLabel(q.type),
                                    containerColor = palette.brand,
                                    contentColor = Color.White
                                )
                                KsbBadge(
                                    text = difficultyLabel(q.difficulty),
                                    containerColor = when {
                                        q.difficulty >= 4 -> palette.errorBg
                                        q.difficulty <= 2 -> palette.successBg
                                        else -> palette.cardElevated
                                    },
                                    contentColor = when {
                                        q.difficulty >= 4 -> palette.error
                                        q.difficulty <= 2 -> palette.success
                                        else -> palette.textSecondary
                                    }
                                )
                                if (q.starRating > 0) {
                                    KsbBadge(
                                        text = "${q.starRating}★",
                                        containerColor = palette.warningBg,
                                        contentColor = palette.warning
                                    )
                                }
                                if (!q.chapterTitle.isNullOrBlank()) {
                                    KsbBadge(text = q.chapterTitle)
                                }
                                if (q.record != null && q.record.answeredCount > 0 && q.record.lastIsCorrect != null) {
                                    KsbBadge(
                                        text = if (q.record.lastIsCorrect) "已答对" else "已答错",
                                        containerColor = if (q.record.lastIsCorrect) palette.successBg else palette.errorBg,
                                        contentColor = if (q.record.lastIsCorrect) palette.success else palette.error
                                    )
                                }
                            }
                            if (bank.canEdit) {
                                IconButton(
                                    enabled = !ratingRunning && singleRatingId == null,
                                    onClick = {
                                        singleRatingId = q.id
                                        scope.launch {
                                            try {
                                                viewModel.api().rateBankQuestions(
                                                    AiRateBankRequest(
                                                        bankId = bank.id,
                                                        questionIds = listOf(q.id),
                                                        onlyUnrated = false
                                                    )
                                                )
                                                loadDetail()
                                            } catch (e: Exception) {
                                                errorMsg = ApiClient.parseError(e)
                                            } finally {
                                                singleRatingId = null
                                            }
                                        }
                                    },
                                    modifier = Modifier.size(30.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.AutoAwesome,
                                        contentDescription = "DS 单题评级",
                                        tint = if (singleRatingId == q.id) palette.textMuted else palette.ai,
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(6.dp))
                        FormattedContentText(
                            text = q.stem,
                            fontSize = 14.sp,
                            lineHeight = 20.sp,
                            fontWeight = FontWeight.Medium,
                            color = palette.textPrimary
                        )
                        if (q.options.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(6.dp))
                            q.options.forEach { opt ->
                                FormattedContentText(
                                    text = "${opt.key}. ${opt.content}",
                                    fontSize = 12.sp,
                                    lineHeight = 18.sp,
                                    color = palette.textSecondary,
                                    modifier = Modifier.padding(vertical = 1.dp)
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "答案：${q.answer}",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = palette.success
                        )
                        if (q.ratingReason.isNotBlank()) {
                            Spacer(modifier = Modifier.height(3.dp))
                            Text(
                                text = "AI 评级：${q.ratingReason}",
                                fontSize = 11.sp,
                                color = palette.ai
                            )
                        }
                    }
                }
            }
        }
    }

    if (showShareDialog) {
        AlertDialog(
            onDismissRequest = { showShareDialog = false },
            title = { Text("私密分享管理", fontWeight = FontWeight.Bold) },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (shareDialogErr != null) {
                        KsbBanner(text = shareDialogErr!!, isError = true)
                    }
                    if (shareDialogMsg != null) {
                        KsbBanner(text = shareDialogMsg!!, isError = false)
                    }
                    if (shareLoading && shareSettings == null) {
                        Text("正在加载分享设置...", fontSize = 12.sp, color = palette.textSecondary)
                    } else if (shareSettings != null) {
                        val s = shareSettings!!
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("开启私密分享码", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                            Switch(
                                checked = s.shareEnabled,
                                onCheckedChange = { enabled ->
                                    scope.launch {
                                        try {
                                            shareSettings = viewModel.api().updateBankShareSettings(
                                                bankId,
                                                UpdateBankShareRequest(shareEnabled = enabled)
                                            )
                                            loadDetail()
                                        } catch (e: Exception) {
                                            shareDialogErr = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            )
                        }

                        if (s.shareEnabled && s.shareCode.isNotBlank()) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("分享码：${s.shareCode}", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.brand)
                                Row {
                                    TextButton(onClick = {
                                        clipboard.setText(AnnotatedString(s.shareCode))
                                        shareDialogMsg = "已复制分享码：${s.shareCode}"
                                    }) {
                                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(14.dp))
                                        Text(" 复制", fontSize = 12.sp)
                                    }
                                    TextButton(onClick = {
                                        scope.launch {
                                            try {
                                                shareSettings = viewModel.api().updateBankShareSettings(
                                                    bankId,
                                                    UpdateBankShareRequest(resetCode = true)
                                                )
                                                shareDialogMsg = "已重置分享码"
                                            } catch (e: Exception) {
                                                shareDialogErr = ApiClient.parseError(e)
                                            }
                                        }
                                    }) {
                                        Text("重置", fontSize = 12.sp)
                                    }
                                }
                            }
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = sharePasswordInput,
                                onValueChange = { sharePasswordInput = it },
                                label = { Text(if (s.hasSharePassword) "修改口令（已设口令）" else "设置访问口令（可选）", fontSize = 11.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            KsbOutlineButton(
                                text = "保存",
                                onClick = {
                                    scope.launch {
                                        try {
                                            shareSettings = viewModel.api().updateBankShareSettings(
                                                bankId,
                                                UpdateBankShareRequest(sharePassword = sharePasswordInput.trim())
                                            )
                                            sharePasswordInput = ""
                                            shareDialogMsg = "分享口令已更新"
                                        } catch (e: Exception) {
                                            shareDialogErr = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            )
                        }

                        HorizontalDivider()
                        Text("定向授权用户 (${s.members.size})", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = inviteAccountInput,
                                onValueChange = { inviteAccountInput = it },
                                label = { Text("输入对方用户名或邮箱", fontSize = 11.sp) },
                                singleLine = true,
                                modifier = Modifier.weight(1f)
                            )
                            KsbPrimaryButton(
                                text = "授权",
                                enabled = inviteAccountInput.trim().isNotEmpty(),
                                onClick = {
                                    scope.launch {
                                        try {
                                            val res = viewModel.api().addBankShareMember(
                                                bankId,
                                                AddBankShareMemberRequest(inviteAccountInput.trim())
                                            )
                                            shareSettings = s.copy(members = res.members)
                                            inviteAccountInput = ""
                                            shareDialogMsg = "已授权访问权限"
                                        } catch (e: Exception) {
                                            shareDialogErr = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            )
                        }
                        s.members.forEach { m ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text("${m.nickname.ifBlank { m.username }} (@${m.username})", fontSize = 12.sp)
                                IconButton(
                                    onClick = {
                                        scope.launch {
                                            try {
                                                val res = viewModel.api().removeBankShareMember(bankId, m.userId)
                                                shareSettings = s.copy(members = res.members)
                                            } catch (e: Exception) {
                                                shareDialogErr = ApiClient.parseError(e)
                                            }
                                        }
                                    },
                                    modifier = Modifier.size(26.dp)
                                ) {
                                    Icon(Icons.Default.DeleteOutline, contentDescription = "移除", tint = palette.error, modifier = Modifier.size(16.dp))
                                }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showShareDialog = false }) { Text("关闭") }
            }
        )
    }

    if (showQrModal) {
        val info = qrInfo
        val bmp = qrBitmap
        AlertDialog(
            onDismissRequest = { showQrModal = false },
            containerColor = palette.card,
            title = { Text("题库二维码与微信分享", fontWeight = FontWeight.Bold) },
            text = {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (qrLoading || info == null || bmp == null) {
                        Text("正在生成题库分享海报...", fontSize = 12.sp, color = palette.textSecondary)
                    } else {
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = "题库二维码海报",
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(290.dp)
                                .clip(RoundedCornerShape(12.dp))
                        )
                        Text(
                            text = "分享码：${info.shareCode}",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = palette.brand
                        )
                        KsbPrimaryButton(
                            text = "分享二维码到微信",
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                QrShareUtil.sharePosterToWeChatOrChooser(
                                    context = context,
                                    poster = bmp,
                                    shareText = "【PrismQ 棱题题库】${info.title}（${info.questionCount}题）\n分享码：${info.shareCode}\n链接：${info.shareUrl}",
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
                                        bmp,
                                        "PrismQ_Bank_${info.shareCode}.png"
                                    )
                                    statusMsg = "已保存题库二维码到系统相册"
                                    showQrModal = false
                                }
                            )
                            KsbOutlineButton(
                                text = "复制微信文案",
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    clipboard.setText(
                                        AnnotatedString("【PrismQ 棱题题库】${info.title}\n分享码：${info.shareCode}\n链接：${info.shareUrl}")
                                    )
                                    statusMsg = "已复制微信分享文案"
                                    showQrModal = false
                                }
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { showQrModal = false }) { Text("关闭") }
            }
        )
    }

    if (showSelfTestDialog) {
        detail?.let { d ->
            SelfTestBuilderDialog(
                viewModel = viewModel,
                banks = emptyList(),
                fixedBankId = d.bank.id,
                fixedBankTitle = d.bank.title,
                fixedChapters = d.chapters,
                fixedQuestions = d.questions,
                fixedStats = d.stats,
                onDismiss = { showSelfTestDialog = false },
                onCreated = onExamCreated
            )
        }
    }
}

@Composable
private fun PracticeModeCard(
    icon: ImageVector,
    title: String,
    subtitle: String,
    accent: Color,
    isPrimary: Boolean = false,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val palette = KsbTheme.colors
    Surface(
        modifier = modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(12.dp),
        color = if (isPrimary) palette.brand else palette.card,
        border = BorderStroke(1.dp, if (isPrimary) palette.brand else palette.border),
        shadowElevation = if (palette.isDark) 0.dp else 1.dp
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Box(
                modifier = Modifier
                    .size(32.dp)
                    .background(
                        if (isPrimary) Color.White.copy(alpha = 0.22f) else accent.copy(alpha = 0.14f),
                        RoundedCornerShape(8.dp)
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = if (isPrimary) Color.White else accent,
                    modifier = Modifier.size(18.dp)
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = title,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = if (isPrimary) Color.White else palette.textPrimary,
                maxLines = 1
            )
            Text(
                text = subtitle,
                fontSize = 10.sp,
                color = if (isPrimary) Color.White.copy(alpha = 0.85f) else palette.textMuted,
                maxLines = 1
            )
        }
    }
}
