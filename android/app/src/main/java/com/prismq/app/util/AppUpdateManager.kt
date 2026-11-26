package com.prismq.app.util

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import com.prismq.app.MainActivity
import com.prismq.app.R
import com.prismq.app.data.local.AppPreferences
import com.prismq.app.data.model.AppUpdateReleaseDto
import com.prismq.app.data.remote.ApiClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URLEncoder
import java.security.MessageDigest
import kotlin.math.min

sealed class ApkInstallResult {
    data object Launched : ApkInstallResult()
    data object NeedsPermission : ApkInstallResult()
    data class Error(val message: String) : ApkInstallResult()
}

object AppUpdateManager {
    private const val CHANNEL_ID = "prismq_app_updates"
    private const val NOTIFICATION_ID = 20261

    fun normalizeVersion(raw: String?): String =
        raw.orEmpty().trim().removePrefix("v").removePrefix("V").ifBlank { "0.0.0" }

    fun compareSemver(a: String, b: String): Int {
        fun parse(v: String): List<Int> = normalizeVersion(v)
            .substringBefore('-')
            .substringBefore('+')
            .split('.')
            .map { part -> Regex("^(\\d+)").find(part.trim())?.groupValues?.get(1)?.toIntOrNull() ?: 0 }

        val pa = parse(a)
        val pb = parse(b)
        val count = maxOf(pa.size, pb.size, 3)
        for (i in 0 until count) {
            val va = pa.getOrElse(i) { 0 }
            val vb = pb.getOrElse(i) { 0 }
            if (va != vb) return va.compareTo(vb)
        }
        return 0
    }

    fun isNewerVersion(
        latestVersion: String,
        latestCode: Int,
        currentVersion: String,
        currentCode: Int
    ): Boolean {
        val normLatest = normalizeVersion(latestVersion)
        val normCurrent = currentVersion.trim()
        if (normLatest == "0.0.0" && latestCode <= 0) return false
        if (normCurrent.isEmpty()) {
            return if (currentCode > 0) latestCode > currentCode else true
        }
        val cmp = compareSemver(normLatest, normCurrent)
        if (cmp > 0) return true
        if (cmp < 0) return false
        return latestCode > currentCode
    }

    fun formatByteSize(bytes: Long): String {
        if (bytes <= 0L) return "未知大小"
        val mb = bytes / (1024.0 * 1024.0)
        return if (mb >= 1.0) String.format("%.1f MB", mb) else "${(bytes / 1024L).coerceAtLeast(1)} KB"
    }

