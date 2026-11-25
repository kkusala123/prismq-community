package com.kaoshibao.pro.ui

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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.LinearProgressIndicator
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
import com.kaoshibao.pro.ui.components.KsbCircleIconButton
import com.kaoshibao.pro.ui.components.KsbLoadingView
import com.kaoshibao.pro.ui.screens.AdminScreen
import com.kaoshibao.pro.ui.screens.AuthScreen
import com.kaoshibao.pro.ui.screens.BankDetailScreen
import com.kaoshibao.pro.ui.screens.BanksScreen
import com.kaoshibao.pro.ui.screens.DashboardScreen
import com.kaoshibao.pro.ui.screens.ExamReportScreen
import com.kaoshibao.pro.ui.screens.ExamTakeScreen
import com.kaoshibao.pro.ui.screens.ExamsScreen
import com.kaoshibao.pro.ui.screens.ImportScreen
import com.kaoshibao.pro.ui.screens.MistakesScreen
import com.kaoshibao.pro.ui.screens.PracticeScreen
import com.kaoshibao.pro.ui.screens.SearchScreen
import com.kaoshibao.pro.ui.screens.SettingsScreen
import com.kaoshibao.pro.ui.theme.KsbTheme
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

    if (mainViewModel.currentUser == null) {
        AuthScreen(viewModel = mainViewModel)
        AppUpdatePromptDialog(viewModel = mainViewModel)
        return
    }

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
        val encCh = Uri.encode(chapterId ?: "")
        val encType = Uri.encode(type ?: "")
        val encTier = Uri.encode(difficultyTier ?: "")
        navController.navigate(
            "practice/$bankId?mode=$mode&recite=$recite&chapterId=$encCh&type=$encType&difficultyTier=$encTier&minStar=$minStar"
        )
    }

    val isAdmin = mainViewModel.currentUser?.role == "admin"
    val headerTitle = when (currentRoute) {
        "banks" -> "题库"
        "mistakes" -> "错题"
        "exams" -> "考试"
        else -> "学习"
    }

    Scaffold(
        containerColor = palette.canvas,
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
                    onOpenReport = { subId -> navController.navigate("exam/report/$subId") }
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

            composable(
                route = "practice/{bankId}?mode={mode}&recite={recite}&chapterId={chapterId}&type={type}&difficultyTier={difficultyTier}&minStar={minStar}",
                arguments = listOf(
                    navArgument("bankId") { type = NavType.StringType },
                    navArgument("mode") { type = NavType.StringType; defaultValue = "sequential" },
                    navArgument("recite") { type = NavType.BoolType; defaultValue = false },
                    navArgument("chapterId") { type = NavType.StringType; defaultValue = "" },
                    navArgument("type") { type = NavType.StringType; defaultValue = "" },
                    navArgument("difficultyTier") { type = NavType.StringType; defaultValue = "" },
                    navArgument("minStar") { type = NavType.IntType; defaultValue = 0 }
                )
            ) { entry ->
                val bankId = entry.arguments?.getString("bankId") ?: "all"
                val mode = entry.arguments?.getString("mode") ?: "sequential"
                val recite = entry.arguments?.getBoolean("recite") ?: false
                val ch = entry.arguments?.getString("chapterId")?.ifBlank { null }
                val qType = entry.arguments?.getString("type")?.ifBlank { null }
                val tier = entry.arguments?.getString("difficultyTier")?.ifBlank { null }
                val minStar = entry.arguments?.getInt("minStar") ?: 0
                PracticeScreen(
                    bankId = bankId,
                    mode = mode,
                    initialRecite = recite,
                    chapterId = ch,
                    typeFilter = qType,
                    difficultyTierFilter = tier,
                    minStarFilter = minStar,
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
        }
    }

    AppUpdatePromptDialog(viewModel = mainViewModel)
}

@Composable
private fun AppUpdatePromptDialog(viewModel: MainViewModel) {
    val release = viewModel.availableUpdate
    if (!viewModel.updateDialogVisible || release == null) return

    val palette = KsbTheme.colors
    val versionLabel = "v${com.kaoshibao.pro.util.AppUpdateManager.normalizeVersion(release.versionName)}"
    val sizeLabel = com.kaoshibao.pro.util.AppUpdateManager.formatByteSize(release.fileSize)
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
