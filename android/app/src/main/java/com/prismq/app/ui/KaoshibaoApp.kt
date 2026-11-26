package com.prismq.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ScaffoldDefaults
import androidx.compose.material3.TextButton
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Assignment
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LightMode
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.prismq.app.ui.components.KsbCircleIconButton
import com.prismq.app.ui.components.KsbLoadingView
import com.prismq.app.ui.screens.AdminScreen
import com.prismq.app.ui.screens.AuthScreen
import com.prismq.app.ui.screens.BankDetailScreen
import com.prismq.app.ui.screens.BanksScreen
import com.prismq.app.ui.screens.DashboardScreen
import com.prismq.app.ui.screens.ExamAnalyticsScreen
import com.prismq.app.ui.screens.ExamReportScreen
import com.prismq.app.ui.screens.ExamTakeScreen
import com.prismq.app.ui.screens.ExamsScreen
import com.prismq.app.ui.screens.ImportScreen
import com.prismq.app.ui.screens.MistakesScreen
import com.prismq.app.ui.screens.PracticeScreen
import com.prismq.app.ui.screens.SearchScreen
import com.prismq.app.ui.screens.SettingsScreen
import com.prismq.app.ui.theme.KsbTheme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private data class BottomTabItem(
    val route: String,
    val label: String,
    val icon: ImageVector
)

