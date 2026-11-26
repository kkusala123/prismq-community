package com.prismq.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.prismq.app.ui.theme.KsbTheme

sealed interface RichSegment {
    data class Plain(val text: String) : RichSegment
    data class InlineCode(val code: String) : RichSegment
    data class CodeBlock(val lang: String, val code: String) : RichSegment
}

private val FENCE_REGEX = Regex("```([a-zA-Z0-9_+#-]*)\\s*\\n?([\\s\\S]*?)```")
private val INLINE_BACKTICK_REGEX = Regex("`([^`\\n]+)`")

private val CODE_KEYWORD_REGEX = Regex(
    "(//[^\\n]*|/\\*[\\s\\S]*?\\*/|\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|\\b(?:public|private|protected|static|final|class|interface|extends|implements|void|return|if|else|for|while|do|switch|case|break|continue|new|import|package|from|def|elif|pass|function|const|let|var|struct|SELECT|FROM|WHERE|GROUP|BY|ORDER|JOIN|INSERT|INTO|UPDATE|SET|DELETE|int|long|double|float|char|boolean|bool|String|true|false|null|None)\\b|\\b\\d+(?:\\.\\d+)?\\b)"
)

object ContentCodeParser {

    fun parseSegments(raw: String): List<RichSegment> {
        val text = raw.replace("\r\n", "\n").replace("\r", "\n").trim()
        if (text.isEmpty()) return emptyList()

        val result = mutableListOf<RichSegment>()
        val normalized = if (text.contains("```")) text else formatUnfencedIfNeeded(text)

        var cursor = 0
        for (match in FENCE_REGEX.findAll(normalized)) {
            if (match.range.first > cursor) {
                val before = normalized.substring(cursor, match.range.first).trim('\n')
                if (before.isNotEmpty()) {
                    parseInlineAndText(before, result)
                }
            }
            val rawLang = match.groupValues[1].trim()
            val rawCode = match.groupValues[2].trim('\n')
            val formattedCode = formatCode(rawCode, rawLang)
            result.add(RichSegment.CodeBlock(rawLang.ifBlank { detectLang(formattedCode) }, formattedCode))
            cursor = match.range.last + 1
        }
        if (cursor < normalized.length) {
            val tail = normalized.substring(cursor).trim('\n')
            if (tail.isNotEmpty()) {
                parseInlineAndText(tail, result)
            }
        }
        return result
    }

    private fun parseInlineAndText(chunk: String, out: MutableList<RichSegment>) {
        var cursor = 0
        for (m in INLINE_BACKTICK_REGEX.findAll(chunk)) {
            if (m.range.first > cursor) {
                out.add(RichSegment.Plain(chunk.substring(cursor, m.range.first)))
            }
            out.add(RichSegment.InlineCode(m.groupValues[1].trim()))
            cursor = m.range.last + 1
        }
        if (cursor < chunk.length) {
            out.add(RichSegment.Plain(chunk.substring(cursor)))
        }
    }

    private fun formatUnfencedIfNeeded(text: String): String {
        val lines = text.split('\n')
        if (lines.size == 1 && !text.contains("{") && !text.contains(";")) {
            return text
        }
        val codeStartRegex = Regex(
            "(public|private|protected)\\s+(?:static\\s+)?class\\b|#\\s*include\\b|\\bdef\\s+\\w+\\s*\\(|\\bfunction\\s+\\w+\\s*\\("
        )
        val match = codeStartRegex.find(text) ?: return text
        val idx = match.range.first
        if (idx > 0 && idx < text.length - 10) {
            val before = text.substring(0, idx).trim()
            val candidate = text.substring(idx).trim()
            if (candidate.contains("{") || candidate.contains(";") || candidate.contains("\n")) {
                val lang = detectLang(candidate)
                val formatted = formatCode(candidate, lang)
                return "$before\n```$lang\n$formatted\n```"
            }
        }
        return text
    }

    private fun detectLang(code: String): String {
        return when {
            code.contains("#include") || code.contains("std::") -> "cpp"
            code.contains("System.out") || code.contains("public class") -> "java"
            code.contains("def ") && code.contains(":") -> "python"
            code.contains("console.log") || code.contains("function ") -> "javascript"
            Regex("\\bSELECT\\b[\\s\\S]+\\bFROM\\b", RegexOption.IGNORE_CASE).containsMatchIn(code) -> "sql"
            else -> "code"
        }
    }

