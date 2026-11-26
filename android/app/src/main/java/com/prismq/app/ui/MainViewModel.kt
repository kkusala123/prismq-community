package com.prismq.app.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.prismq.app.BuildConfig
import com.prismq.app.data.local.AppPreferences
import com.prismq.app.data.model.AppUpdateReleaseDto
import com.prismq.app.data.model.HeartbeatRequest
import com.prismq.app.data.model.LoginRequest
import com.prismq.app.data.model.PublicUser
import com.prismq.app.data.model.RegisterRequest
import com.prismq.app.data.remote.ApiClient
import com.prismq.app.data.remote.KaoshibaoApi
import com.prismq.app.util.ApkInstallResult
import com.prismq.app.util.AppUpdateManager
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.File
import java.util.concurrent.atomic.AtomicLong

data class PracticeLaunchParams(
    val bankId: String = "all",
    val mode: String = "sequential",
    val recite: Boolean = false,
    val chapterId: String? = null,
    val type: String? = null,
    val difficultyTier: String? = null,
    val minStar: Int = 0,
    val launchId: Long = 0L
) {
    companion object {
        fun create(
            bankId: String,
            mode: String = "sequential",
            recite: Boolean = false,
            chapterId: String? = null,
            type: String? = null,
            difficultyTier: String? = null,
            minStar: Int = 0,
            launchId: Long = 0L
        ): PracticeLaunchParams = PracticeLaunchParams(
            bankId = bankId.trim().ifEmpty { "all" },
            mode = mode.trim().ifEmpty { "sequential" },
            recite = recite,
            chapterId = chapterId?.trim()?.takeIf { it.isNotEmpty() },
            type = type?.trim()?.takeIf { it.isNotEmpty() },
            difficultyTier = difficultyTier?.trim()?.takeIf { it.isNotEmpty() },
            minStar = minStar.coerceAtLeast(0),
            launchId = launchId
        )
    }
}

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val prefs = AppPreferences(application)
    private val practiceLaunchCounter = AtomicLong(0L)

    var isInitializing by mutableStateOf(true)
        private set
    val serverUrl: String = AppPreferences.FIXED_SERVER_URL
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
    var practiceLaunchParams by mutableStateOf(PracticeLaunchParams())
        private set

    fun setPracticeLaunchParams(
        bankId: String,
        mode: String = "sequential",
        recite: Boolean = false,
        chapterId: String? = null,
        type: String? = null,
        difficultyTier: String? = null,
        minStar: Int = 0
    ) {
        practiceLaunchParams = PracticeLaunchParams.create(
            bankId = bankId,
            mode = mode,
            recite = recite,
            chapterId = chapterId,
            type = type,
            difficultyTier = difficultyTier,
            minStar = minStar,
            launchId = practiceLaunchCounter.incrementAndGet()
        )
    }

    init {
        viewModelScope.launch {
            val (token, storedUserId) = prefs.readSession()
            if (storedUserId.isNotBlank()) {
                val cached = prefs.readUserPrefs(storedUserId)
                fontSize = cached.fontSize
                eyeCare = cached.eyeCare
                darkMode = cached.darkMode
                autoNextDelayMs = cached.autoNextDelayMs
                switchAnimationMs = cached.switchAnimationMs
            }
            ApiClient.updateToken(token)
            if (token.isNotBlank()) {
                try {
                    val res = ApiClient.getApi().me()
                    activateUserSession(res.user, token)
                } catch (e: Exception) {
                    val msg = ApiClient.parseError(e)
                    clearSessionState(if (e is HttpException && e.code() == 403) msg else null)
                }
            }
            isInitializing = false
            checkAppUpdate(manual = false)
        }
        viewModelScope.launch {
            AppUpdateManager.observeUpdateStream(
                currentVersion = BuildConfig.VERSION_NAME,
                currentVersionCode = BuildConfig.VERSION_CODE
            ) { release ->
                onUpdateDiscovered(release, fromPush = true)
            }
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
                Result.failure(Exception(res.error ?: "扫描服务器安装包失败"))
            } else if (res.latest == null) {
                Result.failure(Exception("服务器暂未上传任何 APK 安装包"))
            } else {
                checkAppUpdate(manual = false)
                Result.success("已发布服务器 v$ver 并向 ${res.pushedClients} 个在线端推送更新提醒")
            }
        } catch (e: Exception) {
            Result.failure(Exception(ApiClient.parseError(e)))
        }
    }

    fun api(): KaoshibaoApi = ApiClient.getApi()

    private suspend fun activateUserSession(user: PublicUser, token: String? = null) {
        if (token != null) {
            prefs.saveAuthSession(token, user.id)
            ApiClient.updateToken(token)
        }
        val userPrefs = prefs.readUserPrefs(user.id)
        fontSize = userPrefs.fontSize
        eyeCare = userPrefs.eyeCare
        darkMode = userPrefs.darkMode
        val delay = user.settings.autoNextDelayMs.coerceIn(150, 2500)
        val anim = user.settings.switchAnimationMs.coerceIn(0, 600)
        autoNextDelayMs = delay
        switchAnimationMs = anim
        prefs.savePracticeTiming(user.id, delay, anim)
        currentUser = user
        authBannerError = null
    }

    private suspend fun clearSessionState(errorBanner: String? = null) {
        prefs.clearAuth()
        prefs.clearUserTempCaches()
        ApiClient.updateToken("")
        currentUser = null
        darkMode = false
        fontSize = "md"
        eyeCare = false
        autoNextDelayMs = 650
        switchAnimationMs = 260
        practiceLaunchParams = PracticeLaunchParams()
        authBannerError = errorBanner
    }

    suspend fun login(account: String, password: String): Result<PublicUser> {
        return try {
            val res = api().login(LoginRequest(account = account.trim(), password = password))
            activateUserSession(res.user, res.token)
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
            activateUserSession(res.user, res.token)
            Result.success(res.user)
        } catch (e: Exception) {
            Result.failure(Exception(ApiClient.parseError(e)))
        }
    }

    fun refreshUser() {
        viewModelScope.launch {
            try {
                val res = api().me()
                activateUserSession(res.user)
            } catch (e: Exception) {
                if (e is HttpException && (e.code() == 401 || e.code() == 403)) {
                    clearSessionState(ApiClient.parseError(e))
                }
            }
        }
    }

    fun replaceUser(user: PublicUser) {
        viewModelScope.launch {
            activateUserSession(user)
        }
    }

    fun toggleDarkMode() {
        val next = !darkMode
        darkMode = next
        val uid = currentUser?.id ?: return
        viewModelScope.launch {
            prefs.saveDarkMode(uid, next)
        }
    }

    fun setDarkModeEnabled(enabled: Boolean) {
        darkMode = enabled
        val uid = currentUser?.id ?: return
        viewModelScope.launch {
            prefs.saveDarkMode(uid, enabled)
        }
    }

    fun updatePracticeAppearance(nextFontSize: String, nextEyeCare: Boolean) {
        fontSize = nextFontSize
        eyeCare = nextEyeCare
        val uid = currentUser?.id ?: return
        viewModelScope.launch {
            prefs.savePracticeStyle(uid, nextFontSize, nextEyeCare)
        }
    }

    fun updatePracticeTiming(nextAutoNextDelayMs: Int, nextSwitchAnimationMs: Int) {
        val safeDelay = nextAutoNextDelayMs.coerceIn(150, 2500)
        val safeAnim = nextSwitchAnimationMs.coerceIn(0, 600)
        autoNextDelayMs = safeDelay
        switchAnimationMs = safeAnim
        val uid = currentUser?.id ?: return
        viewModelScope.launch {
            prefs.savePracticeTiming(uid, safeDelay, safeAnim)
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
                clearSessionState(ApiClient.parseError(e))
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            clearSessionState(null)
        }
    }
}
