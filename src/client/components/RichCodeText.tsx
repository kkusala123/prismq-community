import React, { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { parseRichSegments } from '../../shared/codeFormatter.js';

interface RichCodeTextProps {
  text: string;
  className?: string;
  inline?: boolean;
  darkCodeBlock?: boolean;
}

const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:public|private|protected|static|final|class|interface|extends|implements|void|return|if|else|for|while|do|switch|case|break|continue|new|import|package|from|def|elif|pass|yield|async|await|function|const|let|var|struct|enum|SELECT|FROM|WHERE|GROUP|BY|ORDER|JOIN|LEFT|RIGHT|INNER|INSERT|INTO|UPDATE|SET|DELETE|CREATE|TABLE|int|long|double|float|char|boolean|bool|String|true|false|null|None|undefined)\b|\b\d+(?:\.\d+)?\b)/g;

function highlightCodeLine(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = TOKEN_RE.exec(line)) !== null) {
    if (m.index > cursor) {
      parts.push(line.slice(cursor, m.index));
    }
    const token = m[0];
    let cls = 'text-slate-100';
    if (token.startsWith('//') || token.startsWith('/*')) {
      cls = 'text-slate-400 italic';
    } else if (token.startsWith('"') || token.startsWith("'")) {
      cls = 'text-emerald-300';
    } else if (/^\d/.test(token)) {
      cls = 'text-amber-300';
    } else if (/^(?:true|false|null|None|undefined)$/.test(token)) {
      cls = 'text-orange-300';
    } else if (/^(?:int|long|double|float|char|boolean|bool|String|void)$/.test(token)) {
      cls = 'text-cyan-300';
    } else {
      cls = 'text-sky-300 font-semibold';
    }
    parts.push(
      <span key={k++} className={cls}>
        {token}
      </span>
    );
    cursor = TOKEN_RE.lastIndex;
  }
  if (cursor < line.length) {
    parts.push(line.slice(cursor));
  }
  return parts.length > 0 ? parts : line;
}

const CodeBlockView: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // ignore
    }
  };

  const lines = useMemo(() => code.split('\n'), [code]);

  return (
    <div
      data-no-swipe="1"
      onClick={(e) => e.stopPropagation()}
      className="my-2.5 overflow-hidden rounded-xl border border-slate-700/80 bg-[#0F172A] text-left text-slate-100 shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-900/90 px-3 py-1.5 text-[11px]">
        <span className="font-mono font-semibold uppercase tracking-wide text-slate-400">
          {lang && lang !== 'code' ? lang : 'code'}
        </span>
        <button
          type="button"
          onClick={(e) => void handleCopy(e)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" /> 已复制
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> 复制代码
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[12.5px] leading-[1.6] tabular-nums">
        <code>
          {lines.map((ln, idx) => (
            <div key={idx} className="min-h-[1.3em] whitespace-pre">
              {highlightCodeLine(ln)}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
};

export const RichCodeText: React.FC<RichCodeTextProps> = ({
  text,
  className = '',
  inline = false,
}) => {
  const segments = useMemo(() => parseRichSegments(text || ''), [text]);

  if (!text) return null;

  if (segments.length === 0) {
    return <span className={className}>{text}</span>;
  }

  const Wrapper = inline ? 'span' : 'div';
  return (
    <Wrapper className={`whitespace-pre-wrap break-words ${className}`}>
      {segments.map((seg, i) => {
        if (seg.type === 'code') {
          return <CodeBlockView key={i} code={seg.content} lang={seg.lang} />;
        }
        if (seg.type === 'inline') {
          return (
            <code
              key={i}
              className="mx-0.5 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[0.9em] font-semibold text-indigo-700"
            >
              {seg.content}
            </code>
          );
        }
        return <React.Fragment key={i}>{seg.content}</React.Fragment>;
      })}
    </Wrapper>
  );
};