    internal fun formatCode(rawCode: String, langHint: String): String {
        val lines = rawCode.replace("\r\n", "\n").split('\n').toMutableList()
        while (lines.isNotEmpty() && lines.first().isBlank()) lines.removeAt(0)
        while (lines.isNotEmpty() && lines.last().isBlank()) lines.removeAt(lines.lastIndex)
        if (lines.isEmpty()) return ""

        val nonEmptyIndents = lines.filter { it.isNotBlank() }.map { line ->
            line.takeWhile { it == ' ' || it == '\t' }.replace("\t", "  ").length
        }
        val minIndent = nonEmptyIndents.minOrNull() ?: 0
        val dedented = lines.joinToString("\n") { line ->
            val exp = line.replace("\t", "  ")
            if (exp.length > minIndent) exp.substring(minIndent).trimEnd() else exp.trimEnd()
        }

        // 若单行挤满了多个语句（如 "{ ...; ...; }"），做轻量词法断行缩进
        val lang = langHint.lowercase()
        val braceLike = lang !in setOf("python", "py", "sql", "json")
        if (braceLike && dedented.contains("{") && dedented.contains("}")) {
            val singleLineCompressed = lines.count { it.isNotBlank() } <= 2 && (dedented.contains(";") || dedented.count { it == '{' } >= 2)
            if (singleLineCompressed) {
                return reflowBraceCode(dedented)
            }
        }
        return dedented
    }

    private fun reflowBraceCode(src: String): String {
        val out = mutableListOf<String>()
        val buf = StringBuilder()
        var indent = 0
        var paren = 0
        var quote: Char? = null

        fun flush(offset: Int = 0) {
            val t = buf.toString().trim()
            buf.setLength(0)
            if (t.isNotEmpty()) {
                out.add("  ".repeat((indent + offset).coerceAtLeast(0)) + t)
            }
        }

        var i = 0
        while (i < src.length) {
            val ch = src[i]
            val next = if (i + 1 < src.length) src[i + 1] else '\u0000'
            if (quote != null) {
                buf.append(ch)
                if (ch == '\\' && i + 1 < src.length) {
                    buf.append(src[i + 1])
                    i += 2
                    continue
                }
                if (ch == quote) quote = null
                i += 1
                continue
            }
            if (ch == '"' || ch == '\'' || ch == '`') {
                quote = ch
                buf.append(ch)
                i += 1
                continue
            }
            when (ch) {
                '(' -> { paren += 1; buf.append(ch) }
                ')' -> { paren = (paren - 1).coerceAtLeast(0); buf.append(ch) }
                '\n' -> if (buf.isNotEmpty() && !buf.endsWith(" ")) buf.append(' ')
                '{' -> {
                    val b = buf.toString().trim()
                    if (b.endsWith("=") || b.endsWith("[]")) {
                        buf.append(ch)
                    } else {
                        buf.setLength(0)
                        buf.append(if (b.isNotEmpty()) "$b {" else "{")
                        flush()
                        indent += 1
                    }
                }
                '}' -> {
                    flush()
                    indent = (indent - 1).coerceAtLeast(0)
                    out.add("  ".repeat(indent) + if (next == ';') { i += 1; "};" } else "}")
                }
                ';' -> {
                    buf.append(ch)
                    if (paren == 0) flush()
                }
                ' ', '\t' -> if (buf.isNotEmpty() && !buf.endsWith(" ")) buf.append(' ')
                else -> buf.append(ch)
            }
            i += 1
        }
        flush()
        return out.joinToString("\n")
    }
}

