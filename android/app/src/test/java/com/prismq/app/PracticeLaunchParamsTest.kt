package com.prismq.app

import com.prismq.app.ui.PracticeLaunchParams
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PracticeLaunchParamsTest {

    @Test
    fun create_normalizesBlankFieldsAndPreservesLaunchId() {
        val defaultParams = PracticeLaunchParams.create(
            bankId = "   ",
            mode = "",
            recite = false,
            chapterId = "  ",
            type = "",
            difficultyTier = "\t",
            minStar = -2,
            launchId = 1L
        )
        assertEquals("all", defaultParams.bankId)
        assertEquals("sequential", defaultParams.mode)
        assertEquals(false, defaultParams.recite)
        assertNull(defaultParams.chapterId)
        assertNull(defaultParams.type)
        assertNull(defaultParams.difficultyTier)
        assertEquals(0, defaultParams.minStar)
        assertEquals(1L, defaultParams.launchId)

        val customParams = PracticeLaunchParams.create(
            bankId = " bank-123 ",
            mode = " random ",
            recite = true,
            chapterId = " ch-9 ",
            type = " single ",
            difficultyTier = " hard ",
            minStar = 4,
            launchId = 2L
        )
        assertEquals("bank-123", customParams.bankId)
        assertEquals("random", customParams.mode)
        assertEquals(true, customParams.recite)
        assertEquals("ch-9", customParams.chapterId)
        assertEquals("single", customParams.type)
        assertEquals("hard", customParams.difficultyTier)
        assertEquals(4, customParams.minStar)
        assertEquals(2L, customParams.launchId)
    }
}
