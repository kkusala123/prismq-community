package com.kaoshibao.pro.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "kaoshibao_prefs")

data class StoredPrefs(
    val serverUrl: String = AppPreferences.DEFAULT_SERVER_URL,
    val authToken: String = "",
    val fontSize: String = "md",
    val eyeCare: Boolean = false,
    val darkMode: Boolean = false,
    val autoNextDelayMs: Int = 650,
    val switchAnimationMs: Int = 260
)

class AppPreferences(private val context: Context) {

    val prefsFlow: Flow<StoredPrefs> = context.dataStore.data.map { prefs ->
        val rawUrl = prefs[KEY_SERVER_URL]
        val normalizedUrl = if (rawUrl.isNullOrBlank()) {
            DEFAULT_SERVER_URL
        } else {
            runCatching { normalizeServerUrl(rawUrl) }.getOrDefault(DEFAULT_SERVER_URL)
        }
        StoredPrefs(
            serverUrl = normalizedUrl,
            authToken = prefs[KEY_AUTH_TOKEN] ?: "",
            fontSize = prefs[KEY_FONT_SIZE] ?: "md",
            eyeCare = prefs[KEY_EYE_CARE] ?: false,
            darkMode = prefs[KEY_DARK_MODE] ?: false,
            autoNextDelayMs = (prefs[KEY_AUTO_NEXT_DELAY_MS] ?: 650).coerceIn(150, 2500),
            switchAnimationMs = (prefs[KEY_SWITCH_ANIM_MS] ?: 260).coerceIn(0, 600)
        )
    }

    suspend fun saveServerUrl(url: String) {
        val normalized = normalizeServerUrl(url)
        context.dataStore.edit { it[KEY_SERVER_URL] = normalized }
    }

    suspend fun saveAuthToken(token: String) {
        context.dataStore.edit { it[KEY_AUTH_TOKEN] = token }
    }

    suspend fun savePracticeStyle(fontSize: String, eyeCare: Boolean) {
        context.dataStore.edit {
            it[KEY_FONT_SIZE] = fontSize
            it[KEY_EYE_CARE] = eyeCare
        }
    }

    suspend fun saveDarkMode(enabled: Boolean) {
        context.dataStore.edit { it[KEY_DARK_MODE] = enabled }
    }

    suspend fun savePracticeTiming(autoNextDelayMs: Int, switchAnimationMs: Int) {
        context.dataStore.edit {
            it[KEY_AUTO_NEXT_DELAY_MS] = autoNextDelayMs.coerceIn(150, 2500)
            it[KEY_SWITCH_ANIM_MS] = switchAnimationMs.coerceIn(0, 600)
        }
    }

    suspend fun clearAuth() {
        context.dataStore.edit { it.remove(KEY_AUTH_TOKEN) }
    }

    companion object {
        // 开源社区版默认连接本地模拟器网关，可在登录页或设置页自由修改为你的自建服务地址
        const val DEFAULT_SERVER_URL = "http://10.0.2.2:3000"

        fun normalizeServerUrl(raw: String): String {
            var trimmed = raw.trim().trimEnd('/')
            require(trimmed.isNotEmpty()) { "请输入服务器地址" }
            if (!trimmed.startsWith("http://", ignoreCase = true) &&
                !trimmed.startsWith("https://", ignoreCase = true)
            ) {
                trimmed = "https://$trimmed"
            }
            val parsed = java.net.URI(trimmed)
            val scheme = parsed.scheme?.lowercase() ?: ""
            require(scheme == "http" || scheme == "https") { "仅支持 http:// 或 https:// 服务器地址" }
            require(!parsed.host.isNullOrBlank()) { "服务器地址格式无效" }
            val portPart = if (parsed.port != -1) ":${parsed.port}" else ""
            val pathPart = parsed.rawPath?.trimEnd('/')?.takeIf { it.isNotEmpty() } ?: ""
            return "$scheme://${parsed.host}$portPart$pathPart"
        }

        private val KEY_SERVER_URL = stringPreferencesKey("server_url")
        private val KEY_AUTH_TOKEN = stringPreferencesKey("auth_token")
        private val KEY_FONT_SIZE = stringPreferencesKey("font_size")
        private val KEY_EYE_CARE = booleanPreferencesKey("eye_care")
        private val KEY_DARK_MODE = booleanPreferencesKey("dark_mode")
        private val KEY_AUTO_NEXT_DELAY_MS = intPreferencesKey("auto_next_delay_ms")
        private val KEY_SWITCH_ANIM_MS = intPreferencesKey("switch_animation_ms")
    }
}
