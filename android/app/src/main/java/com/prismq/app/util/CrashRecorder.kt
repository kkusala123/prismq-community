package com.prismq.app.util

import android.content.Context
import android.os.Build
import android.util.Log
import com.prismq.app.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

object CrashRecorder {
    private const val CRASH_FILE_NAME = "last_crash.txt"
    private val installed = AtomicBoolean(false)

    fun install(context: Context) {
        if (!installed.compareAndSet(false, true)) return
        val appContext = context.applicationContext
        val previousHandler = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            try {
                writeCrashLog(appContext, thread, throwable)
            } catch (_: Throwable) {
            }
            previousHandler?.uncaughtException(thread, throwable)
        }
    }

    private fun crashFile(context: Context): File =
        File(context.applicationContext.filesDir, CRASH_FILE_NAME)

    private fun writeCrashLog(context: Context, thread: Thread, throwable: Throwable) {
        val timestamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val stack = Log.getStackTraceString(throwable)
        val content = buildString {
            appendLine("PrismQ v${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
            appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL} (Android ${Build.VERSION.RELEASE}, API ${Build.VERSION.SDK_INT})")
            appendLine("Thread: ${thread.name}")
            appendLine("Time: $timestamp")
            appendLine("--- Stacktrace ---")
            append(stack)
        }
        crashFile(context).writeText(content, Charsets.UTF_8)
    }

    fun readLastCrash(context: Context): String? {
        return try {
            val file = crashFile(context)
            if (file.exists()) {
                file.readText(Charsets.UTF_8).trim().ifEmpty { null }
            } else {
                null
            }
        } catch (_: Throwable) {
            null
        }
    }

    fun clearLastCrash(context: Context) {
        try {
            val file = crashFile(context)
            if (file.exists()) {
                file.delete()
            }
        } catch (_: Throwable) {
        }
    }
}
