package com.kaoshibao.pro.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.kaoshibao.pro.BuildConfig
import com.kaoshibao.pro.data.local.AppPreferences
import com.kaoshibao.pro.data.model.AppUpdateReleaseDto
import com.kaoshibao.pro.data.model.HeartbeatRequest
import com.kaoshibao.pro.data.model.LoginRequest
import com.kaoshibao.pro.data.model.PublicUser
import com.kaoshibao.pro.data.model.RegisterRequest
import com.kaoshibao.pro.data.remote.ApiClient
import com.kaoshibao.pro.data.remote.KaoshibaoApi
import com.kaoshibao.pro.util.ApkInstallResult
import com.kaoshibao.pro.util.AppUpdateManager
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.File

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = AppPreferences(application)

    var isInitializing by mutableStateOf(true)
        private set
    var serverUrl by mutableStateOf(AppPreferences.DEFAULT_SERVER_URL)
        private set
    var currentUser by mutableStateOf<PublicUser?>(null)
        private set
    var darkMode by mutableStateOf(false)
        private set
    var fontSize by mutableStateOf("md")
        private set
    var eyeCare by mutableStateOf(false)
        private set
    var autoNextDelayMs by mutableIntStateOf(650)
        private set
    var switchAnimationMs by mutableIntStateOf(260)
        private set
    var authBannerError by mutableStateOf<String?>(null)
        private set

    var availableUpdate by mutableStateOf<AppUpdateReleaseDto?>(null)
        private set
    var updateDialogVisible by mutableStateOf(false)
        private set
    var isCheckingUpdate by mutableStateOf(false)
        private set
    var isDownloadingUpdate by mutableStateOf(false)
        private set
    var updateDownloadProgress by mutableFloatStateOf(0f)
        private set
    var updateStatusMessage by mutableStateOf<String?>(null)
        private set
    var downloadedApkFile by mutableStateOf<File?>(null)
        private set
    private var dismissedVersionTag: String = ""
    private var updateStreamJob: Job? = null

    init {
        viewModelScope.launch {
            val stored = prefs.prefsFlow.first()
            serverUrl = ApiClient.updateServerUrl(stored.serverUrl)
            fontSize = stored.fontSize
            eyeCare = stored.eyeCare
            darkMode = stored.darkMode
            autoNextDelayMs = stored.autoNextDelayMs
            switchAnimationMs = stored.switchAnimationMs
            ApiClient.updateToken(stored.authToken)
            if (stored.authToken.isNotBlank()) {
                try {
                    val res = ApiClient.getApi().me()
                    applyUserTiming(res.user)
                    currentUser = res.user
                } catch (e: Exception) {
                    val msg = ApiClient.parseError(e)
                    prefs.clearAuth()
                    ApiClient.updateToken("")
                    currentUser = null
                    if (e is HttpException && e.code() == 403) {
                        authBannerError = msg
                    }
                }
            }
            isInitializing = false
            checkAppUpdate(manual = false)
            restartUpdateStream()
        }
    }

    private fun restartUpdateStream() {
        updateStreamJob?.cancel()
        val targetServer = serverUrl
        updateStreamJob = viewModelScope.launch {
            AppUpdateManager.observeUpdateStream(
                serverUrl = targetServer,
                currentVersion = BuildConfig.VERSION_NAME,
                currentVersionCode = BuildConfig.VERSION_CODE
            ) { release ->
                onUpdateDiscovered(release, fromPush = true)
            }
        }
    }

    suspend fun saveServerUrl(rawUrl: String): Result<String> {
        return try {
            val normalized = AppPreferences.normalizeServerUrl(rawUrl)
            val changed = !normalized.equals(serverUrl, ignoreCase = true)
            ApiClient.updateServerUrl(normalized)
            prefs.saveServerUrl(normalized)
            serverUrl = normalized
            val health = api().health()
            if (changed && currentUser != null) {
                prefs.clearAuth()
                ApiClient.updateToken("")
                currentUser = null
            }
            availableUpdate = null
            downloadedApkFile = null
            dismissedVersionTag = ""
            checkAppUpdate(manual = false)
            restartUpdateStream()
            Result.success("已连接服务端（${health.dbEngine}）：$normalized")
        } catch (e: Exception) {
            Result.failure(Exception(ApiClient.parseError(e)))
        }
    }

    private fun onUpdateDiscovered(release: AppUpdateReleaseDto, fromPush: Boolean) {
        if (!AppUpdateManager.isNewerVersion(
                latestVersion = release.versionName,
                latestCode = release.versionCode,
                currentVersion = BuildConfig.VERSION_NAME,
                currentCode = BuildConfig.VERSION_CODE
            )
        ) {
            return
        }
        val prevTag = availableUpdate?.tagName
        availableUpdate = release
        updateStatusMessage = null
        if (prevTag != release.tagName || release.forceUpdate) {
            AppUpdateManager.showUpdateNotification(getApplication(), release)
        }
        if (release.forceUpdate || dismissedVersionTag != release.tagName || !fromPush) {
            updateDialogVisible = true
        }
    }

    fun openAvailableUpdatePrompt() {
        if (availableUpdate != null) {
            updateDialogVisible = true
        } else {
            checkAppUpdate(manual = true)
        }
    }

    fun dismissUpdateDialog() {
        val current = availableUpdate
        if (current?.forceUpdate == true && isDownloadingUpdate.not()) return
        if (current != null) {
            dismissedVersionTag = current.tagName
        }
        updateDialogVisible = false
    }

    fun checkAppUpdate(manual: Boolean, onResult: ((String) -> Unit)? = null) {
        if (isCheckingUpdate) return
        viewModelScope.launch {
            isCheckingUpdate = true
            try {
                val res = api().getLatestAppUpdate(
                    currentVersion = BuildConfig.VERSION_NAME,
                    currentVersionCode = BuildConfig.VERSION_CODE
                )
                val latest = res.latest
                if (res.hasUpdate && latest != null) {
                    dismissedVersionTag = ""
                    onUpdateDiscovered(latest, fromPush = false)
                    onResult?.invoke("发现新版本 v${AppUpdateManager.normalizeVersion(latest.versionName)}")
                } else if (manual) {
                    onResult?.invoke("当前已是最新版本 (v${BuildConfig.VERSION_NAME})")
                }
            } catch (e: Exception) {
                if (manual) {
                    onResult?.invoke(ApiClient.parseError(e))
                }
            } finally {
                isCheckingUpdate = false
            }
        }
    }

    fun downloadAndInstallUpdate() {
        val release = availableUpdate ?: return
        if (isDownloadingUpdate) return
        val cached = downloadedApkFile
        if (cached != null && cached.exists()) {
            when (val installRes = AppUpdateManager.installApk(getApplication(), cached)) {
                ApkInstallResult.Launched -> {
                    updateStatusMessage = "已调起系统安装器，请按提示完成安装"
                }
                ApkInstallResult.NeedsPermission -> {
                    updateStatusMessage = "请在系统设置中允许「安装未知应用」后，再次点击安装"
                }
                is ApkInstallResult.Error -> {
                    downloadedApkFile = null
                    updateStatusMessage = installRes.message
                }
            }
            return
        }

        viewModelScope.launch {
            isDownloadingUpdate = true
            updateDownloadProgress = 0f
            updateStatusMessage = "正在从服务端下载安装包..."
            try {
                val apkFile = AppUpdateManager.downloadAndVerifyApk(
                    context = getApplication(),
                    release = release,
                    onProgress = { progress -> updateDownloadProgress = progress }
                )
                downloadedApkFile = apkFile
                when (val installRes = AppUpdateManager.installApk(getApplication(), apkFile)) {
                    ApkInstallResult.Launched -> {
                        updateStatusMessage = "安装包校验通过，已调起系统安装界面"
                    }
                    ApkInstallResult.NeedsPermission -> {
                        updateStatusMessage = "已完成下载，请授权「安装未知应用」后再次点击安装"
                    }
                    is ApkInstallResult.Error -> {
                        updateStatusMessage = installRes.message
                    }
                }
            } catch (e: Exception) {
                updateStatusMessage = e.localizedMessage ?: "下载安装包失败"
            } finally {
                isDownloadingUpdate = false
            }
        }
    }

    suspend fun adminSyncAndPushUpdate(): Result<String> {
        return try {
            val res = api().syncAdminAppUpdate()
            val ver = res.latest?.versionName?.ifBlank { res.latest.tagName } ?: "最新"
            if (!res.ok) {
                Result.failure(Exception(res.error ?: "从 GitHub 同步失败"))
            } else {
                checkAppUpdate(manual = false)
                Result.success("已同步 GitHub v$ver 并向 ${res.pushedClients} 个在线端推送更新提醒")
            }
        } catch (e: Exception) {
            Result.failure(Exception(ApiClient.parseError(e)))
        }
    }

    fun api(): KaoshibaoApi = ApiClient.getApi()

    private fun applyUserTiming(user: PublicUser) {
        val delay = user.settings.autoNextDelayMs.coerceIn(150, 2500)
        val anim = user.settings.switchAnimationMs.coerceIn(0, 600)
        autoNextDelayMs = delay
        switchAnimationMs = anim
        viewModelScope.launch {
            prefs.savePracticeTiming(delay, anim)
        }
    }

    suspend fun login(account: String, password: String): Result<PublicUser> {
        return try {
            val res = api().login(LoginRequest(account = account.trim(), password = password))
            prefs.saveAuthToken(res.token)
            ApiClient.updateToken(res.token)
            applyUserTiming(res.user)
            currentUser = res.user
            authBannerError = null
            Result.success(res.user)
        } catch (e: Exception) {
            Result.failure(Exception(ApiClient.parseError(e)))
        }
    }

    suspend fun register(
        username: String,
        email: String,
        password: String,
        nickname: String
    ): Result<PublicUser> {
        return try {
            val res = api().register(
                RegisterRequest(
                    username = username.trim(),
                    email = email.trim(),
                    password = password,
                    nickname = nickname.trim()
                )
            )
            prefs.saveAuthToken(res.token)
            ApiClient.updateToken(res.token)
            applyUserTiming(res.user)
            currentUser = res.user
            authBannerError = null
            Result.success(res.user)
        } catch (e: Exception) {
            Result.failure(Exception(ApiClient.parseError(e)))
        }
    }

    fun refreshUser() {
        viewModelScope.launch {
            try {
                val res = api().me()
                applyUserTiming(res.user)
                currentUser = res.user
            } catch (e: Exception) {
                if (e is HttpException && (e.code() == 401 || e.code() == 403)) {
                    prefs.clearAuth()
                    ApiClient.updateToken("")
                    currentUser = null
                    authBannerError = ApiClient.parseError(e)
                }
            }
        }
    }

    fun replaceUser(user: PublicUser) {
        applyUserTiming(user)
        currentUser = user
    }

    fun toggleDarkMode() {
        val next = !darkMode
        darkMode = next
        viewModelScope.launch {
            prefs.saveDarkMode(next)
        }
    }

    fun setDarkModeEnabled(enabled: Boolean) {
        darkMode = enabled
        viewModelScope.launch {
            prefs.saveDarkMode(enabled)
        }
    }

    fun updatePracticeAppearance(nextFontSize: String, nextEyeCare: Boolean) {
        fontSize = nextFontSize
        eyeCare = nextEyeCare
        viewModelScope.launch {
            prefs.savePracticeStyle(nextFontSize, nextEyeCare)
        }
    }

    fun updatePracticeTiming(nextAutoNextDelayMs: Int, nextSwitchAnimationMs: Int) {
        val safeDelay = nextAutoNextDelayMs.coerceIn(150, 2500)
        val safeAnim = nextSwitchAnimationMs.coerceIn(0, 600)
        autoNextDelayMs = safeDelay
        switchAnimationMs = safeAnim
        viewModelScope.launch {
            prefs.savePracticeTiming(safeDelay, safeAnim)
        }
    }

    suspend fun reportHeartbeat(deltaSeconds: Int, mode: String, path: String) {
        if (currentUser == null || deltaSeconds <= 0) return
        try {
            api().heartbeat(
                HeartbeatRequest(
                    deltaSeconds = deltaSeconds.coerceIn(1, 120),
                    mode = mode,
                    path = path.take(120)
                )
            )
        } catch (e: Exception) {
            if (e is HttpException && (e.code() == 401 || e.code() == 403)) {
                prefs.clearAuth()
                ApiClient.updateToken("")
                currentUser = null
                authBannerError = ApiClient.parseError(e)
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            prefs.clearAuth()
            ApiClient.updateToken("")
            currentUser = null
        }
    }
}
