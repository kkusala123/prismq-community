package com.prismq.app.util

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Build
import android.os.Debug
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.prismq.app.data.model.ExamDeviceInfoDto
import com.prismq.app.security.ObfuscatedSecrets
import java.io.File
import java.util.Locale

object ExamSecurityGuard {

    private val EMULATOR_FILES = listOf(
        "/dev/socket/qemud",
        "/dev/qemu_pipe",
        "/system/lib/libc_malloc_debug_qemu.so",
        "/sys/qemu_trace",
        "/system/bin/qemu-props",
        "/dev/vboxguest",
        "/dev/vboxuser",
        "/system/bin/nox-prop",
        "/system/bin/ttVM-prop",
        "/system/bin/Microvirt",
        "/system/bin/droid4x-prop"
    )

    data class BuildFingerprintInput(
        val fingerprint: String,
        val model: String,
        val manufacturer: String,
        val brand: String,
        val device: String,
        val product: String,
        val hardware: String,
        val board: String,
        val abis: List<String>
    )

    internal fun evaluateBuildFingerprint(input: BuildFingerprintInput): List<String> {
        val reasons = mutableListOf<String>()
        val fp = input.fingerprint.lowercase(Locale.US)
        val model = input.model.lowercase(Locale.US)
        val manu = input.manufacturer.lowercase(Locale.US)
        val brand = input.brand.lowercase(Locale.US)
        val device = input.device.lowercase(Locale.US)
        val product = input.product.lowercase(Locale.US)
        val hw = input.hardware.lowercase(Locale.US)
        val board = input.board.lowercase(Locale.US)

        if (fp.startsWith("generic") || fp.startsWith("unknown") || fp.contains("test-keys") && (model.contains("sdk") || model.contains("emulator"))) {
            reasons.add("系统指纹符合模拟器/测试镜像特征")
        }
        if (model.contains("google_sdk") || model.contains("emulator") || model.contains("android sdk built for") || model.contains("mumu") || model.contains("ldplayer") || model.contains("bluestacks") || model.contains("nox")) {
            reasons.add("设备型号匹配模拟器 (${input.model})")
        }
        if (manu.contains("genymotion") || manu.contains("netease") || manu.contains("bluestacks") || manu.contains("bignox")) {
            reasons.add("设备制造商匹配模拟器 (${input.manufacturer})")
        }
        if ((brand.startsWith("generic") && device.startsWith("generic")) || product.contains("sdk_gphone") || product.contains("vbox86p") || product == "nox" || product == "ttvm_hdragon") {
            reasons.add("设备产品代号属于虚拟环境 (${input.product})")
        }
        if (hw.contains("goldfish") || hw.contains("ranchu") || hw.contains("vbox86") || hw.contains("nox") || board.contains("goldfish") || board.contains("ranchu")) {
            reasons.add("硬件平台属于模拟器 (${input.hardware})")
        }
        val primaryAbi = input.abis.firstOrNull()?.lowercase(Locale.US).orEmpty()
        if (primaryAbi == "x86" || primaryAbi == "x86_64") {
            reasons.add("运行架构为桌面虚拟机常见 ABI ($primaryAbi)")
        }
        return reasons
    }

    @SuppressLint("PrivateApi")
    private fun readSystemProp(key: String): String {
        return try {
            val clazz = Class.forName(ObfuscatedSecrets.sysPropsClass())
            val getMethod = clazz.getMethod("get", String::class.java, String::class.java)
            (getMethod.invoke(null, key, "") as? String).orEmpty()
        } catch (_: Exception) {
            ""
        }
    }