private val MAIN_TABS = listOf(
    BottomTabItem("home", "学习", Icons.Default.Home),
    BottomTabItem("banks", "题库", Icons.Default.Book),
    BottomTabItem("mistakes", "错题", Icons.Default.ErrorOutline),
    BottomTabItem("exams", "考试", Icons.AutoMirrored.Filled.Assignment)
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun KaoshibaoApp(mainViewModel: MainViewModel = viewModel()) {
    val palette = KsbTheme.colors

    if (mainViewModel.isInitializing) {
        KsbLoadingView("正在连接棱题 · PrismQ...")
        return
    }

    val activeUser = mainViewModel.currentUser
    if (activeUser == null) {
        AuthScreen(viewModel = mainViewModel)
        AppUpdatePromptDialog(viewModel = mainViewModel)
        return
    }

    key(activeUser.id) {
        val context = LocalContext.current
    val notificationPermLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
        onResult = { }
    )
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                notificationPermLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    val navController = rememberNavController()
    val backStack by navController.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route ?: "home"
    val showMainChrome = currentRoute == "home" ||
        currentRoute == "banks" ||
        currentRoute == "mistakes" ||
        currentRoute == "exams"

    // 前台真实使用时长采集与心搏上报（仅在前台 RESUMED 时累加，过滤后台）
    val lifecycleOwner = LocalLifecycleOwner.current
    val heartbeatScope = rememberCoroutineScope()
    var isForeground by remember { mutableStateOf(true) }
    var pendingUsageSec by remember { mutableIntStateOf(0) }

    fun resolveUsageMode(route: String): String = when {
        route.startsWith("practice") -> "practice"
        route.startsWith("exam/take") -> "exam"
        else -> "general"
    }

    fun resolveUsagePath(route: String): String = "/android/${route.substringBefore('?')}"

    DisposableEffect(lifecycleOwner, mainViewModel.currentUser?.id) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> isForeground = true
                Lifecycle.Event.ON_PAUSE -> {
                    isForeground = false
                    val sec = pendingUsageSec
                    if (sec >= 5) {
                        pendingUsageSec = 0
                        val mode = resolveUsageMode(currentRoute)
                        val path = resolveUsagePath(currentRoute)
                        heartbeatScope.launch {
                            mainViewModel.reportHeartbeat(sec, mode, path)
                        }
                    }
                }
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    LaunchedEffect(mainViewModel.currentUser?.id, isForeground) {
        if (!isForeground) return@LaunchedEffect
        while (isForeground) {
            delay(1000L)
            pendingUsageSec += 1
            if (pendingUsageSec >= 30) {
                val sec = pendingUsageSec
                pendingUsageSec = 0
                mainViewModel.reportHeartbeat(
                    deltaSeconds = sec,
                    mode = resolveUsageMode(currentRoute),
                    path = resolveUsagePath(currentRoute)
                )
            }
        }
    }

    fun navigateTopTab(route: String) {
        navController.navigate(route) {
            popUpTo(navController.graph.findStartDestination().id) {
                saveState = true
            }
            launchSingleTop = true
            restoreState = true
        }
    }

    fun openPractice(
        bankId: String,
        mode: String,
        recite: Boolean,
        chapterId: String? = null,
        type: String? = null,
        difficultyTier: String? = null,
        minStar: Int = 0
    ) {
        mainViewModel.setPracticeLaunchParams(
            bankId = bankId,
            mode = mode,
            recite = recite,
            chapterId = chapterId,
            type = type,
            difficultyTier = difficultyTier,
            minStar = minStar
        )
        navController.navigate("practice")
    }

    val isAdmin = mainViewModel.currentUser?.role == "admin"
    val headerTitle = when (currentRoute) {
        "banks" -> "题库"
        "mistakes" -> "错题"
        "exams" -> "考试"
        else -> "学习"
    }

    val defaultWindowInsets = ScaffoldDefaults.contentWindowInsets
    val zeroWindowInsets = remember { WindowInsets(0, 0, 0, 0) }

    Scaffold(
        containerColor = palette.canvas,
        contentWindowInsets = if (showMainChrome) defaultWindowInsets else zeroWindowInsets,
        topBar = {
            if (showMainChrome) {
                TopAppBar(
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = palette.canvas,
                        scrolledContainerColor = palette.canvas
                    ),
                    title = {
                        Text(
                            text = headerTitle,
                            fontSize = 26.sp,
                            fontWeight = FontWeight.Bold,
                            letterSpacing = (-0.5).sp,
                            color = palette.textPrimary
                        )
                    },
                    actions = {
                        Row(
                            modifier = Modifier.padding(end = 12.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            KsbCircleIconButton(
                                icon = Icons.Default.Search,
                                contentDescription = "搜题",
                                onClick = { navController.navigate("search") }
                            )
                            KsbCircleIconButton(
                                icon = if (mainViewModel.darkMode) Icons.Default.LightMode else Icons.Default.DarkMode,
                                contentDescription = if (mainViewModel.darkMode) "切换浅色模式" else "切换深色模式",
                                tint = if (mainViewModel.darkMode) palette.warning else palette.textPrimary,
                                onClick = { mainViewModel.toggleDarkMode() }
                            )
                            if (isAdmin) {
                                KsbCircleIconButton(
                                    icon = Icons.Default.AdminPanelSettings,
                                    contentDescription = "管理台",
                                    tint = palette.brand,
                                    onClick = { navController.navigate("admin") }
                                )
                            }
                            KsbCircleIconButton(
                                icon = Icons.Default.Settings,
                                contentDescription = "设置",
                                onClick = { navController.navigate("settings") }
                            )
                        }
                    }
                )
            }
        },
        bottomBar = {
            if (showMainChrome) {
                Column {
                    HorizontalDivider(thickness = 0.5.dp, color = palette.border)
                    NavigationBar(
                        containerColor = palette.card,
                        tonalElevation = 0.dp
                    ) {
                        MAIN_TABS.forEach { tab ->
                            val selected = currentRoute == tab.route
                            NavigationBarItem(
                                selected = selected,
                                onClick = { navigateTopTab(tab.route) },
                                icon = { Icon(tab.icon, contentDescription = tab.label) },
                                label = {
                                    Text(
                                        text = tab.label,
                                        fontSize = 11.sp,
                                        fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium
                                    )
                                },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = palette.brand,
                                    selectedTextColor = palette.brand,
                                    indicatorColor = Color.Transparent,
                                    unselectedIconColor = palette.textMuted,
                                    unselectedTextColor = palette.textMuted
                                )
                            )
                        }
                    }
                }
            }
        }
    ) { innerPad ->
        NavHost(
            navController = navController,
            startDestination = "home",
            modifier = Modifier.padding(innerPad)
        ) {
            composable("home") {
                DashboardScreen(
                    viewModel = mainViewModel,
                    onOpenBank = { id -> navController.navigate("bank/$id") },
                    onStartPractice = { id, m, r -> openPractice(id, m, r) },
                    onOpenImport = { navController.navigate("import") { launchSingleTop = true } },
                    onOpenSearch = { navController.navigate("search") },
                    onOpenMistakes = { navigateTopTab("mistakes") },
                    onOpenSettings = { navController.navigate("settings") },
                    onOpenAdmin = { navController.navigate("admin") },
                    onJoinExam = { code -> navController.navigate("exam/take/$code") }
                )
            }

            composable("banks") {
                BanksScreen(
                    viewModel = mainViewModel,
                    onOpenBank = { id -> navController.navigate("bank/$id") },
                    onStartPractice = { id, m, r -> openPractice(id, m, r) },
                    onOpenImport = { navController.navigate("import") { launchSingleTop = true } }
                )
            }

            composable(
                route = "import?bankId={bankId}",
                arguments = listOf(navArgument("bankId") { type = NavType.StringType; defaultValue = "" })
            ) { entry ->
                val bankIdArg = entry.arguments?.getString("bankId")?.ifBlank { null }
                ImportScreen(
                    initialBankId = bankIdArg,
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() },
                    onBankImported = { targetId ->
                        navController.navigate("bank/$targetId") {
                            launchSingleTop = true
                        }
                    }
                )
            }

            composable("mistakes") {
                MistakesScreen(
                    viewModel = mainViewModel,
                    onStartMistakesPractice = { mode -> openPractice("all", mode, false) }
                )
            }

            composable("exams") {
                ExamsScreen(
                    viewModel = mainViewModel,
                    onTakeExam = { code -> navController.navigate("exam/take/$code") },
                    onOpenReport = { subId -> navController.navigate("exam/report/$subId") },
                    onOpenAnalytics = { examId -> navController.navigate("exam/analytics/$examId") }
                )
            }

            composable(
                route = "bank/{bankId}",
                arguments = listOf(navArgument("bankId") { type = NavType.StringType })
            ) { entry ->
                val bankId = entry.arguments?.getString("bankId") ?: return@composable
                BankDetailScreen(
                    bankId = bankId,
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() },
                    onStartPractice = { id, m, r, ch, qType, tier, minStar ->
                        openPractice(id, m, r, ch, qType, tier, minStar)
                    },
                    onOpenImport = { id -> navController.navigate("import?bankId=$id") },
                    onExamCreated = { code -> navController.navigate("exam/take/$code") }
                )
            }

            composable("practice") {
                val params = mainViewModel.practiceLaunchParams
                PracticeScreen(
                    bankId = params.bankId,
                    mode = params.mode,
                    initialRecite = params.recite,
                    chapterId = params.chapterId,
                    typeFilter = params.type,
                    difficultyTierFilter = params.difficultyTier,
                    minStarFilter = params.minStar,
                    launchKey = params.launchId,
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() }
                )
            }

            composable("search") {
                SearchScreen(
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() }
                )
            }

            composable("settings") {
                SettingsScreen(
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() },
                    onOpenAdmin = { navController.navigate("admin") }
                )
            }

            composable("admin") {
                AdminScreen(
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() },
                    onOpenBank = { id -> navController.navigate("bank/$id") },
                    onOpenSettings = { navController.navigate("settings") }
                )
            }

            composable(
                route = "exam/take/{shareCode}",
                arguments = listOf(navArgument("shareCode") { type = NavType.StringType })
            ) { entry ->
                val shareCode = entry.arguments?.getString("shareCode") ?: return@composable
                ExamTakeScreen(
                    shareCode = shareCode,
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() },
                    onSubmitted = { subId ->
                        navController.navigate("exam/report/$subId") {
                            popUpTo("exam/take/$shareCode") { inclusive = true }
                        }
                    }
                )
            }

            composable(
                route = "exam/report/{submissionId}",
                arguments = listOf(navArgument("submissionId") { type = NavType.StringType })
            ) { entry ->
                val subId = entry.arguments?.getString("submissionId") ?: return@composable
                ExamReportScreen(
                    submissionId = subId,
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() }
                )
            }

            composable(
                route = "exam/analytics/{examId}",
                arguments = listOf(navArgument("examId") { type = NavType.StringType })
            ) { entry ->
                val eid = entry.arguments?.getString("examId") ?: return@composable
                ExamAnalyticsScreen(
                    examId = eid,
                    viewModel = mainViewModel,
                    onBack = { navController.popBackStack() },
                    onOpenSubmissionReport = { subId -> navController.navigate("exam/report/$subId") }
                )
            }
        }
    }
    }

    AppUpdatePromptDialog(viewModel = mainViewModel)
}

