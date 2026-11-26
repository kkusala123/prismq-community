package com.prismq.app

import com.prismq.app.security.ObfuscatedSecrets
import com.prismq.app.ui.components.ContentCodeParser
import com.prismq.app.ui.components.RichSegment
import com.prismq.app.util.AppIntegrityShield
import com.prismq.app.util.ExamSecurityGuard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SecurityAndFormatterTest {

    @Test
    fun evaluateBuildFingerprint_flagsEmulatorAndX86Abi() {
        val reasons = ExamSecurityGuard.evaluateBuildFingerprint(
            ExamSecurityGuard.BuildFingerprintInput(
                fingerprint = "generic/sdk_gphone_x86_64/generic_x86_64:14",
                model = "sdk_gphone_x86_64",
                manufacturer = "Google",
                brand = "google",
                device = "generic_x86_64",
                product = "sdk_gphone_x86_64",
                hardware = "ranchu",
                board = "ranchu",
                abis = listOf("x86_64")
            )
        )
        assertTrue(reasons.isNotEmpty())
        assertTrue(reasons.any { it.contains("模拟器") || it.contains("ABI") })
    }

    @Test
    fun evaluateBuildFingerprint_acceptsRealArmDevice() {
        val reasons = ExamSecurityGuard.evaluateBuildFingerprint(
            ExamSecurityGuard.BuildFingerprintInput(
                fingerprint = "Xiaomi/mondrian/mondrian:14/UKQ1.230804.001/V816:user/release-keys",
                model = "23013RK75C",
                manufacturer = "Xiaomi",
                brand = "Redmi",
                device = "mondrian",
                product = "mondrian",
                hardware = "qcom",
                board = "kalama",
                abis = listOf("arm64-v8a", "armeabi-v7a")
            )
        )
        assertEquals(0, reasons.size)
    }

    @Test
    fun contentCodeParser_formatsCompressedJavaAndPreservesPlainText() {
        val sample = "下面程序输出是什么？\n```java\npublic class Demo{public static void main(String[] args){int x=1;System.out.println(x);}}\n```"
        val segments = ContentCodeParser.parseSegments(sample)
        assertEquals(2, segments.size)
        val block = segments[1] as RichSegment.CodeBlock
        assertEquals("java", block.lang)
        assertTrue(block.code.contains("\n  public static void main"))

        val plainSegments = ContentCodeParser.parseSegments("这是一道普通的概念判断题。")
        assertEquals(1, plainSegments.size)
        assertTrue(plainSegments[0] is RichSegment.Plain)
    }

    @Test
    fun obfuscatedSecrets_decodeExpectedConstants() {
        assertEquals("https://prismq.example.com", ObfuscatedSecrets.serverUrl())
        assertEquals("com.prismq.app", ObfuscatedSecrets.expectedPackage())
        assertEquals(":69A2", ObfuscatedSecrets.fridaTcpPortHex())
        assertTrue(ObfuscatedSecrets.hookKeywords().contains("frida"))
    }

    @Test
    fun integrityShieldHelpers_detectTracerHooksAndCertMismatch() {
        assertEquals(12345, AppIntegrityShield.parseTracerPid("Name:\tprismq\nTracerPid:\t12345\nUid:\t1000"))
        assertEquals(0, AppIntegrityShield.parseTracerPid("Name:\tprismq\nTracerPid:\t0\n"))

        val hits = AppIntegrityShield.detectHookMaps(
            mapsText = "7f80000000-7f80100000 r-xp /data/local/tmp/frida-agent-64.so\n7f80200000 r-xp /system/lib64/liblsposed.so",
            keywords = listOf("frida", "lsposed", "xposed")
        )
        assertEquals(listOf("frida", "lsposed"), hits)

        assertTrue(AppIntegrityShield.detectFridaTcpEntries("0: 00000000:69A2 00000000:0000 0A", ":69A2"))
        assertFalse(AppIntegrityShield.detectFridaTcpEntries("0: 00000000:1F90 00000000:0000 0A", ":69A2"))

        assertTrue(AppIntegrityShield.compareCertSha256("AA:BB:CC", "aabbcc"))
        assertFalse(AppIntegrityShield.compareCertSha256("AA:BB:CD", "AABBCC"))
    }
}
