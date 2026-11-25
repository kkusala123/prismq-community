package com.kaoshibao.pro

import com.kaoshibao.pro.util.AppUpdateManager
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateManagerTest {

    @Test
    fun `semver and versionCode comparison detects newer releases accurately`() {
        assertTrue(
            AppUpdateManager.isNewerVersion(
                latestVersion = "v2.3.0",
                latestCode = 6,
                currentVersion = "2.2.0",
                currentCode = 5
            )
        )
        assertTrue(
            AppUpdateManager.isNewerVersion(
                latestVersion = "2.2.0",
                latestCode = 6,
                currentVersion = "2.2.0",
                currentCode = 5
            )
        )
        assertFalse(
            AppUpdateManager.isNewerVersion(
                latestVersion = "2.2.0",
                latestCode = 5,
                currentVersion = "2.2.0",
                currentCode = 5
            )
        )
        assertFalse(
            AppUpdateManager.isNewerVersion(
                latestVersion = "2.1.0",
                latestCode = 10,
                currentVersion = "2.2.0",
                currentCode = 5
            )
        )
    }
}
