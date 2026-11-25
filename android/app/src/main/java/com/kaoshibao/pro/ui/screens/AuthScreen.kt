package com.kaoshibao.pro.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.kaoshibao.pro.ui.MainViewModel
import com.kaoshibao.pro.ui.components.KsbBadge
import com.kaoshibao.pro.ui.components.KsbBanner
import com.kaoshibao.pro.ui.components.KsbCard
import com.kaoshibao.pro.ui.components.KsbOutlineButton
import com.kaoshibao.pro.ui.components.KsbPrimaryButton
import com.kaoshibao.pro.ui.components.KsbSegmentedControl
import com.kaoshibao.pro.ui.theme.KsbTheme
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(viewModel: MainViewModel) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    var isRegisterMode by remember { mutableStateOf(false) }
    var needsSetup by remember { mutableStateOf(false) }
    var allowRegistration by remember { mutableStateOf(true) }

    var serverUrlInput by remember(viewModel.serverUrl) { mutableStateOf(viewModel.serverUrl) }
    var serverStatusMsg by remember { mutableStateOf<String?>(null) }
    var checkingServer by remember { mutableStateOf(false) }
    var serverNonce by remember { mutableStateOf(0) }

    var account by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var nickname by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    var submitting by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf(viewModel.authBannerError) }

    LaunchedEffect(viewModel.serverUrl, serverNonce) {
        try {
            val status = viewModel.api().bootstrapStatus()
            needsSetup = status.needsSetup
            allowRegistration = status.allowRegistration
            if (status.needsSetup) {
                isRegisterMode = true
            } else if (!status.allowRegistration) {
                isRegisterMode = false
            }
        } catch (_: Exception) {
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(palette.canvas)
            .statusBarsPadding()
    ) {
        IconButton(
            onClick = { viewModel.toggleDarkMode() },
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(8.dp)
        ) {
            Icon(
                imageVector = if (viewModel.darkMode) Icons.Default.LightMode else Icons.Default.DarkMode,
                contentDescription = if (viewModel.darkMode) "浅色模式" else "黑夜模式",
                tint = if (viewModel.darkMode) palette.warning else palette.textSecondary
            )
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(14.dp))
            Box(
                modifier = Modifier
                    .size(64.dp)
                    .background(palette.brand, RoundedCornerShape(18.dp)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Default.School,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(34.dp)
                )
            }
            Spacer(modifier = Modifier.height(14.dp))
            Text(
                text = "棱题 · PrismQ",
                fontSize = 26.sp,
                fontWeight = FontWeight.Bold,
                letterSpacing = (-0.5).sp,
                color = palette.textPrimary
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "极简 AI 刷题与动态均衡组卷",
                fontSize = 13.sp,
                color = palette.textSecondary,
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(24.dp))

            if (needsSetup) {
                KsbBanner(
                    text = "系统首次初始化：当前尚无用户，注册的首个账号将自动成为系统管理员（admin）。",
                    isError = false
                )
                Spacer(modifier = Modifier.height(14.dp))
            } else if (!allowRegistration) {
                KsbBanner(
                    text = "系统管理员已关闭公开自助注册，请使用已分配账号登录。",
                    isError = false
                )
                Spacer(modifier = Modifier.height(14.dp))
            }

            KsbCard(
                cornerRadius = 22.dp,
                contentPadding = PaddingValues(20.dp)
            ) {
                if (needsSetup || allowRegistration) {
                    KsbSegmentedControl(
                        items = listOf(
                            "login" to "账号登录",
                            "register" to if (needsSetup) "创建管理员" else "注册新账号"
                        ),
                        selectedKey = if (isRegisterMode) "register" else "login",
                        onSelect = { key ->
                            isRegisterMode = key == "register"
                            errorMsg = null
                        }
                    )
                    Spacer(modifier = Modifier.height(18.dp))
                } else {
                    Text(
                        text = "账号登录",
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.textPrimary
                    )
                    Spacer(modifier = Modifier.height(14.dp))
                }

                if (errorMsg != null) {
                    KsbBanner(text = errorMsg!!, isError = true)
                    Spacer(modifier = Modifier.height(12.dp))
                }

                val authFieldColors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = palette.brand,
                    unfocusedBorderColor = Color.Transparent,
                    focusedContainerColor = palette.cardElevated,
                    unfocusedContainerColor = palette.cardElevated
                )

                OutlinedTextField(
                    value = serverUrlInput,
                    onValueChange = { serverUrlInput = it },
                    label = { Text("服务器地址（支持 http/https）") },
                    singleLine = true,
                    shape = RoundedCornerShape(14.dp),
                    colors = authFieldColors,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(6.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = serverStatusMsg ?: "当前连接：${viewModel.serverUrl}",
                        fontSize = 11.sp,
                        color = palette.textSecondary,
                        modifier = Modifier.weight(1f).padding(end = 8.dp)
                    )
                    KsbOutlineButton(
                        text = if (checkingServer) "检测中..." else "应用并检测",
                        enabled = !checkingServer && serverUrlInput.isNotBlank(),
                        onClick = {
                            checkingServer = true
                            errorMsg = null
                            serverStatusMsg = null
                            scope.launch {
                                val res = viewModel.saveServerUrl(serverUrlInput)
                                checkingServer = false
                                res.onSuccess {
                                    serverStatusMsg = it
                                    serverNonce += 1
                                }.onFailure {
                                    errorMsg = it.message ?: "无法连接到服务器"
                                }
                            }
                        }
                    )
                }
                Spacer(modifier = Modifier.height(14.dp))

                if (!isRegisterMode) {
                    OutlinedTextField(
                        value = account,
                        onValueChange = { account = it },
                        label = { Text("用户名或邮箱") },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        colors = authFieldColors,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("密码") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        colors = authFieldColors,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(20.dp))
                    KsbPrimaryButton(
                        text = "登录",
                        loading = submitting,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        onClick = {
                            if (account.isBlank() || password.isBlank()) {
                                errorMsg = "请填写账号和密码"
                                return@KsbPrimaryButton
                            }
                            submitting = true
                            errorMsg = null
                            scope.launch {
                                val res = viewModel.login(account, password)
                                submitting = false
                                res.onFailure { errorMsg = it.message }
                            }
                        }
                    )
                } else {
                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text("用户名（3~32 位字母/数字/下划线）") },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        colors = authFieldColors,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = email,
                        onValueChange = { email = it },
                        label = { Text("邮箱") },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        colors = authFieldColors,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = nickname,
                        onValueChange = { nickname = it },
                        label = { Text("显示昵称（选填）") },
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        colors = authFieldColors,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("设置密码（至少 6 位）") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        shape = RoundedCornerShape(14.dp),
                        colors = authFieldColors,
                        modifier = Modifier.fillMaxWidth()
                    )
                    Spacer(modifier = Modifier.height(20.dp))
                    KsbPrimaryButton(
                        text = if (needsSetup) "注册首位管理员并进入" else "注册并登录",
                        loading = submitting,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        onClick = {
                            if (username.isBlank() || email.isBlank() || password.length < 6) {
                                errorMsg = "请填写有效用户名、邮箱及不少于 6 位的密码"
                                return@KsbPrimaryButton
                            }
                            submitting = true
                            errorMsg = null
                            scope.launch {
                                val res = viewModel.register(username, email, password, nickname)
                                submitting = false
                                res.onFailure { errorMsg = it.message }
                            }
                        }
                    )
                }
            }
        }
    }
}
