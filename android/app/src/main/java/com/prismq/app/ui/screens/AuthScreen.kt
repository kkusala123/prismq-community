package com.prismq.app.ui.screens

import androidx.compose.foundation.Canvas
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.components.KsbBadge
import com.prismq.app.ui.components.KsbBanner
import com.prismq.app.ui.components.KsbCard
import com.prismq.app.ui.components.KsbPrimaryButton
import com.prismq.app.ui.components.KsbSegmentedControl
import com.prismq.app.ui.theme.KsbTheme
import kotlinx.coroutines.launch

@Composable
fun AuthScreen(viewModel: MainViewModel) {
    val palette = KsbTheme.colors
    val scope = rememberCoroutineScope()
    var isRegisterMode by remember { mutableStateOf(false) }
    var needsSetup by remember { mutableStateOf(false) }
    var allowRegistration by remember { mutableStateOf(true) }

    var account by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var nickname by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    var submitting by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf(viewModel.authBannerError) }

    LaunchedEffect(Unit) {
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
            Canvas(
                modifier = Modifier
                    .size(64.dp)
                    .clip(RoundedCornerShape(18.dp))
            ) {
                val w = size.width
                val h = size.height
                drawRect(
                    brush = Brush.linearGradient(
                        colors = listOf(Color(0xFF0F172A), Color(0xFF1E3A8A), Color(0xFF2554A8)),
                        start = Offset.Zero,
                        end = Offset(w, h)
                    )
                )
                val stroke = w * 0.042f
                drawLine(
                    color = Color(0xFF38BDF8),
                    start = Offset(w * 0.535f, h * 0.438f),
                    end = Offset(w * 0.800f, h * 0.382f),
                    strokeWidth = stroke,
                    cap = StrokeCap.Round
                )
                drawLine(
                    color = Color(0xFF34D399),
                    start = Offset(w * 0.570f, h * 0.508f),
                    end = Offset(w * 0.825f, h * 0.508f),
                    strokeWidth = stroke,
                    cap = StrokeCap.Round
                )
                drawLine(
                    color = Color(0xFFFBBF24),
                    start = Offset(w * 0.602f, h * 0.578f),
                    end = Offset(w * 0.800f, h * 0.634f),
                    strokeWidth = stroke,
                    cap = StrokeCap.Round
                )
                val apex = Offset(w * 0.468f, h * 0.242f)
                val leftBase = Offset(w * 0.242f, h * 0.720f)
                val rightBase = Offset(w * 0.648f, h * 0.720f)
                val center = Offset(w * 0.445f, h * 0.558f)

                drawPath(
                    path = Path().apply {
                        moveTo(apex.x, apex.y)
                        lineTo(leftBase.x, leftBase.y)
                        lineTo(center.x, center.y)
                        close()
                    },
                    color = Color.White.copy(alpha = 0.97f)
                )
                drawPath(
                    path = Path().apply {
                        moveTo(apex.x, apex.y)
                        lineTo(rightBase.x, rightBase.y)
                        lineTo(center.x, center.y)
                        close()
                    },
                    color = Color(0xFF93C5FD).copy(alpha = 0.92f)
                )
                drawPath(
                    path = Path().apply {
                        moveTo(leftBase.x, leftBase.y)
                        lineTo(rightBase.x, rightBase.y)
                        lineTo(center.x, center.y)
                        close()
                    },
                    color = Color(0xFF3B82F6).copy(alpha = 0.96f)
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
