/**
 * Canonical Vela Formatter (`vela fmt`)
 * Implements spec/34-style.md §2 formatting rules:
 *  - Two-space indentation, spaces never tabs
 *  - Opening brace on same line, closing brace on its own line
 *  - Rewrites standalone `and` / `or` / `not` to `&&` / `||` / `!`
 *  - Normalizes blank lines (max 1 consecutive blank line)
 *  - Normalizes operator spacing while preserving string literals and comments
 */

function normalizeCodeSegment(seg: string): string {
  // Rewrite keyword boolean ops outside identifiers
  let out = seg
    .replace(/\band\b/g, '&&')
    .replace(/\bor\b/g, '||')
    .replace(/\bnot\s+/g, '!');
  // Collapse accidental double spaces (not leading indent)
  out = out.replace(/ {2,}/g, ' ');
  return out;
}

function formatLinePreservingStrings(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#') || trimmed.startsWith('//')) {
    return trimmed;
  }

  let out = '';
  let buf = '';
  let i = 0;
  let inStr: '"' | "'" | null = null;

  const flushBuf = () => {
    if (buf.length > 0) {
      out += normalizeCodeSegment(buf);
      buf = '';
    }
  };

  while (i < trimmed.length) {
    const ch = trimmed[i];
    if (inStr) {
      out += ch;
      if (ch === '\\' && i + 1 < trimmed.length) {
        i++;
        out += trimmed[i];
      } else if (ch === inStr) {
        inStr = null;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      flushBuf();
      inStr = ch;
      out += ch;
      i++;
      continue;
    }

    if (ch === '#' && trimmed[i + 1] !== '!' && trimmed[i + 1] !== '[') {
      // Check if it's a hex color like #FFFFFF
      const next = trimmed[i + 1] || '';
      if (!/[0-9a-fA-F]/.test(next)) {
        flushBuf();
        const comment = trimmed.slice(i).trim();
        out = out.trimEnd() + (out.trimEnd().length > 0 ? '  ' : '') + comment;
        break;
      }
    }

    if (ch === '/' && trimmed[i + 1] === '/') {
      flushBuf();
      const comment = trimmed.slice(i).trim();
      out = out.trimEnd() + (out.trimEnd().length > 0 ? '  ' : '') + comment;
      break;
    }

    buf += ch;
    i++;
  }

  flushBuf();
  return out.trimEnd();
}

function countBraceDelta(line: string): { leadingCloses: number; netDelta: number } {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
    if (trimmed.startsWith('#[')) return { leadingCloses: 0, netDelta: 0 };
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return { leadingCloses: 0, netDelta: 0 };
  }

  let leadingCloses = 0;
  let countingLeading = true;
  let opens = 0;
  let closes = 0;
  let inStr: '"' | "'" | null = null;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (inStr) {
      if (ch === '\\') {
        i++;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      countingLeading = false;
      inStr = ch;
      continue;
    }
    if (ch === '/' && trimmed[i + 1] === '/') break;
    if (ch === '#' && trimmed[i + 1] !== '!' && trimmed[i + 1] !== '[' && !/[0-9a-fA-F]/.test(trimmed[i + 1] || '')) break;

    if (ch === '}') {
      closes++;
      if (countingLeading) leadingCloses++;
    } else if (ch === '{') {
      countingLeading = false;
      opens++;
    } else if (!/\s/.test(ch)) {
      countingLeading = false;
    }
  }

  return { leadingCloses, netDelta: opens - closes };
}

export function formatVela(source: string): string {
  const rawLines = source.replace(/\r\n/g, '\n').split('\n');
  const formatted: string[] = [];
  let indentLevel = 0;
  let prevWasBlank = true;

  for (const raw of rawLines) {
    const cleaned = formatLinePreservingStrings(raw);
    if (!cleaned) {
      if (!prevWasBlank && formatted.length > 0) {
        // Avoid blank line immediately after opening `{`
        const prev = formatted[formatted.length - 1];
        if (!prev.trimEnd().endsWith('{')) {
          formatted.push('');
          prevWasBlank = true;
        }
      }
      continue;
    }

    const { leadingCloses, netDelta } = countBraceDelta(cleaned);
    const lineIndent = Math.max(0, indentLevel - leadingCloses);

    // Avoid blank line right before closing `}`
    if (leadingCloses > 0 && formatted.length > 0 && formatted[formatted.length - 1] === '') {
      formatted.pop();
    }

    formatted.push(`${'  '.repeat(lineIndent)}${cleaned}`);
    indentLevel = Math.max(0, indentLevel + netDelta);
    prevWasBlank = false;
  }

  while (formatted.length > 0 && formatted[formatted.length - 1] === '') {
    formatted.pop();
  }

  return formatted.join('\n') + '\n';
}
