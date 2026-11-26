package com.prismq.app.data.local

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.prismq.app.security.ObfuscatedSecrets
import kotlinx.coroutines.flow.first
import java.io.File

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "prismq_prefs")

data class UserScopedPrefs(
    val fontSize: String = "md",
    val eyeCare: Boolean = false,
    val darkMode: Boolean = false,
    val autoNextDelayMs: Int = 650,
    val switchAnimationMs: Int = 260
)

class AppPreferences(private val context: Context) {

    suspend fun readSession(): Pair<String, String> {
        val prefs = context.dataStore.data.first()
        val token = TokenCrypto.decrypt(prefs[KEY_AUTH_TOKEN] ?: "")
        val activeUserId = prefs[KEY_ACTIVE_USER_ID] ?: ""
        return token to activeUserId
    }

    suspend fun readUserPrefs(userId: String): UserScopedPrefs {
        if (userId.isBlank()) return UserScopedPrefs()
        val prefs = context.dataStore.data.first()
        return UserScopedPrefs(
            fontSize = prefs[userFontSizeKey(userId)] ?: "md",
            eyeCare = prefs[userEyeCareKey(userId)] ?: false,
            darkMode = prefs[userDarkModeKey(userId)] ?: false,
            autoNextDelayMs = (prefs[userAutoNextDelayKey(userId)] ?: 650).coerceIn(150, 2500),
            switchAnimationMs = (prefs[userSwitchAnimKey(userId)] ?: 260).coerceIn(0, 600)
        )
    }

    suspend fun saveAuthSession(token: String, userId: String) {
        val encrypted = TokenCrypto.encrypt(token)
        context.dataStore.edit {
            it[KEY_AUTH_TOKEN] = encrypted
            it[KEY_ACTIVE_USER_ID] = userId
        }
    }

    suspend fun savePracticeStyle(userId: String, fontSize: String, eyeCare: Boolean) {
        if (userId.isBlank()) return
        context.dataStore.edit {
            it[userFontSizeKey(userId)] = fontSize
            it[userEyeCareKey(userId)] = eyeCare
        }
    }

    suspend fun saveDarkMode(userId: String, enabled: Boolean) {
        if (userId.isBlank()) return
        context.dataStore.edit { it[userDarkModeKey(userId)] = enabled }
    }

    suspend fun savePracticeTiming(userId: String, autoNextDelayMs: Int, switchAnimationMs: Int) {
        if (userId.isBlank()) return
        context.dataStore.edit {
            it[userAutoNextDelayKey(userId)] = autoNextDelayMs.coerceIn(150, 2500)
            it[userSwitchAnimKey(userId)] = switchAnimationMs.coerceIn(0, 600)
        }
    }

    suspend fun clearAuth() {
        context.dataStore.edit {
            it.remove(KEY_AUTH_TOKEN)
            it.remove(KEY_ACTIVE_USER_ID)
        }
    }

    fun clearUserTempCaches() {
        runCatching {
            val sharesDir = File(context.cacheDir, "shares")
            if (sharesDir.exists()) {
                sharesDir.deleteRecursively()
            }
        }
    }

    companion object {
        // 锁定官方公网生产服务器地址（经构建期字节阵列加密存储，防直接静态逆向检索）
        val FIXED_SERVER_URL: String
            get() = ObfuscatedSecrets.serverUrl()

        private val KEY_AUTH_TOKEN = stringPreferencesKey("auth_token")
        private val KEY_ACTIVE_USER_ID = stringPreferencesKey("active_user_id")

        fun userScopePrefix(userId: String): String {
            val clean = userId.trim().replace(Regex("[^A-Za-z0-9_-]"), "_")
            return clean.ifBlank { "guest" }
        }

        fun userFontSizeKey(userId: String) =
            stringPreferencesKey("u_${userScopePrefix(userId)}_font_size")

        fun userEyeCareKey(userId: String) =
            booleanPreferencesKey("u_${userScopePrefix(userId)}_eye_care")

        fun userDarkModeKey(userId: String) =
            booleanPreferencesKey("u_${userScopePrefix(userId)}_dark_mode")

        fun userAutoNextDelayKey(userId: String) =
            intPreferencesKey("u_${userScopePrefix(userId)}_auto_next_delay_ms")

        fun userSwitchAnimKey(userId: String) =
            intPreferencesKey("u_${userScopePrefix(userId)}_switch_animation_ms")
    }
}
