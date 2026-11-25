package com.kaoshibao.pro.ui.screens

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kaoshibao.pro.BuildConfig
import com.kaoshibao.pro.data.model.AiTestRequest
import com.kaoshibao.pro.data.model.ChangePasswordRequest
import com.kaoshibao.pro.data.model.PersonalAiConfigDto
import com.kaoshibao.pro.data.model.UpdateAdminAiConfigRequest
import com.kaoshibao.pro.data.model.UpdateSettingsRequest
import com.kaoshibao.pro.data.model.sanitizeDisplayName
import com.kaoshibao.pro.data.remote.ApiClient
import com.kaoshibao.pro.ui.MainViewModel
import com.kaoshibao.pro.ui.components.KsbBadge
import com.kaoshibao.pro.ui.components.KsbBanner
import com.kaoshibao.pro.ui.components.KsbCard
import com.kaoshibao.pro.ui.components.KsbOutlineButton
import com.kaoshibao.pro.ui.components.KsbPrimaryButton
import com.kaoshibao.pro.ui.theme.KsbTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    viewModel: MainViewModel,
    onBack: () -> Unit,
    onOpenAdmin: () -> Unit
) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    val user = viewModel.currentUser
    val isAdmin = user?.role == "admin"

    var serverUrlInput by remember(viewModel.serverUrl) { mutableStateOf(viewModel.serverUrl) }
    var savingServer by remember { mutableStateOf(false) }

    var nickname by remember(user?.id) {
        mutableStateOf(sanitizeDisplayName(user?.nickname, user?.username ?: ""))
    }
    var removeCountText by remember(user?.id) {
        mutableStateOf((user?.settings?.removeAfterCorrectCount ?: 3).toString())
    }
    var autoNext by remember(user?.id) {
        mutableStateOf(user?.settings?.autoNextOnCorrect ?: true)
    }
    var autoNextDelayMs by remember(user?.id) {
        mutableIntStateOf(user?.settings?.autoNextDelayMs ?: viewModel.autoNextDelayMs)
    }
    var switchAnimationMs by remember(user?.id) {
        mutableIntStateOf(user?.settings?.switchAnimationMs ?: viewModel.switchAnimationMs)
    }

    var personalBaseUrl by remember(user?.id) {
        mutableStateOf(user?.settings?.aiConfig?.baseUrl ?: "https://api.deepseek.com/v1")
    }
    var personalModel by remember(user?.id) {
        mutableStateOf(user?.settings?.aiConfig?.model ?: "deepseek-chat")
    }
    var personalKey by remember(user?.id) {
        mutableStateOf(user?.settings?.aiConfig?.apiKey ?: "")
    }

    var sysBaseUrl by remember { mutableStateOf("https://api.deepseek.com/v1") }
    var sysModel by remember { mutableStateOf("deepseek-chat") }
    var sysKey by remember { mutableStateOf("") }
    var sysHasKey by remember { mutableStateOf(false) }
    var allowMemberSysKey by remember { mutableStateOf(true) }

    var oldPwd by remember { mutableStateOf("") }
    var newPwd by remember { mutableStateOf("") }

    var msg by remember { mutableStateOf<String?>(null) }
    var errMsg by remember { mutableStateOf<String?>(null) }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(isAdmin) {
        if (isAdmin) {
            try {
                val res = viewModel.api().getAdminAiConfig().aiConfig
                sysBaseUrl = res.baseUrl.ifBlank { "https://api.deepseek.com/v1" }
                sysModel = res.model.ifBlank { "deepseek-chat" }
                sysKey = res.apiKey
                sysHasKey = res.hasApiKey
                allowMemberSysKey = res.allowMemberUseSystemKey
            } catch (_: Exception) {
            }
        }
    }

    Scaffold(
        containerColor = palette.canvas,
        topBar = {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = palette.card),
                title = { Text("系统设置", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = palette.textPrimary)
                    }
                }
            )
        }
    ) { innerPad ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPad),
            contentPadding = PaddingValues(14.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (errMsg != null) {
                item { KsbBanner(text = errMsg!!, isError = true) }
            }
            if (msg != null) {
                item { KsbBanner(text = msg!!, isError = false) }
            }

            // 1. 自定义服务器连接配置
            item {
                KsbCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("服务端连接", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        KsbBadge(text = "自建服务")
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = serverUrlInput,
                        onValueChange = { serverUrlInput = it },
                        label = { Text("服务器地址（支持 http/https）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text("更换服务器地址后需使用对应服务器的账号重新登录", fontSize = 11.sp, color = palette.textSecondary)
                    Spacer(modifier = Modifier.height(10.dp))
                    KsbOutlineButton(
                        text = if (savingServer) "连接验证中..." else "保存并测试服务器连接",
                        enabled = !savingServer && serverUrlInput.isNotBlank(),
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            savingServer = true
                            errMsg = null
                            msg = null
                            scope.launch {
                                val res = viewModel.saveServerUrl(serverUrlInput)
                                savingServer = false
                                res.onSuccess { msg = it }
                                    .onFailure { errMsg = it.message ?: "连接服务器失败" }
                            }
                        }
                    )
                }
            }

            // 2. 主题外观与切题节奏
            item {
                KsbCard {
                    Text("主题与刷题动画", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Spacer(modifier = Modifier.height(8.dp))
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
                        Text("刷题护眼底色", fontSize = 13.sp, color = palette.textPrimary)
                        Switch(checked = viewModel.eyeCare, onCheckedChange = { viewModel.updatePracticeAppearance(viewModel.fontSize, it) })
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Text("切题动画时长", fontSize = 12.sp, color = palette.textSecondary)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(0 to "无动画", 180 to "轻快", 260 to "丝滑(默认)", 420 to "柔和").forEach { (ms, label) ->
                            FilterChip(
                                selected = switchAnimationMs == ms,
                                onClick = {
                                    switchAnimationMs = ms
                                    viewModel.updatePracticeTiming(autoNextDelayMs, ms)
                                },
                                label = { Text(label, fontSize = 11.sp) }
                            )
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("答对自动跳下一题延迟", fontSize = 12.sp, color = palette.textSecondary)
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        listOf(250 to "0.25s", 450 to "0.45s", 650 to "0.65s(默认)", 1200 to "1.2s").forEach { (ms, label) ->
                            FilterChip(
                                selected = autoNextDelayMs == ms,
                                onClick = {
                                    autoNextDelayMs = ms
                                    viewModel.updatePracticeTiming(ms, switchAnimationMs)
                                },
                                label = { Text(label, fontSize = 11.sp) }
                            )
                        }
                    }
                }
            }

            // 3. 个人资料与刷题规则
            item {
                KsbCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("个人资料与练习规则", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                        KsbBadge(text = if (isAdmin) "系统管理员" else "普通成员")
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = nickname,
                        onValueChange = { nickname = it },
                        label = { Text("显示昵称") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = removeCountText,
                        onValueChange = { removeCountText = it.filter { c -> c.isDigit() } },
                        label = { Text("错题连对移出阈值（默认 3）") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("单选/判断答对后自动跳下一题", fontSize = 13.sp, color = palette.textPrimary)
                        Switch(checked = autoNext, onCheckedChange = { autoNext = it })
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                    KsbPrimaryButton(
                        text = "保存全部偏好至云端",
                        loading = saving,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            saving = true
                            errMsg = null
                            msg = null
                            scope.launch {
                                try {
                                    val res = viewModel.api().updateSettings(
                                        UpdateSettingsRequest(
                                            nickname = nickname.trim(),
                                            removeAfterCorrectCount = removeCountText.toIntOrNull()?.coerceIn(1, 20) ?: 3,
                                            autoNextOnCorrect = autoNext,
                                            autoNextDelayMs = autoNextDelayMs,
                                            switchAnimationMs = switchAnimationMs
                                        )
                                    )
                                    viewModel.replaceUser(res.user)
                                    msg = "个人与节奏设置已同步云端"
                                } catch (e: Exception) {
                                    errMsg = ApiClient.parseError(e)
                                } finally {
                                    saving = false
                                }
                            }
                        }
                    )
                }
            }

            if (isAdmin) {
                item {
                    KsbCard(borderColor = palette.brandBorder) {
                        Text("管理员专属系统管理台", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.brand)
                        Spacer(modifier = Modifier.height(4.dp))
                        Text("进入查看全站用户治理、真实使用时长统计、全站公私有题库及审计日志。", fontSize = 12.sp, color = palette.textSecondary)
                        Spacer(modifier = Modifier.height(10.dp))
                        KsbPrimaryButton(
                            text = "打开系统管理控制台",
                            modifier = Modifier.fillMaxWidth(),
                            onClick = onOpenAdmin
                        )
                    }
                }
            }

            // 4. 个人 AI 接口配置
            item {
                KsbCard {
                    Text("个人 AI API 配置（可选）", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Spacer(modifier = Modifier.height(4.dp))
                    Text("仅用于您个人账号的 AI 功能，与其他用户隔离。", fontSize = 12.sp, color = palette.textSecondary)
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = personalBaseUrl,
                        onValueChange = { personalBaseUrl = it },
                        label = { Text("Base URL") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = personalModel,
                        onValueChange = { personalModel = it },
                        label = { Text("模型名称") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = personalKey,
                        onValueChange = { personalKey = it },
                        label = { Text("个人 API Key") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        KsbOutlineButton(
                            text = "测试连接",
                            modifier = Modifier.weight(1f),
                            onClick = {
                                errMsg = null
                                msg = null
                                scope.launch {
                                    try {
                                        val res = viewModel.api().testAiConnection(
                                            AiTestRequest(
                                                scope = "personal",
                                                baseUrl = personalBaseUrl.trim(),
                                                apiKey = personalKey.trim(),
                                                model = personalModel.trim()
                                            )
                                        )
                                        if (res.ok) msg = "个人 AI 连通成功 (${res.latencyMs}ms)"
                                        else errMsg = res.error.ifBlank { "测试失败" }
                                    } catch (e: Exception) {
                                        errMsg = ApiClient.parseError(e)
                                    }
                                }
                            }
                        )
                        KsbPrimaryButton(
                            text = "保存个人 AI",
                            modifier = Modifier.weight(1f),
                            onClick = {
                                errMsg = null
                                msg = null
                                scope.launch {
                                    try {
                                        val res = viewModel.api().updateSettings(
                                            UpdateSettingsRequest(
                                                aiConfig = PersonalAiConfigDto(
                                                    baseUrl = personalBaseUrl.trim(),
                                                    apiKey = personalKey.trim(),
                                                    model = personalModel.trim()
                                                )
                                            )
                                        )
                                        viewModel.replaceUser(res.user)
                                        msg = "个人 AI 配置已保存"
                                    } catch (e: Exception) {
                                        errMsg = ApiClient.parseError(e)
                                    }
                                }
                            }
                        )
                    }
                }
            }

            if (isAdmin) {
                item {
                    KsbCard(borderColor = palette.brandBorder) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("全局共享 AI 配置 (Admin)", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.brand)
                            KsbBadge(text = if (sysHasKey) "已配置" else "未配置")
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        OutlinedTextField(
                            value = sysBaseUrl,
                            onValueChange = { sysBaseUrl = it },
                            label = { Text("全局 Base URL") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = sysModel,
                            onValueChange = { sysModel = it },
                            label = { Text("全局模型名称") },
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = sysKey,
                            onValueChange = { sysKey = it },
                            label = { Text("全局 API Key（留空保持原密钥）") },
                            visualTransformation = PasswordVisualTransformation(),
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth()
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("允许普通成员静默调用全局 AI", fontSize = 12.sp, color = palette.textPrimary, modifier = Modifier.weight(1f))
                            Switch(checked = allowMemberSysKey, onCheckedChange = { allowMemberSysKey = it })
                        }
                        Spacer(modifier = Modifier.height(10.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                            KsbOutlineButton(
                                text = "测试全局",
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    errMsg = null
                                    msg = null
                                    scope.launch {
                                        try {
                                            val res = viewModel.api().testAiConnection(
                                                AiTestRequest(
                                                    scope = "system",
                                                    baseUrl = sysBaseUrl.trim(),
                                                    apiKey = sysKey.trim(),
                                                    model = sysModel.trim()
                                                )
                                            )
                                            if (res.ok) msg = "全局 AI 测试成功 (${res.latencyMs}ms)"
                                            else errMsg = res.error.ifBlank { "测试失败" }
                                        } catch (e: Exception) {
                                            errMsg = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            )
                            KsbPrimaryButton(
                                text = "保存全局",
                                modifier = Modifier.weight(1f),
                                onClick = {
                                    errMsg = null
                                    msg = null
                                    scope.launch {
                                        try {
                                            val res = viewModel.api().updateAdminAiConfig(
                                                UpdateAdminAiConfigRequest(
                                                    baseUrl = sysBaseUrl.trim(),
                                                    model = sysModel.trim(),
                                                    apiKey = sysKey.trim(),
                                                    allowMemberUseSystemKey = allowMemberSysKey
                                                )
                                            ).aiConfig
                                            sysKey = res.apiKey
                                            sysHasKey = res.hasApiKey
                                            viewModel.refreshUser()
                                            msg = "全局 AI 配置已更新"
                                        } catch (e: Exception) {
                                            errMsg = ApiClient.parseError(e)
                                        }
                                    }
                                }
                            )
                        }
                    }
                }
            }

            // 5. 修改密码
            item {
                KsbCard {
                    Text("修改登录密码", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = oldPwd,
                        onValueChange = { oldPwd = it },
                        label = { Text("原密码") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newPwd,
                        onValueChange = { newPwd = it },
                        label = { Text("新密码（至少 6 位）") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    KsbOutlineButton(
                        text = "更新密码",
                        enabled = oldPwd.isNotBlank() && newPwd.length >= 6,
                        modifier = Modifier.fillMaxWidth(),
                        onClick = {
                            errMsg = null
                            msg = null
                            scope.launch {
                                try {
                                    viewModel.api().changePassword(ChangePasswordRequest(oldPwd, newPwd))
                                    oldPwd = ""
                                    newPwd = ""
                                    msg = "密码修改成功"
                                } catch (e: Exception) {
                                    errMsg = ApiClient.parseError(e)
                                }
                            }
                        }
                    )
                }
            }

            // 6. 应用更新与版本检测
            item {
                KsbCard {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("应用版本", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = palette.textPrimary)
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = "当前版本 v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                                fontSize = 12.sp,
                                color = palette.textSecondary
                            )
                            val latest = viewModel.availableUpdate
                            if (latest != null) {
                                Text(
                                    text = "发现新版本 v${com.kaoshibao.pro.util.AppUpdateManager.normalizeVersion(latest.versionName)}",
                                    fontSize = 12.sp,
                                    color = palette.brand,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }
                        KsbOutlineButton(
                            text = if (viewModel.isCheckingUpdate) "检查中..." else "检查更新",
                            enabled = !viewModel.isCheckingUpdate,
                            onClick = {
                                errMsg = null
                                msg = null
                                viewModel.checkAppUpdate(manual = true) { resultText ->
                                    msg = resultText
                                }
                            }
                        )
                    }

                    if (viewModel.availableUpdate != null) {
                        Spacer(modifier = Modifier.height(10.dp))
                        KsbPrimaryButton(
                            text = "立即下载并安装新版本",
                            modifier = Modifier.fillMaxWidth(),
                            onClick = { viewModel.openAvailableUpdatePrompt() }
                        )
                    }

                    if (isAdmin) {
                        Spacer(modifier = Modifier.height(8.dp))
                        KsbOutlineButton(
                            text = "从 GitHub 拉取最新 APK 并推送更新",
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                errMsg = null
                                msg = null
                                scope.launch {
                                    viewModel.adminSyncAndPushUpdate()
                                        .onSuccess { msg = it }
                                        .onFailure { errMsg = it.message ?: "同步推送失败" }
                                }
                            }
                        )
                    }
                }
            }

            item {
                KsbPrimaryButton(
                    text = "退出当前账号",
                    containerColor = palette.error,
                    modifier = Modifier.fillMaxWidth(),
                    onClick = { viewModel.logout() }
                )
                Spacer(modifier = Modifier.height(24.dp))
            }
        }
    }
}
