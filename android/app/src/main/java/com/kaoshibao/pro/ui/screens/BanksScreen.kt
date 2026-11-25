package com.kaoshibao.pro.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Key
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.kaoshibao.pro.data.model.CreateBankRequest
import com.kaoshibao.pro.data.model.JoinBankShareRequest
import com.kaoshibao.pro.data.model.QuestionBankSummary
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
import com.kaoshibao.pro.ui.components.KsbSegmentedControl
import com.kaoshibao.pro.ui.theme.KsbTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun BanksScreen(
    viewModel: MainViewModel,
    onOpenBank: (String) -> Unit,
    onStartPractice: (bankId: String, mode: String, recite: Boolean) -> Unit,
    onOpenImport: () -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    val lifecycleOwner = LocalLifecycleOwner.current
    var activeScope by remember { mutableStateOf("mine") } // mine | shared | public
    var keyword by remember { mutableStateOf("") }
    var selectedCategory by remember { mutableStateOf("全部") }
    var banks by remember { mutableStateOf<List<QuestionBankSummary>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var errorMsg by remember { mutableStateOf<String?>(null) }

    var showCreateDialog by remember { mutableStateOf(false) }
    var newTitle by remember { mutableStateOf("") }
    var newCategory by remember { mutableStateOf("默认分类") }
    var newDesc by remember { mutableStateOf("") }
    var newIsPublic by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }

    var showJoinShareDialog by remember { mutableStateOf(false) }
    var shareCodeInput by remember { mutableStateOf("") }
    var sharePwdInput by remember { mutableStateOf("") }
    var joiningShare by remember { mutableStateOf(false) }
    var joinError by remember { mutableStateOf<String?>(null) }

    var cloningId by remember { mutableStateOf<String?>(null) }
    var deleteConfirmBank by remember { mutableStateOf<QuestionBankSummary?>(null) }

    fun loadBanks(silent: Boolean = false) {
        scope.launch {
            if (!silent && banks.isEmpty()) loading = true
            errorMsg = null
            try {
                val res = viewModel.api().listBanks(
                    scope = activeScope,
                    q = keyword.trim().ifEmpty { null }
                )
                banks = res.banks
            } catch (e: Exception) {
                errorMsg = ApiClient.parseError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(activeScope) {
        selectedCategory = "全部"
        loadBanks(silent = false)
    }

    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME && !loading) {
                loadBanks(silent = true)
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val categories = remember(banks) {
        val unique = banks.mapNotNull { it.category.trim().ifEmpty { null } }.distinct()
        listOf("全部") + unique
    }

    val filteredBanks = remember(banks, selectedCategory) {
        if (selectedCategory == "全部") banks else banks.filter { it.category.trim() == selectedCategory }
    }

    val currentUser = viewModel.currentUser
    val scopeTabs = listOf("mine" to "我的题库", "shared" to "好友分享", "public" to "公共广场")

    Scaffold(
        containerColor = palette.canvas,
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showCreateDialog = true },
                shape = CircleShape,
                elevation = FloatingActionButtonDefaults.elevation(0.dp, 0.dp),
                containerColor = palette.brand,
                contentColor = Color.White
            ) {
                Icon(imageVector = Icons.Default.Add, contentDescription = "新建题库")
            }
        }
    ) { innerPad ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                KsbSegmentedControl(
                    items = scopeTabs,
                    selectedKey = activeScope,
                    onSelect = { activeScope = it }
                )

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedTextField(
                        value = keyword,
                        onValueChange = { keyword = it },
                        placeholder = { Text("搜索题库名称...", fontSize = 13.sp, color = palette.textMuted) },
                        leadingIcon = { Icon(Icons.Default.Search, contentDescription = null, tint = palette.textMuted) },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = palette.brand,
                            unfocusedBorderColor = Color.Transparent,
                            focusedContainerColor = palette.card,
                            unfocusedContainerColor = palette.card
                        ),
                        modifier = Modifier.weight(1f)
                    )
                    KsbOutlineButton(text = "筛选", onClick = { loadBanks() })
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    KsbOutlineButton(
                        text = "导入题库",
                        onClick = onOpenImport,
                        modifier = Modifier.weight(1f)
                    )
                    KsbOutlineButton(
                        text = "分享码加入",
                        onClick = {
                            joinError = null
                            showJoinShareDialog = true
                        },
                        contentColor = palette.ai,
                        modifier = Modifier.weight(1f)
                    )
                }

                if (categories.size > 1) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        categories.forEach { cat ->
                            FilterChip(
                                selected = selectedCategory == cat,
                                onClick = { selectedCategory = cat },
                                shape = RoundedCornerShape(50),
                                label = { Text(cat, fontSize = 12.sp) },
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = palette.brandSoft,
                                    selectedLabelColor = palette.brandDark
                                )
                            )
                        }
                    }
                }
            }

            if (loading && banks.isEmpty()) {
                KsbLoadingView("正在加载题库列表...")
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(horizontal = 20.dp, vertical = 10.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    if (errorMsg != null) {
                        item { KsbBanner(text = errorMsg!!, isError = true) }
                    }

                    if (filteredBanks.isEmpty()) {
                        item {
                            KsbEmptyView(
                                icon = if (activeScope == "shared") Icons.Default.Key else Icons.Default.Book,
                                title = when (activeScope) {
                                    "mine" -> "暂无个人题库"
                                    "shared" -> "暂无好友私密分享"
                                    else -> "暂无公共题库"
                                },
                                subtitle = when (activeScope) {
                                    "shared" -> "可点击上方「凭私密分享码加库」输入分享码加入"
                                    else -> "点击右下角 + 新建题库，或通过导题中心导入"
                                },
                                actionText = if (activeScope == "shared") "输入分享码加入" else "导入题库",
                                onAction = if (activeScope == "shared") {
                                    { showJoinShareDialog = true }
                                } else onOpenImport
                            )
                        }
                    } else {
                        items(filteredBanks, key = { it.id }) { bank ->
                            val isOwner = bank.ownerId == currentUser?.id || currentUser?.role == "admin"
                            val pct = if (bank.questionCount > 0) {
                                bank.practicedCount.toFloat() / bank.questionCount
                            } else 0f

                            KsbCard(modifier = Modifier.clickable { onOpenBank(bank.id) }) {
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
                                        KsbBadge(
                                            text = bank.category.ifBlank { "题库" },
                                            containerColor = palette.brand,
                                            contentColor = Color.White
                                        )
                                        KsbBadge(
                                            text = if (bank.visibility == "public") "公开" else "私有",
                                            containerColor = if (bank.visibility == "public") palette.successBg else palette.cardElevated,
                                            contentColor = if (bank.visibility == "public") palette.success else palette.textSecondary
                                        )
                                        if (bank.sharedWithMe) {
                                            KsbBadge(
                                                text = "好友私密分享",
                                                containerColor = palette.aiBg,
                                                contentColor = palette.ai
                                            )
                                        } else if (bank.shareEnabled || bank.sharedUserCount > 0) {
                                            KsbBadge(
                                                text = "私密分享中",
                                                containerColor = palette.aiBg,
                                                contentColor = palette.ai
                                            )
                                        }
                                    }

                                    if (isOwner) {
                                        IconButton(
                                            onClick = { deleteConfirmBank = bank },
                                            modifier = Modifier.size(30.dp)
                                        ) {
                                            Icon(
                                                imageVector = Icons.Default.DeleteOutline,
                                                contentDescription = "删除题库",
                                                tint = palette.textMuted,
                                                modifier = Modifier.size(18.dp)
                                            )
                                        }
                                    }
                                }

                                Spacer(modifier = Modifier.height(6.dp))
                                Text(
                                    text = bank.title,
                                    fontSize = 16.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = palette.textPrimary
                                )
                                if (bank.description.isNotBlank()) {
                                    Spacer(modifier = Modifier.height(3.dp))
                                    Text(
                                        text = bank.description,
                                        fontSize = 12.sp,
                                        color = palette.textSecondary,
                                        maxLines = 2
                                    )
                                }

                                Spacer(modifier = Modifier.height(8.dp))
                                FlowRow(
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                    verticalArrangement = Arrangement.spacedBy(4.dp)
                                ) {
                                    Text("共 ${bank.questionCount} 题", fontSize = 12.sp, color = palette.textSecondary)
                                    Text("已练 ${bank.practicedCount}", fontSize = 12.sp, color = palette.brand)
                                    Text("${bank.chapterCount} 章", fontSize = 12.sp, color = palette.textSecondary)
                                    if (bank.mistakeCount > 0) {
                                        Text(
                                            "错题 ${bank.mistakeCount}",
                                            fontSize = 12.sp,
                                            color = palette.error,
                                            fontWeight = FontWeight.SemiBold
                                        )
                                    }
                                    Text(
                                        text = "作者：${sanitizeDisplayName(bank.ownerName, "匿名")}",
                                        fontSize = 11.sp,
                                        color = palette.textMuted
                                    )
                                }

                                Spacer(modifier = Modifier.height(8.dp))
                                LinearProgressIndicator(
                                    progress = { pct.coerceIn(0f, 1f) },
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(5.dp)
                                        .clip(RoundedCornerShape(4.dp)),
                                    color = palette.brand,
                                    trackColor = palette.cardElevated
                                )

                                Spacer(modifier = Modifier.height(12.dp))
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                                ) {
                                    KsbOutlineButton(
                                        text = "题库详情",
                                        onClick = { onOpenBank(bank.id) },
                                        modifier = Modifier.weight(1f)
                                    )
                                    if (!isOwner) {
                                        KsbOutlineButton(
                                            text = if (cloningId == bank.id) "克隆中" else "克隆",
                                            enabled = cloningId != bank.id,
                                            onClick = {
                                                cloningId = bank.id
                                                scope.launch {
                                                    try {
                                                        val res = viewModel.api().cloneBank(bank.id)
                                                        onOpenBank(res.id)
                                                    } catch (e: Exception) {
                                                        errorMsg = ApiClient.parseError(e)
                                                    } finally {
                                                        cloningId = null
                                                    }
                                                }
                                            }
                                        )
                                    }
                                    KsbPrimaryButton(
                                        text = "开始刷题",
                                        onClick = { onStartPractice(bank.id, "sequential", false) },
                                        modifier = Modifier.weight(1f)
                                    )
                                }
                            }
                        }
                    }

                    item { Spacer(modifier = Modifier.height(60.dp)) }
                }
            }
        }
    }

    if (showCreateDialog) {
        AlertDialog(
            onDismissRequest = { showCreateDialog = false },
            title = { Text("新建题库", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        value = newTitle,
                        onValueChange = { newTitle = it },
                        label = { Text("题库名称") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = newCategory,
                        onValueChange = { newCategory = it },
                        label = { Text("分类标签") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = newDesc,
                        onValueChange = { newDesc = it },
                        label = { Text("简介说明（可选）") },
                        maxLines = 3,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("公开共享到公共广场", fontSize = 13.sp, color = palette.textPrimary)
                        Switch(checked = newIsPublic, onCheckedChange = { newIsPublic = it })
                    }
                }
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = "创建并进入",
                    loading = creating,
                    enabled = newTitle.trim().isNotEmpty(),
                    onClick = {
                        creating = true
                        scope.launch {
                            try {
                                val created = viewModel.api().createBank(
                                    CreateBankRequest(
                                        title = newTitle.trim(),
                                        category = newCategory.trim().ifEmpty { "默认分类" },
                                        description = newDesc.trim(),
                                        visibility = if (newIsPublic) "public" else "private"
                                    )
                                )
                                showCreateDialog = false
                                newTitle = ""
                                newDesc = ""
                                onOpenBank(created.id)
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

    if (showJoinShareDialog) {
        AlertDialog(
            onDismissRequest = { showJoinShareDialog = false },
            title = { Text("加入私密分享题库", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (joinError != null) {
                        KsbBanner(text = joinError!!, isError = true)
                    }
                    OutlinedTextField(
                        value = shareCodeInput,
                        onValueChange = { shareCodeInput = it.uppercase() },
                        label = { Text("8 位私密分享码") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        value = sharePwdInput,
                        onValueChange = { sharePwdInput = it },
                        label = { Text("访问口令（无口令可留空）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = "验证并加入",
                    loading = joiningShare,
                    enabled = shareCodeInput.trim().isNotEmpty(),
                    onClick = {
                        joiningShare = true
                        joinError = null
                        scope.launch {
                            try {
                                val joined = viewModel.api().joinSharedBank(
                                    JoinBankShareRequest(
                                        shareCode = shareCodeInput.trim().uppercase(),
                                        password = sharePwdInput.trim()
                                    )
                                )
                                showJoinShareDialog = false
                                shareCodeInput = ""
                                sharePwdInput = ""
                                activeScope = "shared"
                                onOpenBank(joined.bankId)
                            } catch (e: Exception) {
                                joinError = ApiClient.parseError(e)
                            } finally {
                                joiningShare = false
                            }
                        }
                    }
                )
            },
            dismissButton = {
                TextButton(onClick = { showJoinShareDialog = false }) { Text("取消") }
            }
        )
    }

    if (deleteConfirmBank != null) {
        val target = deleteConfirmBank!!
        AlertDialog(
            onDismissRequest = { deleteConfirmBank = null },
            title = { Text("删除题库", fontWeight = FontWeight.Bold) },
            text = { Text("确定要删除题库「${target.title}」吗？题库内所有试题将一并永久删除。") },
            confirmButton = {
                KsbPrimaryButton(
                    text = "确认删除",
                    containerColor = palette.error,
                    onClick = {
                        deleteConfirmBank = null
                        scope.launch {
                            try {
                                viewModel.api().deleteBank(target.id)
                                loadBanks()
                            } catch (e: Exception) {
                                errorMsg = ApiClient.parseError(e)
                            }
                        }
                    }
                )
            },
            dismissButton = {
                TextButton(onClick = { deleteConfirmBank = null }) { Text("取消") }
            }
        )
    }
}
