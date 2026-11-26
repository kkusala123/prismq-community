import java.io.FileInputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.util.Properties
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties()
val hasReleaseKeystore = keystorePropsFile.exists()
if (hasReleaseKeystore) {
    FileInputStream(keystorePropsFile).use { keystoreProps.load(it) }
}

val releaseCertSha256: String = if (hasReleaseKeystore) {
    val ksFile = rootProject.file(keystoreProps.getProperty("storeFile", "prismq-release.jks"))
    val storePass = keystoreProps.getProperty("storePassword", "").toCharArray()
    val keyAlias = keystoreProps.getProperty("keyAlias", "prismq_release")
    if (ksFile.exists()) {
        val ks = KeyStore.getInstance(KeyStore.getDefaultType())
        FileInputStream(ksFile).use { ks.load(it, storePass) }
        val cert = ks.getCertificate(keyAlias)
        if (cert != null) {
            MessageDigest.getInstance("SHA-256")
                .digest(cert.encoded)
                .joinToString("") { "%02X".format(it) }
        } else ""
    } else ""
} else ""

val generatedSecretsDir = layout.buildDirectory.dir("generated/source/prismqSecrets")

val generateObfuscatedSecrets by tasks.registering {
    val outDir = generatedSecretsDir
    val certHexInput = releaseCertSha256
    val configuredServerUrl = (project.findProperty("PRISMQ_SERVER_URL") as? String)
        ?.trim()
        ?.ifBlank { null }
        ?: "https://prismq.example.com"
    outputs.dir(outDir)
    inputs.property("certHex", certHexInput)
    inputs.property("serverUrl", configuredServerUrl)

    doLast {
        val pkgDir = outDir.get().asFile.resolve("com/prismq/app/security")
        pkgDir.mkdirs()

        fun encodeLiteral(name: String, plain: String, salt: Int): String {
            val bytes = plain.toByteArray(Charsets.UTF_8)
            val encoded = bytes.mapIndexed { idx, b ->
                val mask = ((salt * 31 + idx * 17 + 0x5A) and 0xFF)
                ((b.toInt() and 0xFF) xor mask)
            }
            val arrExpr = encoded.joinToString(", ")
            return """    fun $name(): String = dec(intArrayOf($arrExpr), $salt)"""
        }

        val entries = listOf(
            encodeLiteral("serverUrl", configuredServerUrl, 0x3D),
            encodeLiteral("expectedPackage", "com.prismq.app", 0x71),
            encodeLiteral("expectedCertSha256", certHexInput, 0x2B),
            encodeLiteral("sysPropsClass", "android.os.SystemProperties", 0x4F),
            encodeLiteral("procSelfMaps", "/proc/self/maps", 0x19),
            encodeLiteral("procSelfStatus", "/proc/self/status", 0x63),
            encodeLiteral("procNetTcp", "/proc/net/tcp", 0x55),
            encodeLiteral("tracerPidPrefix", "TracerPid:", 0x87),
            encodeLiteral("hookKeywords", "frida,gadget,xposed,lsposed,edxposed,substrate,libepic,libwhale,libsandhook", 0xA3),
            encodeLiteral("fridaTcpPortHex", ":69A2", 0xC9)
        ).joinToString("\n\n")

        val code = """package com.prismq.app.security

internal object ObfuscatedSecrets {

    private fun dec(data: IntArray, salt: Int): String {
        if (data.isEmpty()) return ""
        val out = ByteArray(data.size)
        for (i in data.indices) {
            val mask = (salt * 31 + i * 17 + 0x5A) and 0xFF
            out[i] = (data[i] xor mask).toByte()
        }
        return String(out, Charsets.UTF_8)
    }

$entries
}
"""
        pkgDir.resolve("ObfuscatedSecrets.kt").writeText(code, Charsets.UTF_8)
    }
}

android {
    namespace = "com.prismq.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.prismq.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 16
        versionName = "2.4.8"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    sourceSets {
        getByName("main") {
            java.srcDir(generatedSecretsDir)
        }
    }

    signingConfigs {
        if (hasReleaseKeystore) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile", "prismq-release.jks"))
                storePassword = keystoreProps.getProperty("storePassword", "")
                keyAlias = keystoreProps.getProperty("keyAlias", "prismq_release")
                keyPassword = keystoreProps.getProperty("keyPassword", "")
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        getByName("debug") {
            buildConfigField("boolean", "ENABLE_INTEGRITY_ENFORCEMENT", "false")
        }
        release {
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
            isDebuggable = false
            isJniDebuggable = false
            buildConfigField("boolean", "ENABLE_INTEGRITY_ENFORCEMENT", "true")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += listOf(
                "/META-INF/{AL2.0,LGPL2.1}",
                "/META-INF/*.version",
                "/DebugProbesKt.bin"
            )
        }
    }
}

tasks.withType<KotlinCompile>().configureEach {
    dependsOn(generateObfuscatedSecrets)
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")

    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")

    implementation("androidx.navigation:navigation-compose:2.8.4")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.google.zxing:core:3.5.3")

    testImplementation("junit:junit:4.13.2")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