@Composable
fun FormattedContentText(
    text: String,
    modifier: Modifier = Modifier,
    fontSize: TextUnit = 15.sp,
    lineHeight: TextUnit = 23.sp,
    fontWeight: FontWeight = FontWeight.Normal,
    color: Color = KsbTheme.colors.textPrimary
) {
    val palette = KsbTheme.colors
    val clipboard = LocalClipboardManager.current
    val segments = remember(text) { ContentCodeParser.parseSegments(text) }

    if (segments.isEmpty()) return

    val hasCodeBlock = segments.any { it is RichSegment.CodeBlock }
    if (!hasCodeBlock) {
        val annotated = remember(segments, palette, fontSize) {
            buildAnnotatedString {
                segments.forEach { seg ->
                    when (seg) {
                        is RichSegment.Plain -> append(seg.text)
                        is RichSegment.InlineCode -> {
                            withStyle(
                                SpanStyle(
                                    fontFamily = FontFamily.Monospace,
                                    fontWeight = FontWeight.SemiBold,
                                    color = palette.ai,
                                    background = palette.aiBg
                                )
                            ) {
                                append(" ${seg.code} ")
                            }
                        }
                        is RichSegment.CodeBlock -> append(seg.code)
                    }
                }
            }
        }
        Text(
            text = annotated,
            fontSize = fontSize,
            lineHeight = lineHeight,
            fontWeight = fontWeight,
            color = color,
            modifier = modifier
        )
        return
    }

    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        var i = 0
        while (i < segments.size) {
            val seg = segments[i]
            if (seg is RichSegment.CodeBlock) {
                var copied by remember(seg.code) { mutableStateOf(false) }
                Surface(
                    shape = RoundedCornerShape(10.dp),
                    color = Color(0xFF0F172A),
                    border = BorderStroke(1.dp, Color(0xFF334155)),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFF1E293B))
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = seg.lang.uppercase(),
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold,
                                color = Color(0xFF94A3B8)
                            )
                            Text(
                                text = if (copied) "已复制" else "复制代码",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (copied) Color(0xFF34D399) else Color(0xFF93C5FD),
                                modifier = Modifier.clickable {
                                    clipboard.setText(AnnotatedString(seg.code))
                                    copied = true
                                }
                            )
                        }
                        val highlighted = remember(seg.code) {
                            buildHighlightedCode(seg.code)
                        }
                        Text(
                            text = highlighted,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 12.5.sp,
                            lineHeight = 19.sp,
                            modifier = Modifier
                                .fillMaxWidth()
                                .horizontalScroll(rememberScrollState())
                                .padding(horizontal = 12.dp, vertical = 10.dp)
                        )
                    }
                }
                i += 1
            } else {
                val batch = mutableListOf<RichSegment>()
                while (i < segments.size && segments[i] !is RichSegment.CodeBlock) {
                    batch.add(segments[i])
                    i += 1
                }
                val inlineAnnotated = remember(batch, palette) {
                    buildAnnotatedString {
                        batch.forEach { item ->
                            when (item) {
                                is RichSegment.Plain -> append(item.text)
                                is RichSegment.InlineCode -> {
                                    withStyle(
                                        SpanStyle(
                                            fontFamily = FontFamily.Monospace,
                                            fontWeight = FontWeight.SemiBold,
                                            color = palette.ai,
                                            background = palette.aiBg
                                        )
                                    ) {
                                        append(" ${item.code} ")
                                    }
                                }
                                else -> Unit
                            }
                        }
                    }
                }
                Text(
                    text = inlineAnnotated,
                    fontSize = fontSize,
                    lineHeight = lineHeight,
                    fontWeight = fontWeight,
                    color = color
                )
            }
        }
    }
}

private fun buildHighlightedCode(code: String) = buildAnnotatedString {
    var cursor = 0
    for (m in CODE_KEYWORD_REGEX.findAll(code)) {
        if (m.range.first > cursor) {
            withStyle(SpanStyle(color = Color(0xFFF1F5F9))) {
                append(code.substring(cursor, m.range.first))
            }
        }
        val token = m.value
        val style = when {
            token.startsWith("//") || token.startsWith("/*") ->
                SpanStyle(color = Color(0xFF94A3B8))
            token.startsWith("\"") || token.startsWith("'") ->
                SpanStyle(color = Color(0xFF6EE7B7))
            token.firstOrNull()?.isDigit() == true ->
                SpanStyle(color = Color(0xFFFCD34D))
            token in setOf("true", "false", "null", "None") ->
                SpanStyle(color = Color(0xFFFDBA74))
            token in setOf("int", "long", "double", "float", "char", "boolean", "bool", "String", "void") ->
                SpanStyle(color = Color(0xFF67E8F9))
            else ->
                SpanStyle(color = Color(0xFF7DD3FC), fontWeight = FontWeight.SemiBold)
        }
        withStyle(style) {
            append(token)
        }
        cursor = m.range.last + 1
    }
    if (cursor < code.length) {
        withStyle(SpanStyle(color = Color(0xFFF1F5F9))) {
            append(code.substring(cursor))
        }
    }
}
