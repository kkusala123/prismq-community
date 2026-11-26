/**
 * 棱题 · PrismQ 小程序端代码格式化与富文本分段解析器
 */

function detectCodeLang(code) {
    const s = String(code || '').trim();
    if (!s) return 'code';
    if (/#\s*include\b|std::/.test(s)) return 'cpp';
    if (/public\s+class\b|System\.out\./.test(s)) return 'java';
    if (/(^|\n)\s*def\s+\w+\s*\(/.test(s)) return 'python';
    if (/console\.log\(|function\s+\w+\s*\(/.test(s)) return 'js';
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(s)) return 'sql';
    return 'code';
}

function formatBraceCode(src) {
    const out = [];
    let buf = '';
    let indent = 0;
    let paren = 0;
    let quote = null;

    function flush() {
        const t = buf.trim();
        buf = '';
        if (t) {
            out.push('  '.repeat(Math.max(0, indent)) + t);
        }
    }

    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        const next = src[i + 1] || '';
        if (quote) {
            buf += ch;
            if (ch === '\\' && i + 1 < src.length) {
                buf += src[i + 1];
                i += 1;
            } else if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            quote = ch;
            buf += ch;
            continue;
        }
        if (ch === '(') {
            paren += 1;
            buf += ch;
        } else if (ch === ')') {
            paren = Math.max(0, paren - 1);
            buf += ch;
        } else if (ch === '\r') {
            continue;
        } else if (ch === '\n') {
            if (buf && !buf.endsWith(' ')) buf += ' ';
        } else if (ch === '{') {
            const b = buf.trim();
            if (b.endsWith('=') || b.endsWith('[]')) {
                buf += ch;
            } else {
                buf = b ? b + ' {' : '{';
                flush();
                indent += 1;
            }
        } else if (ch === '}') {
            flush();
            indent = Math.max(0, indent - 1);
            if (next === ';') {
                out.push('  '.repeat(indent) + '};');
                i += 1;
            } else {
                out.push('  '.repeat(indent) + '}');
            }
        } else if (ch === ';' && paren === 0) {
            buf += ch;
            flush();
        } else if ((ch === ' ' || ch === '\t') && (!buf || buf.endsWith(' '))) {
            continue;
        } else {
            buf += ch;
        }
    }
    flush();
    return out.join('\n');
}

function formatSnippet(code, lang) {
    const clean = String(code || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/^\n+|\n+$/g, '');
    const lines = clean.split('\n');
    if (
        lang !== 'python' &&
        lang !== 'sql' &&
        clean.indexOf('{') >= 0 &&
        clean.indexOf('}') >= 0 &&
        lines.length <= 2 &&
        (clean.indexOf(';') >= 0 || (clean.match(/\{/g) || []).length >= 2)
    ) {
        return formatBraceCode(clean);
    }
    return clean;
}

function parseRichSegments(raw) {
    let text = String(raw || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();
    if (!text) return [];

    // 若文本尚无代码块围栏，尝试自动识别 C/Java/JS 等语句块
    if (text.indexOf('```') === -1) {
        const inlineMatch = text.match(/((?:#\s*include\s*<[^>]+>\s*|public\s+class\b|class\s+[A-Z]\w*|def\s+\w+\s*\(|int\s+main\s*\(|function\s+\w+\s*\()[\s\S]*)$/);
        if (inlineMatch && inlineMatch[1] && inlineMatch[1].length >= 16) {
            const idx = text.indexOf(inlineMatch[1]);
            const head = text.slice(0, idx).trim();
            const code = formatSnippet(inlineMatch[1], detectCodeLang(inlineMatch[1]));
            const out = [];
            if (head) out.push({ type: 'text', content: head });
            out.push({ type: 'code', lang: detectCodeLang(code), content: code });
            return out;
        }
    }

    const segments = [];
    const fenceRe = /```([a-zA-Z0-9_+#-]*)\s*\n?([\s\S]*?)```/g;
    let cursor = 0;
    let m;
    while ((m = fenceRe.exec(text)) !== null) {
        if (m.index > cursor) {
            const before = text.slice(cursor, m.index).replace(/^\n+|\n+$/g, '');
            if (before) segments.push({ type: 'text', content: before });
        }
        const rawLang = (m[1] || '').trim().toLowerCase();
        const code = formatSnippet(m[2], rawLang || detectCodeLang(m[2]));
        segments.push({ type: 'code', lang: rawLang || detectCodeLang(code), content: code });
        cursor = fenceRe.lastIndex;
    }
    if (cursor < text.length) {
        const tail = text.slice(cursor).replace(/^\n+|\n+$/g, '');
        if (tail) segments.push({ type: 'text', content: tail });
    }
    return segments;
}

module.exports = {
    parseRichSegments: parseRichSegments,
};
