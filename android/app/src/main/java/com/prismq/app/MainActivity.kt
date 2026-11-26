package com.prismq.app

import android.app.Activity
import android.app.PictureInPictureUiState
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import com.prismq.app.ui.KaoshibaoApp
import com.prismq.app.ui.MainViewModel
import com.prismq.app.ui.theme.KaoshibaoTheme
import com.prismq.app.util.AppIntegrityShield
import com.prismq.app.util.CrashRecorder
import kotlinx.coroutines.flow.MutableStateFlow

object ExamWindowMonitor {
    val windowFocusFlow = MutableStateFlow(true)
    val multiWindowFlow = MutableStateFlow(false)
    val windowConfigTickFlow = MutableStateFlow(0)
}

class MainActivity : ComponentActivity() {
    private val mainViewModel: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        CrashRecorder.install(applicationContext)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        enableHighestRefreshRate()
        handleUpdateIntent(intent)
        val integrity = AppIntegrityShield.verify(applicationContext)
        val blockedByIntegrity = BuildConfig.ENABLE_INTEGRITY_ENFORCEMENT && integrity.hardTampered
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            ExamWindowMonitor.multiWindowFlow.value =
                isInMultiWindowMode || isInPictureInPictureMode
        }
        setContent {
            val darkTheme = mainViewModel.darkMode
            val view = LocalView.current
            if (!view.isInEditMode) {
                SideEffect {
                    val window = (view.context as? Activity)?.window ?: return@SideEffect
                    val controller = WindowCompat.getInsetsController(window, view)
                    controller.isAppearanceLightStatusBars = !darkTheme
                    controller.isAppearanceLightNavigationBars = !darkTheme
                }
            }
            KaoshibaoTheme(darkTheme = darkTheme) {
                if (blockedByIntegrity) {
                    Scaffold { pad ->
                        Column(
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(pad)
                                .padding(24.dp),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                text = "应用安全校验未通过",
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(modifier = Modifier.height(12.dp))
                            Text(
                                text = "检测到当前安装包或运行环境存在篡改、注入或调试风险，已禁止启动以保障数据与考试安全：\n${integrity.hardReasons.joinToString("\n")}",
                                fontSize = 13.sp,
                                textAlign = TextAlign.Center
                            )
                        }
                    }
                } else {
                    KaoshibaoApp(mainViewModel = mainViewModel)
                }

                val clipboard = LocalClipboardManager.current
                var pendingCrashLog by remember {
                    mutableStateOf(CrashRecorder.readLastCrash(applicationContext))
                }
                val crashText = pendingCrashLog
                if (crashText != null) {
                    AlertDialog(
                        onDismissRequest = {
                            CrashRecorder.clearLastCrash(applicationContext)
                            pendingCrashLog = null
                        },
                        title = {
                            Text(
                                text = "检测到上次异常闪退",
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold
                            )
                        },
                        text = {
                            Text(
                                text = crashText,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 11.sp,
                                lineHeight = 16.sp,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 280.dp)
                                    .verticalScroll(rememberScrollState())
                            )
                        },
                        confirmButton = {
                            TextButton(
                                onClick = {
                                    clipboard.setText(AnnotatedString(crashText))
                                    Toast.makeText(applicationContext, "已复制崩溃日志", Toast.LENGTH_SHORT).show()
                                }
                            ) {
                                Text("复制崩溃日志", fontWeight = FontWeight.SemiBold)
                            }
                        },
                        dismissButton = {
                            TextButton(
                                onClick = {
                                    CrashRecorder.clearLastCrash(applicationContext)
                                    pendingCrashLog = null
                                }
                            ) {
                                Text("清除并关闭")
                            }
                        }
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        enableHighestRefreshRate()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            ExamWindowMonitor.multiWindowFlow.value =
                isInMultiWindowMode || isInPictureInPictureMode
        }
        ExamWindowMonitor.windowConfigTickFlow.value += 1
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        ExamWindowMonitor.windowFocusFlow.value = hasFocus
        ExamWindowMonitor.windowConfigTickFlow.value += 1
    }

    override fun onMultiWindowModeChanged(isInMultiWindowMode: Boolean, newConfig: Configuration) {
        super.onMultiWindowModeChanged(isInMultiWindowMode, newConfig)
        ExamWindowMonitor.multiWindowFlow.value = isInMultiWindowMode
        ExamWindowMonitor.windowConfigTickFlow.value += 1
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        if (isInPictureInPictureMode) {
            ExamWindowMonitor.multiWindowFlow.value = true
        }
        ExamWindowMonitor.windowConfigTickFlow.value += 1
    }

    override fun onPictureInPictureUiStateChanged(pipState: PictureInPictureUiState) {
        super.onPictureInPictureUiStateChanged(pipState)
        ExamWindowMonitor.windowConfigTickFlow.value += 1
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            ExamWindowMonitor.multiWindowFlow.value =
                isInMultiWindowMode || isInPictureInPictureMode
        }
        ExamWindowMonitor.windowConfigTickFlow.value += 1
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleUpdateIntent(intent)
    }

    private fun handleUpdateIntent(intent: Intent?) {
        if (intent?.getBooleanExtra("open_update_prompt", false) == true) {
            mainViewModel.openAvailableUpdatePrompt()
        }
    }

    private fun enableHighestRefreshRate() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val currentDisplay = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            display ?: windowManager.defaultDisplay
        } else {
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay
        } ?: return

        val activeMode = currentDisplay.mode ?: return
        val bestMode = currentDisplay.supportedModes
            .filter {
                it.physicalWidth == activeMode.physicalWidth &&
                    it.physicalHeight == activeMode.physicalHeight
            }
            .maxByOrNull { it.refreshRate }
            ?: return

        val attrs = window.attributes
        if (attrs.preferredDisplayModeId != bestMode.modeId ||
            attrs.preferredRefreshRate != bestMode.refreshRate
        ) {
            attrs.preferredDisplayModeId = bestMode.modeId
            attrs.preferredRefreshRate = bestMode.refreshRate
            window.attributes = attrs
        }
    }
}
