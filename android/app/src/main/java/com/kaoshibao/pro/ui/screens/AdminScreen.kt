package com.kaoshibao.pro.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kaoshibao.pro.data.model.AdminAiJobItem
import com.kaoshibao.pro.data.model.AdminAuditLogItem
import com.kaoshibao.pro.data.model.AdminBankItem
import com.kaoshibao.pro.data.model.AdminCreateUserRequest
import com.kaoshibao.pro.data.model.AdminExamItem
import com.kaoshibao.pro.data.model.AdminOverviewResponse
import com.kaoshibao.pro.data.model.AdminResetPasswordRequest
import com.kaoshibao.pro.data.model.AdminUpdateBankRequest
import com.kaoshibao.pro.data.model.AdminUpdateExamRequest
import com.kaoshibao.pro.data.model.AdminUpdateUserRequest
import com.kaoshibao.pro.data.model.AdminUsageResponse
import com.kaoshibao.pro.data.model.AdminUserItem
import com.kaoshibao.pro.data.model.SystemPolicyDto
import com.kaoshibao.pro.data.model.formatDurationSeconds
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

private val ADMIN_TABS = listOf("总览", "用户", "使用时长", "全站题库", "考场/AI", "审计日志")
private val USAGE_DAYS_OPTIONS = listOf("1" to "今日", "7" to "近7天", "30" to "近30天", "90" to "近90天", "all" to "全部")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminScreen(
    viewModel: MainViewModel,
    onBack: () -> Unit,
    onOpenBank: (String) -> Unit,
    onOpenSettings: () -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    val currentUser = viewModel.currentUser

    if (currentUser?.role != "admin") {
        Scaffold(
            containerColor = palette.canvas,
            topBar = {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.card),
                    title = { Text("系统管理", fontWeight = FontWeight.Bold) },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                        }
                    }
                )
            }
        ) { pad ->
            Box(modifier = Modifier.padding(pad).padding(16.dp)) {
                KsbBanner(text = "仅系统管理员可访问控制台", isError = true)
            }
        }
        return
    }

    var activeTab by remember { mutableIntStateOf(0) }
    var bannerMsg by remember { mutableStateOf<String?>(null) }
    var bannerErr by remember { mutableStateOf<String?>(null) }

    var overview by remember { mutableStateOf<AdminOverviewResponse?>(null) }
    var users by remember { mutableStateOf<List<AdminUserItem>>(emptyList()) }
    var userSearch by remember { mutableStateOf("") }
    var usageData by remember { mutableStateOf<AdminUsageResponse?>(null) }
    var usageDays by remember { mutableStateOf("7") }
    var usageSearch by remember { mutableStateOf("") }
    var banks by remember { mutableStateOf<List<AdminBankItem>>(emptyList()) }
    var bankSearch by remember { mutableStateOf("") }
    var exams by remember { mutableStateOf<List<AdminExamItem>>(emptyList()) }
    var aiJobs by remember { mutableStateOf<List<AdminAiJobItem>>(emptyList()) }
    var auditLogs by remember { mutableStateOf<List<AdminAuditLogItem>>(emptyList()) }
    var loading by remember { mutableStateOf(false) }

    // 弹窗状态
    var showCreateUser by remember { mutableStateOf(false) }
    var newUsername by remember { mutableStateOf("") }
    var newEmail by remember { mutableStateOf("") }
    var newNickname by remember { mutableStateOf("") }
    var newPassword by remember { mutableStateOf("") }
    var newIsAdmin by remember { mutableStateOf(false) }

    var resetPwdTarget by remember { mutableStateOf<AdminUserItem?>(null) }
    var resetPwdInput by remember { mutableStateOf("") }

    var usageDetailLabel by remember { mutableStateOf<String?>(null) }
    var usageDetailRes by remember { mutableStateOf<AdminUsageResponse?>(null) }

    var transferBankTarget by remember { mutableStateOf<AdminBankItem?>(null) }
    var transferOwnerId by remember { mutableStateOf("") }
    var transferMenuOpen by remember { mutableStateOf(false) }

    fun loadCurrentTab() {
        scope.launch {
            loading = true
            bannerErr = null
            try {
                when (activeTab) {
                    0 -> overview = viewModel.api().getAdminOverview()
                    1 -> users = viewModel.api().listAdminUsers(q = userSearch.trim().ifEmpty { null }).users
                    2 -> usageData = viewModel.api().getAdminUsage(days = usageDays, q = usageSearch.trim().ifEmpty { null })
                    3 -> banks = viewModel.api().listAdminBanks(q = bankSearch.trim().ifEmpty { null }).banks
                    4 -> {
                        exams = viewModel.api().listAdminExams().exams
                        aiJobs = viewModel.api().listAdminAiJobs().jobs
                    }
                    5 -> auditLogs = viewModel.api().getAdminAuditLogs(80).logs
                }
            } catch (e: Exception) {
                bannerErr = ApiClient.parseError(e)
            } finally {
                loading = false
            }
        }
    }

    LaunchedEffect(activeTab, usageDays) { loadCurrentTab() }

    fun openUserUsageDetail(userId: String, label: String) {
        usageDetailLabel = label
        usageDetailRes = null
        scope.launch {
            try {
                usageDetailRes = viewModel.api().getAdminUsage(days = "30", userId = userId)
            } catch (e: Exception) {
                bannerErr = ApiClient.parseError(e)
                usageDetailLabel = null
            }
        }
    }

    Scaffold(
        containerColor = palette.canvas,
        topBar = {
            Column(modifier = Modifier.background(palette.card)) {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.card),
                    title = { Text("系统管理控制台", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary) },
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = palette.textPrimary)
                        }
                    },
                    actions = {
                        IconButton(onClick = { loadCurrentTab() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "刷新", tint = palette.brand)
                        }
                    }
                )
                ScrollableTabRow(
                    selectedTabIndex = activeTab,
                    containerColor = palette.card,
                    contentColor = palette.brand,
                    edgePadding = 12.dp
                ) {
                    ADMIN_TABS.forEachIndexed { idx, label ->
                        Tab(
                            selected = activeTab == idx,
                            onClick = { activeTab = idx },
                            text = { Text(label, fontWeight = FontWeight.SemiBold, fontSize = 13.sp) }
                        )
                    }
                }
            }
        }
    ) { innerPad ->
        if (loading && ((activeTab == 0 && overview == null) || (activeTab == 2 && usageData == null))) {
            Box(modifier = Modifier.padding(innerPad).fillMaxSize()) {
                KsbLoadingView("正在加载全站管理数据...")
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (bannerErr != null) item { KsbBanner(text = bannerErr!!, isError = true) }
            if (bannerMsg != null) item { KsbBanner(text = bannerMsg!!, isError = false) }

            when (activeTab) {
                /* -------------------- TAB 0: 总览 -------------------- */
                0 -> {
                    val ov = overview
                    if (ov != null) {
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                AdminMetricCard("总用户", "${ov.users.total}", "管理${ov.users.admins}·禁${ov.users.disabled}", Modifier.weight(1f))
                                AdminMetricCard("今日/7日活", "${ov.users.todayActive}/${ov.users.last7dActive}", "真实活跃人数", Modifier.weight(1f))
                            }
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                AdminMetricCard("全站使用时长", formatDurationSeconds(ov.usage.totalSeconds), "今日 ${formatDurationSeconds(ov.usage.todaySeconds)}", Modifier.weight(1f))
                                AdminMetricCard("题库 / 题目", "${ov.content.totalBanks}/${ov.content.totalQuestions}", "公${ov.content.publicBanks}·私${ov.content.privateBanks}·AI评${ov.content.ratedQuestions}", Modifier.weight(1f))
                            }
                        }
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                AdminMetricCard("刷题 / 正确率", "${ov.learning.totalAnswered}", "正确率 ${ov.learning.accuracyPercent}%", Modifier.weight(1f))
                                AdminMetricCard("考场 / AI任务", "${ov.exams.totalExams}/${ov.aiJobs.total}", "交卷${ov.exams.totalSubmissions}·数据库 ${ov.dbEngine}", Modifier.weight(1f))
                            }
                        }
                        item {
                            KsbCard {
                                Text("近 14 天全站使用时长趋势", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                Spacer(modifier = Modifier.height(10.dp))
                                val maxSec = maxOf(1L, ov.dailyTrend.maxOfOrNull { it.activeSeconds } ?: 1L)
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(110.dp),
                                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                                    verticalAlignment = Alignment.Bottom
                                ) {
                                    ov.dailyTrend.forEach { pt ->
                                        val frac = if (pt.activeSeconds > 0) {
                                            (pt.activeSeconds.toFloat() / maxSec).coerceIn(0.08f, 1f)
                                        } else 0.04f
                                        Column(
                                            modifier = Modifier.weight(1f),
                                            horizontalAlignment = Alignment.CenterHorizontally
                                        ) {
                                            Box(
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .height(84.dp)
                                                    .background(palette.cardElevated, RoundedCornerShape(4.dp)),
                                                contentAlignment = Alignment.BottomCenter
                                            ) {
                                                Box(
                                                    modifier = Modifier
                                                        .fillMaxWidth()
                                                        .fillMaxHeight(frac)
                                                        .background(
                                                            if (pt.activeSeconds > 0) palette.brand else palette.border,
                                                            RoundedCornerShape(4.dp)
                                                        )
                                                )
                                            }
                                            Spacer(modifier = Modifier.height(4.dp))
                                            Text(pt.date.takeLast(2), fontSize = 9.sp, color = palette.textMuted)
                                        }
                                    }
                                }
                            }
                        }
                        item {
                            KsbCard {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("允许公开自助注册", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                        Text(
                                            if (ov.policy.allowRegistration) "所有人可在登录页自行注册账号" else "已关闭，仅管理员可在后台开户",
                                            fontSize = 11.sp,
                                            color = palette.textSecondary
                                        )
                                    }
                                    Switch(
                                        checked = ov.policy.allowRegistration,
                                        onCheckedChange = { next ->
                                            scope.launch {
                                                try {
                                                    val res = viewModel.api().updateAdminPolicy(SystemPolicyDto(next))
                                                    overview = ov.copy(policy = res.policy)
                                                    bannerMsg = if (next) "已开启自助注册" else "已关闭公开自助注册"
                                                } catch (e: Exception) {
                                                    bannerErr = ApiClient.parseError(e)
                                                }
                                            }
                                        }
                                    )
                                }
                                Spacer(modifier = Modifier.height(10.dp))
                                KsbOutlineButton(
                                    text = "前往系统设置配置全站 AI Key",
                                    modifier = Modifier.fillMaxWidth(),
                                    onClick = onOpenSettings
                                )
                            }
                        }
                    }
                }

                /* -------------------- TAB 1: 用户管理 -------------------- */
                1 -> {
                    item {
                        KsbCard(contentPadding = PaddingValues(12.dp)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                OutlinedTextField(
                                    value = userSearch,
                                    onValueChange = { userSearch = it },
                                    placeholder = { Text("搜用户名 / 昵称 / 邮箱", fontSize = 12.sp) },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f)
                                )
                                KsbOutlineButton(text = "查", onClick = { loadCurrentTab() })
                                KsbPrimaryButton(text = "+ 建号", onClick = { showCreateUser = true })
                            }
                        }
                    }

                    if (users.isEmpty()) {
                        item { KsbEmptyView(icon = Icons.Default.Add, title = "暂无匹配用户") }
                    } else {
                        items(users, key = { it.id }) { u ->
                            val isSelf = u.id == currentUser.id
                            KsbCard {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                        Text(u.nickname.ifBlank { u.username }, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                        Text("@${u.username}", fontSize = 11.sp, color = palette.textMuted)
                                        KsbBadge(text = if (u.role == "admin") "管理员" else "成员")
                                        KsbBadge(
                                            text = if (u.isDisabled) "已禁用" else "正常",
                                            containerColor = if (u.isDisabled) palette.errorBg else palette.successBg,
                                            contentColor = if (u.isDisabled) palette.error else palette.success
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = "${u.email} · ${u.bankCount}库/${u.questionCount}题 · 刷题${u.answeredCount} · 交卷${u.submissionCount}",
                                    fontSize = 11.sp,
                                    color = palette.textSecondary
                                )
                                Text(
                                    text = "总时长 ${formatDurationSeconds(u.totalActiveSeconds)} · 今日 ${formatDurationSeconds(u.todayActiveSeconds)} · 7日 ${formatDurationSeconds(u.last7dActiveSeconds)}",
                                    fontSize = 12.sp,
                                    color = palette.brand,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Spacer(modifier = Modifier.height(8.dp))
                                Row(
                                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                                    horizontalArrangement = Arrangement.spacedBy(6.dp)
                                ) {
                                    KsbOutlineButton(
                                        text = "时长明细",
                                        onClick = { openUserUsageDetail(u.id, "${u.nickname.ifBlank { u.username }} (@${u.username})") }
                                    )
                                    if (!isSelf) {
                                        KsbOutlineButton(
                                            text = if (u.role == "admin") "降为成员" else "升管理员",
                                            onClick = {
                                                scope.launch {
                                                    try {
                                                        viewModel.api().updateAdminUser(u.id, AdminUpdateUserRequest(role = if (u.role == "admin") "member" else "admin"))
                                                        loadCurrentTab()
                                                    } catch (e: Exception) {
                                                        bannerErr = ApiClient.parseError(e)
                                                    }
                                                }
                                            }
                                        )
                                        KsbOutlineButton(
                                            text = if (u.isDisabled) "启用" else "禁用",
                                            borderColor = if (u.isDisabled) palette.success else palette.warning,
                                            contentColor = if (u.isDisabled) palette.success else palette.warning,
                                            onClick = {
                                                scope.launch {
                                                    try {
                                                        viewModel.api().updateAdminUser(u.id, AdminUpdateUserRequest(isDisabled = !u.isDisabled))
                                                        loadCurrentTab()
                                                    } catch (e: Exception) {
                                                        bannerErr = ApiClient.parseError(e)
                                                    }
                                                }
                                            }
                                        )
                                    }
                                    KsbOutlineButton(
                                        text = "改密",
                                        onClick = {
                                            resetPwdTarget = u
                                            resetPwdInput = ""
                                        }
                                    )
                                    if (!isSelf) {
                                        KsbOutlineButton(
                                            text = "删除",
                                            borderColor = palette.error,
                                            contentColor = palette.error,
                                            onClick = {
                                                scope.launch {
                                                    try {
                                                        viewModel.api().deleteAdminUser(u.id)
                                                        bannerMsg = "已删除账号 ${u.username}"
                                                        loadCurrentTab()
                                                    } catch (e: Exception) {
                                                        bannerErr = ApiClient.parseError(e)
                                                    }
                                                }
                                            }
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                /* -------------------- TAB 2: 使用时长查询 -------------------- */
                2 -> {
                    item {
                        KsbCard(contentPadding = PaddingValues(12.dp)) {
                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                USAGE_DAYS_OPTIONS.forEach { (key, label) ->
                                    FilterChip(
                                        selected = usageDays == key,
                                        onClick = { usageDays = key },
                                        label = { Text(label, fontSize = 12.sp) }
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(
                                    value = usageSearch,
                                    onValueChange = { usageSearch = it },
                                    placeholder = { Text("按用户名或昵称筛选...", fontSize = 12.sp) },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f)
                                )
                                KsbOutlineButton(text = "查询", onClick = { loadCurrentTab() })
                            }
                        }
                    }

                    usageData?.let { ud ->
                        item {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                AdminMetricCard("周期总时长", formatDurationSeconds(ud.summary.totalSeconds), "活跃 ${ud.summary.activeUsers} 人", Modifier.weight(1f))
                                AdminMetricCard("刷题 / 考试", formatDurationSeconds(ud.summary.practiceSeconds), "考试 ${formatDurationSeconds(ud.summary.examSeconds)}", Modifier.weight(1f))
                            }
                        }
                        items(ud.userRanking, key = { it.userId }) { row ->
                            KsbCard(
                                modifier = Modifier.clickable {
                                    openUserUsageDetail(row.userId, "${row.nickname.ifBlank { row.username }} (@${row.username})")
                                }
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text("${row.nickname.ifBlank { row.username }} (@${row.username})", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                        Text(
                                            "活跃 ${row.activeDays} 天 · 刷题 ${formatDurationSeconds(row.practiceSeconds)} · 考试 ${formatDurationSeconds(row.examSeconds)}",
                                            fontSize = 11.sp,
                                            color = palette.textSecondary
                                        )
                                    }
                                    Text(formatDurationSeconds(row.activeSeconds), fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, color = palette.brand)
                                }
                            }
                        }
                    }
                }

                /* -------------------- TAB 3: 全站题库管理 -------------------- */
                3 -> {
                    item {
                        KsbCard(contentPadding = PaddingValues(12.dp)) {
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                OutlinedTextField(
                                    value = bankSearch,
                                    onValueChange = { bankSearch = it },
                                    placeholder = { Text("搜全站题库(含私有)...", fontSize = 12.sp) },
                                    singleLine = true,
                                    modifier = Modifier.weight(1f)
                                )
                                KsbOutlineButton(text = "搜索", onClick = { loadCurrentTab() })
                            }
                        }
                    }

                    items(banks, key = { it.id }) { b ->
                        KsbCard {
                            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                KsbBadge(text = b.category.ifBlank { "默认" })
                                KsbBadge(
                                    text = if (b.visibility == "public") "公开" else "私有",
                                    containerColor = if (b.visibility == "public") palette.successBg else palette.cardElevated,
                                    contentColor = if (b.visibility == "public") palette.success else palette.textSecondary
                                )
                                if (b.shareEnabled) KsbBadge(text = "私密分享中", containerColor = palette.aiBg, contentColor = palette.ai)
                            }
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(b.title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                            Text(
                                text = "归属：${b.ownerNickname.ifBlank { b.ownerUsername }} (@${b.ownerUsername}) · ${b.questionCount}题(AI评${b.ratedCount})",
                                fontSize = 11.sp,
                                color = palette.textSecondary
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Row(
                                modifier = Modifier.horizontalScroll(rememberScrollState()),
                                horizontalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                KsbPrimaryButton(text = "管理内容", onClick = { onOpenBank(b.id) })
                                KsbOutlineButton(
                                    text = if (b.visibility == "public") "转私有" else "设公开",
                                    onClick = {
                                        scope.launch {
                                            try {
                                                viewModel.api().updateAdminBank(
                                                    b.id,
                                                    AdminUpdateBankRequest(visibility = if (b.visibility == "public") "private" else "public")
                                                )
                                                loadCurrentTab()
                                            } catch (e: Exception) {
                                                bannerErr = ApiClient.parseError(e)
                                            }
                                        }
                                    }
                                )
                                KsbOutlineButton(
                                    text = "转移归属",
                                    onClick = {
                                        transferBankTarget = b
                                        transferOwnerId = b.ownerId
                                        if (users.isEmpty()) {
                                            scope.launch {
                                                try {
                                                    users = viewModel.api().listAdminUsers().users
                                                } catch (_: Exception) {
                                                }
                                            }
                                        }
                                    }
                                )
                                KsbOutlineButton(
                                    text = "删除",
                                    borderColor = palette.error,
                                    contentColor = palette.error,
                                    onClick = {
                                        scope.launch {
                                            try {
                                                viewModel.api().deleteAdminBank(b.id)
                                                bannerMsg = "已删除题库 ${b.title}"
                                                loadCurrentTab()
                                            } catch (e: Exception) {
                                                bannerErr = ApiClient.parseError(e)
                                            }
                                        }
                                    }
                                )
                            }
                        }
                    }
                }

                /* -------------------- TAB 4: 全站考场与 AI 任务 -------------------- */
                4 -> {
                    item { Text("全站考场 (${exams.size})", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary) }
                    items(exams, key = { it.id }) { ex ->
                        KsbCard {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(ex.title, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary, modifier = Modifier.weight(1f))
                                KsbBadge(
                                    text = if (ex.status == "active") "进行中" else "已关闭",
                                    containerColor = if (ex.status == "active") palette.successBg else palette.errorBg,
                                    contentColor = if (ex.status == "active") palette.success else palette.error
                                )
                            }
                            Text(
                                "创建：@${ex.creatorUsername} · 码:${ex.shareCode} · ${ex.questionCount}题 · 交卷${ex.submissionCount}人",
                                fontSize = 11.sp,
                                color = palette.textSecondary
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                KsbOutlineButton(
                                    text = if (ex.status == "active") "关闭考场" else "重新开启",
                                    onClick = {
                                        scope.launch {
                                            try {
                                                viewModel.api().updateAdminExam(
                                                    ex.id,
                                                    AdminUpdateExamRequest(status = if (ex.status == "active") "closed" else "active")
                                                )
                                                loadCurrentTab()
                                            } catch (e: Exception) {
                                                bannerErr = ApiClient.parseError(e)
                                            }
                                        }
                                    }
                                )
                                KsbOutlineButton(
                                    text = "删除",
                                    borderColor = palette.error,
                                    contentColor = palette.error,
                                    onClick = {
                                        scope.launch {
                                            try {
                                                viewModel.api().deleteAdminExam(ex.id)
                                                loadCurrentTab()
                                            } catch (e: Exception) {
                                                bannerErr = ApiClient.parseError(e)
                                            }
                                        }
                                    }
                                )
                            }
                        }
                    }

                    item { Text("全站 AI 转换任务 (${aiJobs.size})", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary) }
                    items(aiJobs, key = { it.id }) { j ->
                        KsbCard {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(j.sourceFilename.ifBlank { "文本清洗" }, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                                KsbBadge(text = "${j.status} (${j.progressPct}%)")
                            }
                            Text("发起：@${j.username} · 导入${j.importedCount}题 · ${j.modelUsed}", fontSize = 11.sp, color = palette.textSecondary)
                            if (j.errorMessage.isNotBlank()) {
                                Text(j.errorMessage, fontSize = 11.sp, color = palette.error)
                            }
                            if (j.status != "running" && j.status != "queued") {
                                TextButton(onClick = {
                                    scope.launch {
                                        try {
                                            viewModel.api().deleteAdminAiJob(j.id)
                                            loadCurrentTab()
                                        } catch (e: Exception) {
                                            bannerErr = ApiClient.parseError(e)
                                        }
                                    }
                                }) {
                                    Text("清理记录", fontSize = 11.sp, color = palette.error)
                                }
                            }
                        }
                    }
                }

                /* -------------------- TAB 5: 审计日志 -------------------- */
                5 -> {
                    if (auditLogs.isEmpty()) {
                        item { KsbEmptyView(icon = Icons.Default.History, title = "暂无管理员操作审计记录") }
                    } else {
                        items(auditLogs, key = { it.id }) { log ->
                            KsbCard(contentPadding = PaddingValues(12.dp)) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                                        KsbBadge(text = log.action)
                                        Text("${log.actorName} -> ${log.targetLabel.ifBlank { log.targetId }}", fontSize = 12.sp, color = palette.textPrimary)
                                    }
                                }
                                Spacer(modifier = Modifier.height(2.dp))
                                Text(log.createdAt.take(19).replace('T', ' '), fontSize = 10.sp, color = palette.textMuted)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showCreateUser) {
        AlertDialog(
            onDismissRequest = { showCreateUser = false },
            title = { Text("新建用户", fontWeight = FontWeight.Bold) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = newUsername, onValueChange = { newUsername = it }, label = { Text("用户名") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = newEmail, onValueChange = { newEmail = it }, label = { Text("邮箱") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = newNickname, onValueChange = { newNickname = it }, label = { Text("昵称（可选）") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = newPassword, onValueChange = { newPassword = it }, label = { Text("初始密码 (≥6位)") }, visualTransformation = PasswordVisualTransformation(), singleLine = true, modifier = Modifier.fillMaxWidth())
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Text("设为系统管理员", fontSize = 13.sp)
                        Switch(checked = newIsAdmin, onCheckedChange = { newIsAdmin = it })
                    }
                }
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = "创建",
                    onClick = {
                        scope.launch {
                            try {
                                viewModel.api().createAdminUser(
                                    AdminCreateUserRequest(
                                        username = newUsername.trim(),
                                        email = newEmail.trim(),
                                        password = newPassword,
                                        nickname = newNickname.trim(),
                                        role = if (newIsAdmin) "admin" else "member"
                                    )
                                )
                                showCreateUser = false
                                newUsername = ""
                                newEmail = ""
                                newNickname = ""
                                newPassword = ""
                                bannerMsg = "新用户已创建"
                                loadCurrentTab()
                            } catch (e: Exception) {
                                bannerErr = ApiClient.parseError(e)
                            }
                        }
                    }
                )
            },
            dismissButton = { TextButton(onClick = { showCreateUser = false }) { Text("取消") } }
        )
    }

    if (resetPwdTarget != null) {
        AlertDialog(
            onDismissRequest = { resetPwdTarget = null },
            title = { Text("重置密码 · ${resetPwdTarget?.username}", fontWeight = FontWeight.Bold) },
            text = {
                OutlinedTextField(
                    value = resetPwdInput,
                    onValueChange = { resetPwdInput = it },
                    label = { Text("新密码 (≥6位)") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = "确认重置",
                    enabled = resetPwdInput.length >= 6,
                    onClick = {
                        val target = resetPwdTarget ?: return@KsbPrimaryButton
                        scope.launch {
                            try {
                                viewModel.api().resetAdminUserPassword(target.id, AdminResetPasswordRequest(resetPwdInput))
                                resetPwdTarget = null
                                bannerMsg = "已重置 ${target.username} 的密码"
                            } catch (e: Exception) {
                                bannerErr = ApiClient.parseError(e)
                            }
                        }
                    }
                )
            },
            dismissButton = { TextButton(onClick = { resetPwdTarget = null }) { Text("取消") } }
        )
    }

    if (usageDetailLabel != null) {
        AlertDialog(
            onDismissRequest = { usageDetailLabel = null },
            title = { Text("近30天时长 · $usageDetailLabel", fontSize = 15.sp, fontWeight = FontWeight.Bold) },
            text = {
                val res = usageDetailRes
                if (res == null) {
                    Text("加载逐日明细中...", fontSize = 12.sp)
                } else if (res.userDaily.isEmpty()) {
                    Text("近 30 天暂无前台活跃时长记录", fontSize = 12.sp)
                } else {
                    Column(
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            "合计：${formatDurationSeconds(res.summary.totalSeconds)}（刷题 ${formatDurationSeconds(res.summary.practiceSeconds)} · 考试 ${formatDurationSeconds(res.summary.examSeconds)}）",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = palette.brand
                        )
                        res.userDaily.forEach { d ->
                            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(d.date, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                                Text(
                                    "总 ${formatDurationSeconds(d.activeSeconds)} (题${formatDurationSeconds(d.practiceSeconds)})",
                                    fontSize = 11.sp,
                                    color = palette.textSecondary
                                )
                            }
                        }
                    }
                }
            },
            confirmButton = { TextButton(onClick = { usageDetailLabel = null }) { Text("关闭") } }
        )
    }

    if (transferBankTarget != null) {
        val target = transferBankTarget!!
        AlertDialog(
            onDismissRequest = { transferBankTarget = null },
            title = { Text("转移归属 · ${target.title}", fontSize = 15.sp, fontWeight = FontWeight.Bold) },
            text = {
                val chosenOwner = users.firstOrNull { it.id == transferOwnerId }
                ExposedDropdownMenuBox(
                    expanded = transferMenuOpen,
                    onExpandedChange = { transferMenuOpen = !transferMenuOpen }
                ) {
                    OutlinedTextField(
                        value = chosenOwner?.let { "${it.nickname.ifBlank { it.username }} (@${it.username})" } ?: target.ownerUsername,
                        onValueChange = {},
                        readOnly = true,
                        label = { Text("目标归属用户") },
                        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = transferMenuOpen) },
                        modifier = Modifier
                            .fillMaxWidth()
                            .menuAnchor(MenuAnchorType.PrimaryNotEditable)
                    )
                    ExposedDropdownMenu(
                        expanded = transferMenuOpen,
                        onDismissRequest = { transferMenuOpen = false }
                    ) {
                        users.forEach { u ->
                            DropdownMenuItem(
                                text = { Text("${u.nickname.ifBlank { u.username }} (@${u.username})") },
                                onClick = {
                                    transferOwnerId = u.id
                                    transferMenuOpen = false
                                }
                            )
                        }
                    }
                }
            },
            confirmButton = {
                KsbPrimaryButton(
                    text = "确认转移",
                    onClick = {
                        scope.launch {
                            try {
                                viewModel.api().updateAdminBank(target.id, AdminUpdateBankRequest(ownerId = transferOwnerId))
                                transferBankTarget = null
                                bannerMsg = "已转移题库归属权"
                                loadCurrentTab()
                            } catch (e: Exception) {
                                bannerErr = ApiClient.parseError(e)
                            }
                        }
                    }
                )
            },
            dismissButton = { TextButton(onClick = { transferBankTarget = null }) { Text("取消") } }
        )
    }
}

@Composable
private fun AdminMetricCard(
    label: String,
    value: String,
    sub: String,
    modifier: Modifier = Modifier
) {
    val palette = KsbTheme.colors
    KsbCard(modifier = modifier, contentPadding = PaddingValues(12.dp)) {
        Text(label, fontSize = 11.sp, color = palette.textSecondary)
        Spacer(modifier = Modifier.height(4.dp))
        Text(value, fontSize = 17.sp, fontWeight = FontWeight.ExtraBold, color = palette.textPrimary)
        Spacer(modifier = Modifier.height(2.dp))
        Text(sub, fontSize = 10.sp, color = palette.textMuted, maxLines = 1)
    }
}
