export interface RichTextSegment {
  type: 'text' | 'code' | 'inline';
  content: string;
  lang?: string;
}

const BRACE_LANGS = new Set([
  'java',
  'c',
  'cpp',
  'c++',
  'cs',
  'csharp',
  'js',
  'javascript',
  'ts',
  'typescript',
  'go',
  'rust',
  'php',
  'kotlin',
  'swift',
  'css',
  'code',
]);

export function detectCodeLanguage(code: string): string {
  const s = code.trim();
  if (!s) return 'code';
  if (/^\s*#\s*include\b|std::|cout\s*<<|cin\s*>>/m.test(s)) return 'cpp';
  if (/\bprintf\s*\(|\bscanf\s*\(|\bmalloc\s*\(/m.test(s)) return 'c';
  if (/\bpublic\s+(?:static\s+)?(?:class|void|int|String)\b|System\.out\.print|\bString\[\]\s*args\b/m.test(s)) {
    return 'java';
  }
  if (/^\s*(?:def\s+\w+\s*\(|class\s+\w+\s*[:(]|elif\b|print\s*\([^;]*$)/m.test(s) || /\bfrom\s+\w+\s+import\b/.test(s)) {
    return 'python';
  }
  if (/\b(?:interface|type)\s+\w+\s*=|:\s*(?:string|number|boolean|void)\b/.test(s)) {
    return 'typescript';
  }
  if (/\b(?:console\.log|function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|=>\s*\{)/m.test(s)) {
    return 'javascript';
  }
  if (/^\s*(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE)\b/i.test(s)) {
    return 'sql';
  }
  if (/^[\[{][\s\S]*[\]}]$/.test(s) && /"\w+"\s*:/.test(s)) return 'json';
  if (/^\s*<[a-zA-Z][^>]*>[\s\S]*<\/[a-zA-Z]+>\s*$/.test(s)) return 'html';
  return 'code';
}

function dedentLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length > 0 && !lines[0].trim()) lines.shift();
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  let minIndent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^(\s*)/);
    if (m) {
      const expanded = m[1].replace(/\t/g, '  ').length;
      if (expanded < minIndent) minIndent = expanded;
    }
  }
  if (!Number.isFinite(minIndent) || minIndent === 0) {
    return lines.map((l) => l.replace(/\t/g, '  ').replace(/\s+$/g, ''));
  }
  return lines.map((l) => {
    const expanded = l.replace(/\t/g, '  ');
    return expanded.slice(Math.min(minIndent, expanded.search(/\S|$/) >= 0 ? minIndent : 0)).replace(/\s+$/g, '');
  });
}

function normalizeInlineDeclarationSpacing(line: string): string {
  // Normalize comma spacing outside string literals (e.g. `int a[],b;` -> `int a[], b;`)
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < line.length) {
        out += line[i + 1];
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === ',') {
      out += ',';
      const next = line[i + 1];
      if (next && next !== ' ' && next !== '\t' && next !== '\n' && next !== ')' && next !== ']') {
        out += ' ';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function formatBraceCode(code: string): string {
  const rawLines = dedentLines(code);
  const rawJoined = rawLines.join('\n').trim();
  if (!rawJoined) return '';

  // Tokenize lexically to reflow minified or badly indented code cleanly
  const outLines: string[] = [];
  let buf = '';
  let indent = 0;
  let parenDepth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;

  const pushLine = (levelOffset = 0) => {
    const trimmed = buf.trim();
    buf = '';
    if (!trimmed) return;
    const safeIndent = Math.max(0, indent + levelOffset);
    outLines.push(`${'  '.repeat(safeIndent)}${normalizeInlineDeclarationSpacing(trimmed)}`);
  };

  for (let i = 0; i < rawJoined.length; i += 1) {
    const ch = rawJoined[i];
    const next = rawJoined[i + 1] ?? '';

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        pushLine();
      } else {
        buf += ch;
      }
      continue;
    }
    if (inBlockComment) {
      buf += ch;
      if (ch === '*' && next === '/') {
        buf += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }
    if (inSingle || inDouble || inTemplate) {
      buf += ch;
      if (ch === '\\' && i + 1 < rawJoined.length) {
        buf += rawJoined[i + 1];
        i += 1;
      } else if (inSingle && ch === "'") {
        inSingle = false;
      } else if (inDouble && ch === '"') {
        inDouble = false;
      } else if (inTemplate && ch === '`') {
        inTemplate = false;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      buf += '//';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      buf += '/*';
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      buf += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      buf += ch;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      buf += ch;
      continue;
    }

    if (ch === '(') {
      parenDepth += 1;
      buf += ch;
      continue;
    }
    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      buf += ch;
      continue;
    }

    if (ch === '\r') continue;

    if (ch === '\n') {
      // Preserve single preprocessor/import/comment line boundaries
      const t = buf.trim();
      if (t) {
        if (t.startsWith('#') || t.startsWith('@') || t.startsWith('import ') || t.startsWith('package ') || t.startsWith('//')) {
          pushLine();
        } else if (rawLines.length > 1 && !t.endsWith('{') && !t.endsWith(';') && !t.endsWith(',')) {
          // Keep existing newline if it's already multi-line formatted code
          pushLine();
        } else {
          buf += ' ';
        }
      }
      continue;
    }

    if (ch === '{') {
      // Check for array initializer like `new int[]{1, 2}` vs block
      const before = buf.trim();
      const restSlice = rawJoined.slice(i + 1);
      const closeIdx = restSlice.indexOf('}');
      const looksLikeInlineArrayInit =
        before.endsWith('=') ||
        before.endsWith('[]') ||
        before.endsWith('return') ||
        (closeIdx >= 0 && closeIdx <= 40 && !restSlice.slice(0, closeIdx).includes(';') && !restSlice.slice(0, closeIdx).includes('\n') && /[\w"']/.test(restSlice.slice(0, closeIdx)));

      if (looksLikeInlineArrayInit && closeIdx >= 0) {
        const inner = restSlice.slice(0, closeIdx);
        buf += `{${normalizeInlineDeclarationSpacing(inner.trim())}}`;
        i += closeIdx + 1;
        continue;
      }

      const trimmedBefore = buf.trim();
      buf = trimmedBefore ? `${trimmedBefore} {` : '{';
      pushLine();
      indent += 1;
      continue;
    }

    if (ch === '}') {
      if (buf.trim()) {
        pushLine();
      }
      indent = Math.max(0, indent - 1);
      // Look ahead for else / catch / finally / while / ;
      let k = i + 1;
      while (k < rawJoined.length && (rawJoined[k] === ' ' || rawJoined[k] === '\t' || rawJoined[k] === '\n')) {
        k += 1;
      }
      const tail = rawJoined.slice(k);
      if (tail.startsWith(';')) {
        outLines.push(`${'  '.repeat(indent)}};`);
        i = k;
      } else if (/^(?:else|catch|finally|while)\b/.test(tail)) {
        buf = '} ';
        i = k - 1;
      } else {
        outLines.push(`${'  '.repeat(indent)}}`);
      }
      continue;
    }

    if (ch === ';' && parenDepth === 0) {
      buf += ';';
      // Check if trailing inline comment on same line
      const sameLineRest = rawJoined.slice(i + 1).split('\n')[0];
      if (/^\s*\/\//.test(sameLineRest)) {
        buf += ' ';
      } else {
        pushLine();
      }
      continue;
    }

    if ((ch === ' ' || ch === '\t') && (buf.endsWith(' ') || buf.length === 0)) {
      continue;
    }
    buf += ch;
  }

  if (buf.trim()) {
    pushLine();
  }

  return outLines.join('\n').trim();
}

function formatPythonCode(code: string): string {
  const lines = dedentLines(code);
  return lines
    .map((line) => {
      const m = line.match(/^(\s*)(.*)$/);
      if (!m) return line;
      const spaces = m[1].replace(/\t/g, '    ').length;
      const normalizedIndent = ' '.repeat(Math.round(spaces / 2) * 2);
      return `${normalizedIndent}${normalizeInlineDeclarationSpacing(m[2].trim())}`;
    })
    .join('\n');
}

function formatSqlCode(code: string): string {
  const lines = dedentLines(code);
  if (lines.length === 1 && lines[0].length > 55) {
    return lines[0]
      .replace(/\s+(FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|JOIN|VALUES|SET)\b/gi, '\n$1')
      .trim();
  }
  return lines.join('\n');
}

export function formatCodeSnippet(code: string, langHint?: string): string {
  const lang = (langHint || detectCodeLanguage(code)).toLowerCase();
  if (lang === 'python' || lang === 'py') {
    return formatPythonCode(code);
  }
  if (lang === 'sql') {
    return formatSqlCode(code);
  }
  if (lang === 'json') {
    try {
      return JSON.stringify(JSON.parse(code.trim()), null, 2);
    } catch {
      return dedentLines(code).join('\n');
    }
  }
  if (BRACE_LANGS.has(lang)) {
    return formatBraceCode(code);
  }
  return dedentLines(code).join('\n');
}

const FENCE_RE = /```([a-zA-Z0-9_+#-]*)\s*\n?([\s\S]*?)```/g;

function looksLikeMultiStatementCode(block: string): boolean {
  const trimmed = block.trim();
  if (!trimmed) return false;
  const codeSignals = [
    /(?:public|private|protected)\s+(?:static\s+)?(?:class|interface|void|int|double|String|boolean)\b/,
    /^\s*#\s*include\s*<[^>]+>/m,
    /\b(?:System\.out\.println|printf|scanf|console\.log)\s*\(/,
    /\b(?:for|while|if)\s*\([^)]*\)\s*\{/,
    /^\s*(?:def\s+\w+\s*\([^)]*\)\s*:|class\s+\w+\s*:)/m,
    /^\s*(?:SELECT\s+.+?\s+FROM\s+\w+|CREATE\s+TABLE\s+\w+)/im,
    /\bfunction\s+\w+\s*\([^)]*\)\s*\{/,
    /\b(?:int|char|double|float|long|boolean|String|var|let|const)\s+[A-Za-z_]\w*(?:\s*\[[^\]]*\])?(?:\s*,\s*[A-Za-z_]\w*(?:\s*\[[^\]]*\])?)*\s*(?:=|;)/,
  ];
  let score = 0;
  for (const re of codeSignals) {
    if (re.test(trimmed)) score += 1;
  }
  if (score >= 2) return true;
  if (score === 1 && (trimmed.includes('{') || trimmed.includes(';') || trimmed.includes('\n'))) {
    return true;
  }
  return false;
}

function normalizeUnfencedCodeBlocks(text: string): string {
  // 1. Format short inline code expressions wrapped in Chinese quotes like `“int a[],b;”` -> `` `int a[], b;` ``
  let out = text.replace(
    /[“"']\s*((?:(?:public|private|static|const|let|var|int|long|double|float|char|boolean|String|void)\b|[A-Za-z_]\w*\s*(?:\+\+|--|\([^)]*\)))\s*[^“”"'\n]{2,60})\s*[”"']/g,
    (full, expr: string) => {
      const cleaned = expr.trim();
      if (/[\u4e00-\u9fa5]/.test(cleaned)) return full;
      if (!/[;(){}\[\]=+\-*/<>]/.test(cleaned)) return full;
      return `\`${normalizeInlineDeclarationSpacing(cleaned)}\``;
    }
  );

  // 2. If Chinese prompt is immediately followed by a full multi-statement code body on the same/next lines
  //    e.g. `阅读下面代码：public class A { ... }`
  const splitMatch = out.match(
    /^([\s\S]*?[\u4e00-\u9fa5][^:\n]*[：:？?。\s])\s*((?:#\s*include\b|(?:public|private|protected)\s+(?:static\s+)?class\b|class\s+\w+\s*\{|(?:int|void|double|String|def|function)\s+\w+\s*\()[\s\S]+)$/
  );
  if (splitMatch) {
    const prefix = splitMatch[1].trim();
    const candidateCode = splitMatch[2].trim();
    if (looksLikeMultiStatementCode(candidateCode)) {
      const lang = detectCodeLanguage(candidateCode);
      const formatted = formatCodeSnippet(candidateCode, lang);
      return `${prefix}\n\`\`\`${lang}\n${formatted}\n\`\`\``;
    }
  }

  // 3. If the entire text (or multi-line block) is predominantly unfenced multi-statement code
  const lines = out.split('\n');
  if (lines.length >= 2) {
    let startIdx = -1;
    let endIdx = -1;
    lines.forEach((line, idx) => {
      const t = line.trim();
      if (!t) return;
      const isCodeLine =
        /^(?:#\s*include\b|(?:public|private|protected)\b|(?:class|interface|struct|def|function)\s+\w+|(?:int|long|double|float|char|boolean|String|void|const|let|var)\s+\w+|for\s*\(|while\s*\(|if\s*\(|else\b|return\b|System\.out\.|printf\(|console\.log\(|[{}];?$|\/\/|\/\*)/.test(
          t
        ) ||
        (/^[A-Za-z0-9_\s()\[\]{}.,;:=+\-*/<>!&|"'`]+$/.test(t) && /[;{}()]/.test(t));
      if (isCodeLine) {
        if (startIdx === -1) startIdx = idx;
        endIdx = idx;
      }
    });
    if (startIdx >= 0 && endIdx > startIdx) {
      const codeSlice = lines.slice(startIdx, endIdx + 1).join('\n');
      if (looksLikeMultiStatementCode(codeSlice)) {
        const before = lines.slice(0, startIdx).join('\n').trim();
        const after = lines.slice(endIdx + 1).join('\n').trim();
        const lang = detectCodeLanguage(codeSlice);
        const formatted = formatCodeSnippet(codeSlice, lang);
        const parts: string[] = [];
        if (before) parts.push(before);
        parts.push(`\`\`\`${lang}\n${formatted}\n\`\`\``);
        if (after) parts.push(after);
        return parts.join('\n');
      }
    }
  } else if (looksLikeMultiStatementCode(out) && !/[\u4e00-\u9fa5]/.test(out)) {
    const lang = detectCodeLanguage(out);
    const formatted = formatCodeSnippet(out, lang);
    return `\`\`\`${lang}\n${formatted}\n\`\`\``;
  }

  // 4. Normalize existing inline backticks
  out = out.replace(/`([^`\n]{2,120})`/g, (_m, inner: string) => {
    if (/[\u4e00-\u9fa5]/.test(inner)) return `\`${inner}\``;
    return `\`${normalizeInlineDeclarationSpacing(inner.trim())}\``;
  });

  return out;
}

export function hasCodeContent(raw: string): boolean {
  if (!raw) return false;
  if (/```[\s\S]*?```/.test(raw) || /`[^`\n]+`/.test(raw)) return true;
  return looksLikeMultiStatementCode(raw);
}

export function normalizeCodeInText(raw: string): string {
  const input = (raw ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!input) return '';

  if (input.includes('```')) {
    const chunks: string[] = [];
    let lastIndex = 0;
    FENCE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = FENCE_RE.exec(input)) !== null) {
      const plainBefore = input.slice(lastIndex, m.index).trim();
      if (plainBefore) {
        chunks.push(plainBefore);
      }
      const rawLang = (m[1] || '').trim().toLowerCase();
      const rawCode = m[2] || '';
      const lang = rawLang || detectCodeLanguage(rawCode);
      const formatted = formatCodeSnippet(rawCode, lang);
      chunks.push(`\`\`\`${lang}\n${formatted}\n\`\`\``);
      lastIndex = FENCE_RE.lastIndex;
    }
    const plainAfter = input.slice(lastIndex).trim();
    if (plainAfter) {
      chunks.push(plainAfter);
    }
    return chunks.join('\n').trim();
  }

  return normalizeUnfencedCodeBlocks(input).trim();
}

export function parseRichSegments(raw: string): RichTextSegment[] {
  const normalized = normalizeCodeInText(raw);
  if (!normalized) return [];

  const segments: RichTextSegment[] = [];
  let lastIndex = 0;
  FENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;

  const pushInlineAndText = (textPart: string) => {
    if (!textPart) return;
    const inlineRe = /`([^`\n]+)`/g;
    let cursor = 0;
    let im: RegExpExecArray | null;
    while ((im = inlineRe.exec(textPart)) !== null) {
      if (im.index > cursor) {
        segments.push({ type: 'text', content: textPart.slice(cursor, im.index) });
      }
      segments.push({ type: 'inline', content: im[1] });
      cursor = inlineRe.lastIndex;
    }
    if (cursor < textPart.length) {
      segments.push({ type: 'text', content: textPart.slice(cursor) });
    }
  };

  while ((m = FENCE_RE.exec(normalized)) !== null) {
    if (m.index > lastIndex) {
      pushInlineAndText(normalized.slice(lastIndex, m.index).replace(/^\n+|\n+$/g, ''));
    }
    const lang = (m[1] || '').trim().toLowerCase() || detectCodeLanguage(m[2] || '');
    segments.push({
      type: 'code',
      lang,
      content: (m[2] || '').replace(/^\n+|\n+$/g, ''),
    });
    lastIndex = FENCE_RE.lastIndex;
  }

  if (lastIndex < normalized.length) {
    pushInlineAndText(normalized.slice(lastIndex).replace(/^\n+|\n+$/g, ''));
  }

  return segments.filter((s) => s.content.length > 0);
}