@Composable
private fun AppUpdatePromptDialog(viewModel: MainViewModel) {
    val release = viewModel.availableUpdate
    if (!viewModel.updateDialogVisible || release == null) return

    val palette = KsbTheme.colors
    val versionLabel = "v${com.prismq.app.util.AppUpdateManager.normalizeVersion(release.versionName)}"
    val sizeLabel = com.prismq.app.util.AppUpdateManager.formatByteSize(release.fileSize)
    val downloading = viewModel.isDownloadingUpdate
    val progress = viewModel.updateDownloadProgress
    val statusMsg = viewModel.updateStatusMessage

    AlertDialog(
        onDismissRequest = {
            if (!downloading && !release.forceUpdate) {
                viewModel.dismissUpdateDialog()
            }
        },
        containerColor = palette.card,
        title = {
            Text(
                text = "发现新版本 $versionLabel",
                fontSize = 18.sp,
                fontWeight = FontWeight.SemiBold,
                color = palette.textPrimary
            )
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "安装包：${release.fileName.ifBlank { "prismq.apk" }}（$sizeLabel）",
                    fontSize = 12.sp,
                    color = palette.textSecondary
                )
                if (release.releaseNotes.isNotBlank()) {
                    Spacer(modifier = Modifier.height(10.dp))
                    Text(
                        text = release.releaseNotes,
                        fontSize = 13.sp,
                        lineHeight = 19.sp,
                        color = palette.textPrimary
                    )
                }
                if (downloading) {
                    Spacer(modifier = Modifier.height(12.dp))
                    LinearProgressIndicator(
                        progress = { progress.coerceIn(0f, 1f) },
                        modifier = Modifier.fillMaxWidth(),
                        color = palette.brand,
                        trackColor = palette.border
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "已下载 ${(progress * 100).toInt().coerceIn(0, 100)}%",
                        fontSize = 12.sp,
                        color = palette.brand
                    )
                }
                if (!statusMsg.isNullOrBlank()) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = statusMsg,
                        fontSize = 12.sp,
                        color = if (statusMsg.contains("失败") || statusMsg.contains("未通过")) palette.error else palette.brand
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !downloading,
                onClick = { viewModel.downloadAndInstallUpdate() }
            ) {
                Text(
                    text = if (downloading) {
                        "下载中..."
                    } else if (viewModel.downloadedApkFile?.exists() == true) {
                        "立即安装"
                    } else {
                        "立即更新"
                    },
                    color = palette.brand,
                    fontWeight = FontWeight.SemiBold
                )
            }
        },
        dismissButton = if (!release.forceUpdate) {
            {
                TextButton(
                    enabled = !downloading,
                    onClick = { viewModel.dismissUpdateDialog() }
                ) {
                    Text("稍后再说", color = palette.textSecondary)
                }
            }
        } else {
            null
        }
    )
}

internal fun buildPracticeRoute(
    bankId: String,
    mode: String,
    recite: Boolean,
    chapterId: String? = null,
    type: String? = null,
    difficultyTier: String? = null,
    minStar: Int = 0
): String {
    fun encodeParam(raw: String): String =
        java.net.URLEncoder.encode(raw, "UTF-8").replace("+", "%20")

    val safeBankId = encodeParam(bankId.ifBlank { "all" })
    val queryParts = buildList {
        add("mode=${encodeParam(mode.ifBlank { "sequential" })}")
        add("recite=$recite")
        chapterId?.trim()?.takeIf { it.isNotEmpty() }?.let { add("chapterId=${encodeParam(it)}") }
        type?.trim()?.takeIf { it.isNotEmpty() }?.let { add("type=${encodeParam(it)}") }
        difficultyTier?.trim()?.takeIf { it.isNotEmpty() }?.let { add("difficultyTier=${encodeParam(it)}") }
        add("minStar=$minStar")
    }
    return "practice/$safeBankId?${queryParts.joinToString("&")}"
}
