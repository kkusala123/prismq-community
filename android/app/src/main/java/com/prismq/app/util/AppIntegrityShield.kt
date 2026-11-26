package com.prismq.app.util

import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Debug
import com.prismq.app.BuildConfig
import com.prismq.app.security.ObfuscatedSecrets
import java.io.File
import java.security.MessageDigest
import java.util.Locale

data class IntegrityReport(
    val hardTampered: Boolean,
    val hardReasons: List<String>,
    val riskReasons: List<String>
)

/**
 * 运行时应用完整性与反逆向保护屏障：
 * - 包名与签名证书 SHA-256 校验（防重打包二次签名）
 * - debuggable 标志与 TracerPid / Debug 附加检测（防 apktool 改调试 + ptrace 附加）
 * - 进程内存映射与调用栈 Hook 框架检测（Frida / Xposed / LSPosed / Substrate）
 */
object AppIntegrityShield {

    @Volatile
    private var cachedCompromised: Boolean = false

    fun isCompromised(): Boolean = cachedCompromised

    internal fun parseTracerPid(statusText: String): Int {
        val prefix = ObfuscatedSecrets.tracerPidPrefix()
        for (line in statusText.lineSequence()) {
            val trimmed = line.trim()
            if (trimmed.startsWith(prefix, ignoreCase = true)) {
                return trimmed.substringAfter(':').trim().toIntOrNull() ?: 0
            }
        }
        return 0
    }

    internal fun detectHookMaps(mapsText: String, keywords: List<String>): List<String> {
        if (mapsText.isBlank() || keywords.isEmpty()) return emptyList()
        val lower = mapsText.lowercase(Locale.US)
        return keywords
            .map { it.trim().lowercase(Locale.US) }
            .filter { it.isNotEmpty() && lower.contains(it) }
            .distinct()
    }

    internal fun detectFridaTcpEntries(tcpText: String, hexPort: String): Boolean {
        if (tcpText.isBlank() || hexPort.isBlank()) return false
        return tcpText.uppercase(Locale.US).contains(hexPort.uppercase(Locale.US))
    }

    internal fun compareCertSha256(actualHex: String, expectedHex: String): Boolean {
        val normActual = actualHex.replace(":", "").trim().uppercase(Locale.US)
        val normExpected = expectedHex.replace(":", "").trim().uppercase(Locale.US)
        if (normExpected.isEmpty()) return true
        if (normActual.isEmpty()) return false
        return normActual == normExpected
    }

    @Suppress("DEPRECATION")
    private fun readSigningCertSha256(context: Context): String {
        return try {
            val pm = context.packageManager
            val certBytes: ByteArray? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val info = pm.getPackageInfo(
                    context.packageName,
                    PackageManager.GET_SIGNING_CERTIFICATES
                )
                val signingInfo = info.signingInfo
                val sigs = if (signingInfo?.hasMultipleSigners() == true) {
                    signingInfo.apkContentsSigners
                } else {
                    signingInfo?.signingCertificateHistory
                }
                sigs?.firstOrNull()?.toByteArray()
            } else {
                val info = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNATURES)
                info.signatures?.firstOrNull()?.toByteArray()
            }
            if (certBytes == null) return ""
            MessageDigest.getInstance("SHA-256")
                .digest(certBytes)
                .joinToString("") { "%02X".format(it) }
        } catch (_: Exception) {
            ""
        }
    }

    fun verify(context: Context): IntegrityReport {
        val hardReasons = mutableListOf<String>()
        val riskReasons = mutableListOf<String>()

        // 1. 包名一致性校验
        val expectedPkg = ObfuscatedSecrets.expectedPackage()
        if (context.packageName != expectedPkg) {
            hardReasons.add("应用包名校验异常")
        }

        // 2. Release 包防 debuggable 篡改与签名证书 SHA-256 校验
        if (BuildConfig.ENABLE_INTEGRITY_ENFORCEMENT) {
            val flags = context.applicationInfo?.flags ?: 0
            if ((flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                hardReasons.add("检测到非法调试标记（疑似重打包）")
            }

            val expectedCert = ObfuscatedSecrets.expectedCertSha256()
            if (expectedCert.isNotBlank()) {
                val actualCert = readSigningCertSha256(context)
                if (!compareCertSha256(actualCert, expectedCert)) {
                    hardReasons.add("安装包数字签名与官方发布证书不匹配")
                }
            }
        }

        // 3. 调试器附加 & Linux TracerPid 附加检测
        if (BuildConfig.ENABLE_INTEGRITY_ENFORCEMENT) {
            if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) {
                hardReasons.add("检测到外部调试器附加")
            }
            try {
                val statusText = File(ObfuscatedSecrets.procSelfStatus())
                    .takeIf { it.canRead() }
                    ?.readText()
                    .orEmpty()
                if (parseTracerPid(statusText) > 0) {
                    hardReasons.add("检测到 ptrace 调试进程追踪")
                }
            } catch (_: Exception) {
            }
        }

        // 4. 内存映射与调用栈 Hook 框架检测（Frida / Xposed / LSPosed / Substrate）
        val keywords = ObfuscatedSecrets.hookKeywords().split(',').filter { it.isNotBlank() }
        try {
            val mapsText = File(ObfuscatedSecrets.procSelfMaps())
                .takeIf { it.canRead() }
                ?.readText()
                .orEmpty()
            val hits = detectHookMaps(mapsText, keywords)
            if (hits.isNotEmpty()) {
                hardReasons.add("检测到运行时 Hook/注入模块（${hits.joinToString("/")}）")
            }
        } catch (_: Exception) {
        }

        try {
            val stackText = Throwable().stackTrace.joinToString("\n") { it.className }
            val stackHits = detectHookMaps(stackText, keywords)
            if (stackHits.isNotEmpty()) {
                riskReasons.add("调用栈包含 Hook 框架特征（${stackHits.joinToString("/")}）")
            }
        } catch (_: Exception) {
        }

        // 5. Frida 默认守护端口检测
        try {
            val tcpText = File(ObfuscatedSecrets.procNetTcp())
                .takeIf { it.canRead() }
                ?.readText()
                .orEmpty()
            if (detectFridaTcpEntries(tcpText, ObfuscatedSecrets.fridaTcpPortHex())) {
                hardReasons.add("检测到可疑注入守护监听端口")
            }
        } catch (_: Exception) {
        }

        val compromised = hardReasons.isNotEmpty()
        cachedCompromised = compromised
        return IntegrityReport(
            hardTampered = compromised,
            hardReasons = hardReasons.distinct(),
            riskReasons = riskReasons.distinct()
        )
    }
}
