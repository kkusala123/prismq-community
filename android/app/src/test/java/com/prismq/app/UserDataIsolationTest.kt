package com.prismq.app

import com.prismq.app.data.local.AppPreferences
import com.prismq.app.ui.buildPracticeRoute
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class UserDataIsolationTest {

    @Test
    fun userScopePrefix_sanitizesAndIsolatesIds() {
        assertEquals("guest", AppPreferences.userScopePrefix("   "))
        assertEquals("user_123_abc-1", AppPreferences.userScopePrefix("user:123/abc-1"))
        assertNotEquals(
            AppPreferences.userScopePrefix("userA"),
            AppPreferences.userScopePrefix("userB")
        )
    }

    @Test
    fun scopedPreferenceKeys_neverCollideAcrossUsers() {
        val u1 = "user-001"
        val u2 = "user-002"

        assertNotEquals(AppPreferences.userFontSizeKey(u1).name, AppPreferences.userFontSizeKey(u2).name)
        assertNotEquals(AppPreferences.userEyeCareKey(u1).name, AppPreferences.userEyeCareKey(u2).name)
        assertNotEquals(AppPreferences.userDarkModeKey(u1).name, AppPreferences.userDarkModeKey(u2).name)
        assertNotEquals(AppPreferences.userAutoNextDelayKey(u1).name, AppPreferences.userAutoNextDelayKey(u2).name)
        assertNotEquals(AppPreferences.userSwitchAnimKey(u1).name, AppPreferences.userSwitchAnimKey(u2).name)

        assertEquals("u_user-001_dark_mode", AppPreferences.userDarkModeKey(u1).name)
        assertEquals("u_user-002_dark_mode", AppPreferences.userDarkModeKey(u2).name)
    }

    @Test
    fun buildPracticeRoute_omitsBlankOptionalQueryParams() {
        val basicRoute = buildPracticeRoute(
            bankId = "bank-123",
            mode = "sequential",
            recite = false,
            chapterId = null,
            type = "",
            difficultyTier = "  ",
            minStar = 0
        )
        assertEquals("practice/bank-123?mode=sequential&recite=false&minStar=0", basicRoute)
        assertFalse(basicRoute.contains("chapterId="))
        assertFalse(basicRoute.contains("type="))
        assertFalse(basicRoute.contains("difficultyTier="))

        val filteredRoute = buildPracticeRoute(
            bankId = "bank-123",
            mode = "difficulty_asc",
            recite = true,
            chapterId = "ch-1",
            type = "single",
            difficultyTier = "hard",
            minStar = 3
        )
        assertTrue(filteredRoute.contains("chapterId=ch-1"))
        assertTrue(filteredRoute.contains("type=single"))
        assertTrue(filteredRoute.contains("difficultyTier=hard"))
        assertTrue(filteredRoute.contains("minStar=3"))
    }
}