    fun inspectDevice(context: Context, activity: Activity? = null): ExamDeviceInfoDto {
        val reasons = evaluateBuildFingerprint(
            BuildFingerprintInput(
                fingerprint = Build.FINGERPRINT.orEmpty(),
                model = Build.MODEL.orEmpty(),
                manufacturer = Build.MANUFACTURER.orEmpty(),
                brand = Build.BRAND.orEmpty(),
                device = Build.DEVICE.orEmpty(),
                product = Build.PRODUCT.orEmpty(),
                hardware = Build.HARDWARE.orEmpty(),
                board = Build.BOARD.orEmpty(),
                abis = Build.SUPPORTED_ABIS?.toList().orEmpty()
            )
        ).toMutableList()

        // 检查虚拟机系统属性
        val qemuProp = readSystemProp("ro.kernel.qemu")
        val bootQemu = readSystemProp("ro.boot.qemu")
        if (qemuProp == "1" || bootQemu == "1") {
            reasons.add("内核属性 ro.kernel.qemu / ro.boot.qemu = 1")
        }

        // 检查模拟器设备节点文件
        val hitFile = EMULATOR_FILES.firstOrNull { path ->
            try {
                File(path).exists()
            } catch (_: Exception) {
                false
            }
        }
        if (hitFile != null) {
            reasons.add("发现模拟器特征节点：$hitFile")
        }

        // 检查 /proc/cpuinfo
        try {
            val cpuInfo = File("/proc/cpuinfo").takeIf { it.canRead() }?.readText().orEmpty().lowercase(Locale.US)
            if (cpuInfo.contains("hypervisor") || cpuInfo.contains("qemu") || cpuInfo.contains("goldfish") || cpuInfo.contains("vbox")) {
                reasons.add("CPU 信息包含虚拟化/Hypervisor 标识")
            }
        } catch (_: Exception) {
        }

        // 检查物理传感器（真实手机通常具备加速度/陀螺仪/磁力计）
        try {
            val sm = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            if (sm != null) {
                val hasAccel = sm.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) != null
                val hasGyro = sm.getDefaultSensor(Sensor.TYPE_GYROSCOPE) != null
                val hasMag = sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD) != null
                if (!hasAccel && !hasGyro && !hasMag) {
                    reasons.add("缺少真实手机基础传感器（加速度/陀螺仪/磁力计）")
                }
            }
        } catch (_: Exception) {
        }

        // 检测分身 / 沙盒多开路径
        var isVirtualSpace = false
        try {
            val dataPath = context.filesDir?.absolutePath.orEmpty().lowercase(Locale.US)
            val virtualHints = listOf("virtualapp", "parallel", "dual", "sandbox", "lbe", "va_data", "dkplugin")
            if (virtualHints.any { dataPath.contains(it) }) {
                isVirtualSpace = true
                reasons.add("应用数据路径处于多开分身/沙盒容器")
            }
        } catch (_: Exception) {
        }

        val integrityReport = AppIntegrityShield.verify(context)
        if (integrityReport.hardReasons.isNotEmpty()) {
            reasons.addAll(integrityReport.hardReasons)
        }
        if (integrityReport.riskReasons.isNotEmpty()) {
            reasons.addAll(integrityReport.riskReasons)
        }

        val isDebugged = Debug.isDebuggerConnected() || Debug.waitingForDebugger() || integrityReport.hardTampered
        if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) {
            reasons.add("检测到调试器附加")
        }

        val smallWindowReason = activity?.let { detectSmallWindowReason(it) }
        val isMultiWindow = smallWindowReason != null
        if (smallWindowReason != null) {
            reasons.add(smallWindowReason)
        }

        val isEmulator = reasons.any {
            !it.contains("小窗") && !it.contains("分屏") && !it.contains("画中画") && !it.contains("调试器") && !it.contains("多开")
        }

        return ExamDeviceInfoDto(
            platform = "android",
            deviceLabel = "${Build.BRAND} ${Build.MODEL} (Android ${Build.VERSION.RELEASE})",
            isEmulator = isEmulator,
            isDebugged = isDebugged,
            isVirtualSpace = isVirtualSpace,
            isMultiWindow = isMultiWindow,
            reasons = reasons.distinct()
        )
    }

    /**
     * 精准检测 Android 多窗口分屏、画中画及各厂商自由窗口 / 迷你小窗模式。
     * 排除底部软键盘（IME）弹出造成的可见区域缩减，避免答题输入填空/简答时误判。
     */
    fun detectSmallWindowReason(activity: Activity): String? {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            if (activity.isInPictureInPictureMode) {
                return "检测到画中画模式（PiP）"
            }
            if (activity.isInMultiWindowMode) {
                return "检测到系统多窗口 / 分屏 / 自由小窗模式"
            }
        }

        val decorView = activity.window?.decorView ?: return null
        val viewW = decorView.width
        val viewH = decorView.height
        if (viewW <= 0 || viewH <= 0) return null

        val imeBottomPx = ViewCompat.getRootWindowInsets(decorView)
            ?.getInsets(WindowInsetsCompat.Type.ime())
            ?.bottom ?: 0

        val (screenW, screenH) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = activity.windowManager.maximumWindowMetrics.bounds
            bounds.width() to bounds.height()
        } else {
            val dm = activity.resources.displayMetrics
            dm.widthPixels to dm.heightPixels
        }

        if (screenW <= 0 || screenH <= 0) return null

        // 某些国产 ROM 的自由小窗不会返回 isInMultiWindowMode=true，但窗口宽高明显小于全屏基准
        val widthRatio = viewW.toFloat() / screenW.toFloat()
        val effectiveHeight = viewH + imeBottomPx
        val heightRatio = effectiveHeight.toFloat() / screenH.toFloat()

        if (widthRatio < 0.88f || heightRatio < 0.78f) {
            return "检测到异常小窗作答（窗口占比 ${(widthRatio * 100).toInt()}% × ${(heightRatio * 100).toInt()}%）"
        }
        return null
    }
}
