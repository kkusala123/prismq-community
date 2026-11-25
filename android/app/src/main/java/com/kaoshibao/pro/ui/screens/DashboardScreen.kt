package com.kaoshibao.pro.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kaoshibao.pro.data.model.DashboardResponse
import com.kaoshibao.pro.data.model.displayName
import com.kaoshibao.pro.data.model.sanitizeDisplayName
import com.kaoshibao.pro.data.remote.ApiClient
import com.kaoshibao.pro.ui.MainViewModel
import com.kaoshibao.pro.ui.components.KsbBadge
import com.kaoshibao.pro.ui.components.KsbBanner
import com.kaoshibao.pro.ui.components.KsbCard
import com.kaoshibao.pro.ui.components.KsbEmptyView
import com.kaoshibao.pro.ui.components.KsbLoadingView
import com.kaoshibao.pro.ui.components.KsbOutlineButton
import com.kaoshibao.pro.ui.components.KsbPrimaryButton
import com.kaoshibao.pro.ui.theme.KsbTheme
import kotlinx.coroutines.launch

@Composable
fun DashboardScreen(
    viewModel: MainViewModel,
    onOpenBank: (String) -> Unit,
    onStartPractice: (bankId: String, mode: String, recite: Boolean) -> Unit,
    onOpenImport: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenMistakes: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenAdmin: () -> Unit,
    onJoinExam: (String) -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current

    var data by remember { mutableStateOf<DashboardResponse?>(null) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var shareCodeInput by remember { mutableStateOf("") }
    var cloningId by remember { mutableStateOf<String?>(null) }

    fun reload(silent: Boolean = false) {
        scope.launch {
            if (!silent && data == null) loading = true
            errorMsg = null
            try {
                data = viewModel.api().getDashboard()
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(Unit) { reload(silent = false) }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && data != null) {
                reload(silent = true)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    if (loading && data == null) {
        KsbLoadingView("正在加载学习概览...")
        return
    }

    val user = viewModel.currentUser
    val stats = data?.stats
    val recents = data?.recentBanks.orEmpty()
    val recentTop = recents.firstOrNull()
    val publicBanks = data?.publicBanks.orEmpty().take(2)

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.canvas),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // 1. 极简问候语
        item {
            Text(
                text = "欢迎回来，${user?.displayName() ?: "同学"}",
                fontSize = 14.sp,
                color = palette.textSecondary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        if (errorMsg != null) {
            item { KsbBanner(text = errorMsg!!, isError = true) }
        }

        // 2. Hero 主焦点卡片（当前题库 + 一键开刷 / 空状态导入）
        item {
            if (recentTop != null) {
                val pct = if (recentTop.questionCount > 0) {
                    recentTop.practicedCount.toFloat() / recentTop.questionCount
                } else 0f
                val pctInt = (pct.coerceIn(0f, 1f) * 100).toInt()

                KsbCard(
                    cornerRadius = 22.dp,
                    contentPadding = PaddingValues(20.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        KsbBadge(text = recentTop.category.ifBlank { "当前题库" })
                        Text(
                            text = "$pctInt%",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = palette.brand
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = recentTop.title,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = (-0.3).sp,
                        color = palette.textPrimary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.clickable { onOpenBank(recentTop.id) }
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "已练 ${recentTop.practicedCount} / ${recentTop.questionCount} 题",
                        fontSize = 13.sp,
                        color = palette.textSecondary
                    )

                    Spacer(modifier = Modifier.height(12.dp))
                    LinearProgressIndicator(
                        progress = { pct.coerceIn(0f, 1f) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(5.dp)
                            .clip(RoundedCornerShape(50)),
                        color = palette.brand,
                        trackColor = palette.cardElevated
                    )

                    Spacer(modifier = Modifier.height(16.dp))
                    KsbPrimaryButton(
                        text = "继续刷题 · 第 ${recentTop.lastQuestionIndex + 1} 题",
                        onClick = { onStartPractice(recentTop.id, "sequential", false) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp)
                    )

                    Spacer(modifier = Modifier.height(10.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        KsbOutlineButton(
                            text = "背题模式",
                            onClick = { onStartPractice(recentTop.id, "sequential", true) },
                            modifier = Modifier.weight(1f)
                        )
                        KsbOutlineButton(
                            text = "导入题库",
                            onClick = onOpenImport,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            } else {
                KsbEmptyView(
                    icon = Icons.Default.Book,
                    title = "开始你的第一次刷题",
                    subtitle = "导入 Excel / Word 模板或使用 AI 洗题快速建库",
                    actionText = "导入题库",
                    onAction = onOpenImport
                )
            }
        }

        // 3. Apple 极简 3 项统计条（点击错题直达错题本）
        item {
            KsbCard(
                cornerRadius = 20.dp,
                contentPadding = PaddingValues(vertical = 16.dp, horizontal = 8.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    AppleStatColumn(
                        label = "累计作答",
                        value = "${stats?.totalAnswered ?: 0}",
                        valueColor = palette.textPrimary,
                        modifier = Modifier.weight(1f)
                    )
                    Box(modifier = Modifier.width(0.5.dp).height(28.dp).background(palette.border))
                    AppleStatColumn(
                        label = "正确率",
                        value = "${stats?.accuracy ?: 0}%",
                        valueColor = palette.brand,
                        modifier = Modifier.weight(1f)
                    )
                    Box(modifier = Modifier.width(0.5.dp).height(28.dp).background(palette.border))
                    AppleStatColumn(
                        label = "待消错题",
                        value = "${stats?.mistakeCount ?: 0}",
                        valueColor = palette.error,
                        modifier = Modifier
                            .weight(1f)
                            .clickable(onClick = onOpenMistakes)
                    )
                }
            }
        }

        // 4. iOS Grouped 分组列表：最近题库（第 2 个起）
        if (recents.size > 1) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "最近题库",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = palette.textMuted,
                        modifier = Modifier.padding(start = 6.dp)
                    )
                    KsbCard(
                        cornerRadius = 20.dp,
                        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 4.dp)
                    ) {
                        recents.drop(1).forEachIndexed { idx, b ->
                            val pct = if (b.questionCount > 0) (b.practicedCount * 100 / b.questionCount) else 0
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onOpenBank(b.id) }
                                    .padding(vertical = 13.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(modifier = Modifier.weight(1f).padding(end = 10.dp)) {
                                    Text(
                                        text = b.title,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = palette.textPrimary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = "已练 ${b.practicedCount}/${b.questionCount} 题 ($pct%) · 断点第 ${b.lastQuestionIndex + 1} 题",
                                        fontSize = 12.sp,
                                        color = palette.textSecondary
                                    )
                                }
                                Surface(
                                    onClick = { onStartPractice(b.id, "sequential", false) },
                                    shape = CircleShape,
                                    color = palette.brandSoft,
                                    modifier = Modifier.size(34.dp)
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Icon(
                                            imageVector = Icons.Default.PlayArrow,
                                            contentDescription = "继续刷题",
                                            tint = palette.brand,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }
                            }
                            if (idx < recents.size - 2) {
                                HorizontalDivider(thickness = 0.5.dp, color = palette.border)
                            }
                        }
                    }
                }
            }
        }

        // 5. 紧凑单行：考场码直达
        item {
            KsbCard(
                cornerRadius = 18.dp,
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedTextField(
                        value = shareCodeInput,
                        onValueChange = { shareCodeInput = it.uppercase() },
                        placeholder = { Text("输入 8 位考场分享码", fontSize = 13.sp, color = palette.textMuted) },
                        singleLine = true,
                        shape = RoundedCornerShape(12.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = palette.brand,
                            unfocusedBorderColor = Color.Transparent,
                            focusedContainerColor = palette.cardElevated,
                            unfocusedContainerColor = palette.cardElevated
                        ),
                        modifier = Modifier.weight(1f)
                    )
                    KsbPrimaryButton(
                        text = "进入",
                        enabled = shareCodeInput.trim().isNotEmpty(),
                        onClick = {
                            val code = shareCodeInput.trim().uppercase()
                            if (code.isNotEmpty()) onJoinExam(code)
                        }
                    )
                }
            }
        }

        // 6. iOS Grouped 分组列表：公共广场（最多 2 条）
        if (publicBanks.isNotEmpty()) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        text = "公共广场",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = palette.textMuted,
                        modifier = Modifier.padding(start = 6.dp)
                    )
                    KsbCard(
                        cornerRadius = 20.dp,
                        contentPadding = PaddingValues(horizontal = 18.dp, vertical = 4.dp)
                    ) {
                        publicBanks.forEachIndexed { idx, pb ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onOpenBank(pb.id) }
                                    .padding(vertical = 13.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Column(modifier = Modifier.weight(1f).padding(end = 10.dp)) {
                                    Text(
                                        text = pb.title,
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = palette.textPrimary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = "${pb.questionCount} 题 · 作者 ${sanitizeDisplayName(pb.ownerName, "匿名")}",
                                        fontSize = 12.sp,
                                        color = palette.textSecondary
                                    )
                                }
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    KsbOutlineButton(
                                        text = if (cloningId == pb.id) "..." else "克隆",
                                        enabled = cloningId != pb.id,
                                        onClick = {
                                            cloningId = pb.id
                                            scope.launch {
                                                try {
                                                    val res = viewModel.api().cloneBank(pb.id)
                                                    onOpenBank(res.id)
                                                } catch (e: Exception) {
                                                    errorMsg = ApiClient.parseError(e)
                                                } finally {
                                                    cloningId = null
                                                }
                                            }
                                        }
                                    )
                                    Surface(
                                        onClick = { onStartPractice(pb.id, "sequential", false) },
                                        shape = CircleShape,
                                        color = palette.brand,
                                        modifier = Modifier.size(36.dp)
                                    ) {
                                        Box(contentAlignment = Alignment.Center) {
                                            Icon(
                                                imageVector = Icons.Default.PlayArrow,
                                                contentDescription = "刷题",
                                                tint = Color.White,
                                                modifier = Modifier.size(18.dp)
                                            )
                                        }
                                    }
                                }
                            }
                            if (idx < publicBanks.lastIndex) {
                                HorizontalDivider(thickness = 0.5.dp, color = palette.border)
                            }
                        }
                    }
                }
            }
        }

        item { Spacer(modifier = Modifier.height(8.dp)) }
    }
}

@Composable
private fun AppleStatColumn(
    label: String,
    value: String,
    valueColor: Color,
    modifier: Modifier = Modifier
) {
    val palette = KsbTheme.colors
    Column(
        modifier = modifier.padding(horizontal = 6.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = value,
            fontSize = 21.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = (-0.4).sp,
            color = valueColor,
            maxLines = 1
        )
        Spacer(modifier = Modifier.height(3.dp))
        Text(
            text = label,
            fontSize = 11.sp,
            color = palette.textSecondary,
            maxLines = 1
        )
    }
}
