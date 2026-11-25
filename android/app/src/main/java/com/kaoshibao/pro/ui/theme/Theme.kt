package com.kaoshibao.pro.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

@Immutable
data class KsbPalette(
    val isDark: Boolean,
    val brand: Color,
    val brandDark: Color,
    val brandSoft: Color,
    val brandBorder: Color,
    val canvas: Color,
    val card: Color,
    val cardElevated: Color,
    val border: Color,
    val borderInput: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val success: Color,
    val successBg: Color,
    val error: Color,
    val errorBg: Color,
    val warning: Color,
    val warningBg: Color,
    val ai: Color,
    val aiBg: Color,
    val eyeCareBg: Color,
    val eyeCareCard: Color,
    val eyeCareBorder: Color
)

val LightKsbPalette = KsbPalette(
    isDark = false,
    brand = Color(0xFF007AFF),
    brandDark = Color(0xFF0062CC),
    brandSoft = Color(0xFFEAF3FF),
    brandBorder = Color(0xFFCCE3FF),
    canvas = Color(0xFFF2F2F7),
    card = Color(0xFFFFFFFF),
    cardElevated = Color(0xFFF2F2F7),
    border = Color(0xFFE5E5EA),
    borderInput = Color(0xFFD1D1D6),
    textPrimary = Color(0xFF1C1C1E),
    textSecondary = Color(0xFF636366),
    textMuted = Color(0xFF8E8E93),
    success = Color(0xFF34C759),
    successBg = Color(0xFFEAF9EE),
    error = Color(0xFFFF3B30),
    errorBg = Color(0xFFFFECEB),
    warning = Color(0xFFFF9500),
    warningBg = Color(0xFFFFF4E5),
    ai = Color(0xFF5856D6),
    aiBg = Color(0xFFEFEEFC),
    eyeCareBg = Color(0xFFEBF0E4),
    eyeCareCard = Color(0xFFF7FAF2),
    eyeCareBorder = Color(0xFFD5E0C8)
)

val DarkKsbPalette = KsbPalette(
    isDark = true,
    brand = Color(0xFF0A84FF),
    brandDark = Color(0xFF64B5FF),
    brandSoft = Color(0xFF0A2540),
    brandBorder = Color(0xFF1B3B5F),
    canvas = Color(0xFF000000),
    card = Color(0xFF1C1C1E),
    cardElevated = Color(0xFF2C2C2E),
    border = Color(0xFF2C2C2E),
    borderInput = Color(0xFF3A3A3C),
    textPrimary = Color(0xFFFFFFFF),
    textSecondary = Color(0xFFAEAEB2),
    textMuted = Color(0xFF8E8E93),
    success = Color(0xFF30D158),
    successBg = Color(0xFF0D2E18),
    error = Color(0xFFFF453A),
    errorBg = Color(0xFF3A1210),
    warning = Color(0xFFFF9F0A),
    warningBg = Color(0xFF382406),
    ai = Color(0xFF5E5CE6),
    aiBg = Color(0xFF1E1D44),
    eyeCareBg = Color(0xFF141B14),
    eyeCareCard = Color(0xFF1B241B),
    eyeCareBorder = Color(0xFF2F3F2F)
)

val LocalKsbPalette = staticCompositionLocalOf { LightKsbPalette }

object KsbTheme {
    val colors: KsbPalette
        @Composable
        get() = LocalKsbPalette.current
}

object KsbColors {
    val BrandBlue = LightKsbPalette.brand
    val BrandBlueDark = LightKsbPalette.brandDark
    val BrandBlueSoft = LightKsbPalette.brandSoft
    val BrandBlueBorder = LightKsbPalette.brandBorder

    val CanvasGray = LightKsbPalette.canvas
    val CardWhite = LightKsbPalette.card
    val BorderLight = LightKsbPalette.border
    val BorderInput = LightKsbPalette.borderInput

    val TextPrimary = LightKsbPalette.textPrimary
    val TextSecondary = LightKsbPalette.textSecondary
    val TextMuted = LightKsbPalette.textMuted

    val SuccessGreen = LightKsbPalette.success
    val SuccessBg = LightKsbPalette.successBg
    val ErrorRed = LightKsbPalette.error
    val ErrorBg = LightKsbPalette.errorBg
    val WarningAmber = LightKsbPalette.warning
    val WarningBg = LightKsbPalette.warningBg
    val AiIndigo = LightKsbPalette.ai
    val AiBg = LightKsbPalette.aiBg

    val EyeCareBg = LightKsbPalette.eyeCareBg
    val EyeCareCard = LightKsbPalette.eyeCareCard
    val EyeCareBorder = LightKsbPalette.eyeCareBorder
}

private val LightColorScheme = lightColorScheme(
    primary = LightKsbPalette.brand,
    onPrimary = Color.White,
    primaryContainer = LightKsbPalette.brandSoft,
    onPrimaryContainer = Color(0xFF1E3A8A),
    secondary = LightKsbPalette.ai,
    onSecondary = Color.White,
    secondaryContainer = LightKsbPalette.aiBg,
    onSecondaryContainer = Color(0xFF312E81),
    background = LightKsbPalette.canvas,
    onBackground = LightKsbPalette.textPrimary,
    surface = LightKsbPalette.card,
    onSurface = LightKsbPalette.textPrimary,
    surfaceVariant = LightKsbPalette.cardElevated,
    onSurfaceVariant = LightKsbPalette.textSecondary,
    outline = LightKsbPalette.borderInput,
    outlineVariant = LightKsbPalette.border,
    error = LightKsbPalette.error,
    onError = Color.White,
    errorContainer = LightKsbPalette.errorBg,
    onErrorContainer = Color(0xFF881337)
)

private val DarkColorScheme = darkColorScheme(
    primary = DarkKsbPalette.brand,
    onPrimary = Color.White,
    primaryContainer = DarkKsbPalette.brandSoft,
    onPrimaryContainer = Color(0xFFDBEAFE),
    secondary = DarkKsbPalette.ai,
    onSecondary = Color.White,
    secondaryContainer = DarkKsbPalette.aiBg,
    onSecondaryContainer = Color(0xFFE0E7FF),
    background = DarkKsbPalette.canvas,
    onBackground = DarkKsbPalette.textPrimary,
    surface = DarkKsbPalette.card,
    onSurface = DarkKsbPalette.textPrimary,
    surfaceVariant = DarkKsbPalette.cardElevated,
    onSurfaceVariant = DarkKsbPalette.textSecondary,
    outline = DarkKsbPalette.borderInput,
    outlineVariant = DarkKsbPalette.border,
    error = DarkKsbPalette.error,
    onError = Color.White,
    errorContainer = DarkKsbPalette.errorBg,
    onErrorContainer = Color(0xFFFFE4E6)
)

private val KsbTypography = Typography(
    headlineSmall = TextStyle(
        fontSize = 22.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 28.sp,
        letterSpacing = (-0.4).sp
    ),
    titleMedium = TextStyle(
        fontSize = 16.sp,
        fontWeight = FontWeight.Bold,
        lineHeight = 22.sp,
        letterSpacing = (-0.2).sp
    ),
    bodyLarge = TextStyle(
        fontSize = 15.sp,
        lineHeight = 22.sp
    ),
    bodyMedium = TextStyle(
        fontSize = 13.sp,
        lineHeight = 19.sp
    ),
    labelMedium = TextStyle(
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold
    )
)

@Composable
fun KaoshibaoTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit
) {
    val palette = if (darkTheme) DarkKsbPalette else LightKsbPalette
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    CompositionLocalProvider(LocalKsbPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = KsbTypography,
            content = content
        )
    }
}