    fun ensureNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val existing = manager.getNotificationChannel(CHANNEL_ID)
            if (existing == null) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "应用更新通知",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "接收服务端推送的棱题 PrismQ 新版本安装包通知"
                }
                manager.createNotificationChannel(channel)
            }
        }
    }

    fun showUpdateNotification(context: Context, release: AppUpdateReleaseDto) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) return
        }
        ensureNotificationChannel(context)
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra("open_update_prompt", true)
        }
        val pendingFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pendingIntent = PendingIntent.getActivity(context, 0, intent, pendingFlags)
        val versionLabel = "v${normalizeVersion(release.versionName)}"
        val notes = release.releaseNotes.lineSequence().firstOrNull { it.isNotBlank() }?.take(60)
            ?: "点击立即查看更新说明并一键安装"

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("棱题 · PrismQ 有新版本 $versionLabel")
            .setContentText(notes)
            .setStyle(NotificationCompat.BigTextStyle().bigText("$notes\n安装包大小：${formatByteSize(release.fileSize)}"))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        runCatching {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
        }
    }

    fun buildAbsoluteUrl(pathOrUrl: String): String {
        val raw = pathOrUrl.trim()
        if (raw.startsWith("http://") || raw.startsWith("https://")) return raw
        val base = AppPreferences.FIXED_SERVER_URL.trimEnd('/')
        val suffix = if (raw.startsWith("/")) raw else "/$raw"
        return "$base$suffix"
    }

    suspend fun downloadAndVerifyApk(
        context: Context,
        release: AppUpdateReleaseDto,
        onProgress: (Float) -> Unit
    ): File = withContext(Dispatchers.IO) {
        val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
        val safeName = release.fileName
            .ifBlank { "prismq-${normalizeVersion(release.versionName)}.apk" }
            .replace(Regex("[^A-Za-z0-9._-]"), "_")
        val targetFile = File(updatesDir, safeName)
        val tempFile = File(updatesDir, "$safeName.download")
        if (tempFile.exists()) tempFile.delete()

        val url = buildAbsoluteUrl(release.downloadUrl.ifBlank { "/api/app-update/download" })
        val request = Request.Builder()
            .url(url)
            .header("Accept", "application/vnd.android.package-archive,application/octet-stream")
            .build()

        ApiClient.downloadClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("下载安装包失败 (${response.code})")
            }
            val body = response.body ?: throw IOException("下载响应体为空")
            val totalBytes = body.contentLength().takeIf { it > 0L } ?: release.fileSize
            val digest = MessageDigest.getInstance("SHA-256")
            var downloaded = 0L

            body.byteStream().use { input ->
                FileOutputStream(tempFile).use { output ->
                    val buffer = ByteArray(16 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read == -1) break
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        downloaded += read
                        if (totalBytes > 0L) {
                            onProgress((downloaded.toFloat() / totalBytes.toFloat()).coerceIn(0f, 1f))
                        }
                    }
                    output.flush()
                }
            }

            if (release.sha256.isNotBlank()) {
                val actualHex = digest.digest().joinToString("") { "%02x".format(it) }
                if (!actualHex.equals(release.sha256.trim(), ignoreCase = true)) {
                    tempFile.delete()
                    throw IOException("安装包 SHA-256 校验未通过，已自动中止安装")
                }
            }
        }

        if (targetFile.exists()) targetFile.delete()
        if (!tempFile.renameTo(targetFile)) {
            throw IOException("保存安装包到本地缓存失败")
        }
        onProgress(1f)
        targetFile
    }

    fun installApk(context: Context, apkFile: File): ApkInstallResult {
        if (!apkFile.exists()) {
            return ApkInstallResult.Error("安装包文件不存在，请重新下载")
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !context.packageManager.canRequestPackageInstalls()
        ) {
            val settingsIntent = Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(settingsIntent)
            return ApkInstallResult.NeedsPermission
        }

        val apkUri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            apkFile
        )
        val installIntent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(apkUri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        context.startActivity(installIntent)
        return ApkInstallResult.Launched
    }

    suspend fun observeUpdateStream(
        currentVersion: String,
        currentVersionCode: Int,
        onUpdateReceived: (AppUpdateReleaseDto) -> Unit
    ) {
        var backoffMs = 3_000L
        val encodedVersion = withContext(Dispatchers.IO) {
            URLEncoder.encode(currentVersion, "UTF-8")
        }
        val streamUrl =
            "${AppPreferences.FIXED_SERVER_URL.trimEnd('/')}/api/app-update/stream?currentVersion=$encodedVersion&currentVersionCode=$currentVersionCode"

        while (currentCoroutineContext().isActive) {
            try {
                withContext(Dispatchers.IO) {
                    val request = Request.Builder()
                        .url(streamUrl)
                        .header("Accept", "text/event-stream")
                        .build()
                    ApiClient.streamClient.newCall(request).execute().use { response ->
                        if (!response.isSuccessful) {
                            throw IOException("SSE stream HTTP ${response.code}")
                        }
                        backoffMs = 3_000L
                        val source = response.body?.source() ?: throw IOException("Empty SSE body")
                        var eventName = ""
                        val dataBuilder = StringBuilder()

                        while (currentCoroutineContext().isActive && !source.exhausted()) {
                            val line = source.readUtf8Line() ?: break
                            when {
                                line.isEmpty() -> {
                                    if (eventName == "update" && dataBuilder.isNotEmpty()) {
                                        val payload = dataBuilder.toString().trim()
                                        runCatching {
                                            ApiClient.json.decodeFromString<AppUpdateReleaseDto>(payload)
                                        }.onSuccess { dto ->
                                            if (isNewerVersion(
                                                    latestVersion = dto.versionName,
                                                    latestCode = dto.versionCode,
                                                    currentVersion = currentVersion,
                                                    currentCode = currentVersionCode
                                                )
                                            ) {
                                                onUpdateReceived(dto)
                                            }
                                        }
                                    }
                                    eventName = ""
                                    dataBuilder.setLength(0)
                                }
                                line.startsWith(":") -> Unit
                                line.startsWith("event:") -> {
                                    eventName = line.removePrefix("event:").trim()
                                }
                                line.startsWith("data:") -> {
                                    if (dataBuilder.isNotEmpty()) dataBuilder.append('\n')
                                    dataBuilder.append(line.removePrefix("data:").trim())
                                }
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // Reconnect with bounded exponential backoff
            }
            if (!currentCoroutineContext().isActive) break
            delay(backoffMs)
            backoffMs = min(backoffMs * 2L, 60_000L)
        }
    }
}
