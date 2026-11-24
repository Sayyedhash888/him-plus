/**
 * Sanitising and validation helpers for inline-edit model output.
 *
 * Some models leak reasoning/control markup (e.g. ` thinking...</think>`,
 * `<rewrite_this>...</rewrite_this>`, special tokens) or Markdown fences into
 * the text they return. Applying that text verbatim corrupts the user's file,
 * so every inline-edit result is stripped of control markup and validated
 * before the editor is allowed to apply it.
 *
 * These helpers are intentionally pure and dependency-free so they can be
 * covered by the node:test suite.
 */

/** Tag names that models use for reasoning/control blocks, longest first. */
const REASONING_TAG_NAMES = ['thinking', 'think', 'reasoning', 'rewrite_this'] as const;
const REASONING_TAG_PATTERN = REASONING_TAG_NAMES.join('|');

const REASONING_OPEN_TAG_RE = new RegExp(`<(${REASONING_TAG_PATTERN})\\b[^>\\n]*>`, 'i');
const REASONING_STRAY_TAG_RE = new RegExp(`</?(?:${REASONING_TAG_PATTERN})\\b[^>\\n]*>`, 'gi');
const REASONING_LEFTOVER_RE = new RegExp(`</?(?:${REASONING_TAG_PATTERN})\\b`, 'i');
const REWRITE_WORD_RE = /\brewrite_this\b/i;
const CURSOR_MARKER_RE = /<CURSOR\s*\/?>/gi;
const SPECIAL_TOKEN_RE = /<\|[^|\n]*\|>/;
const CONFLICT_MARKER_RE = /^(?:<{7}|={7}|>{7})(?:[ \t]|$)/m;
const MARKDOWN_FENCE_RE = /```/;
const PROSE_PREAMBLE_RE =
  /^[\t ]*(?:here(?:'s|’s|\s+is)\b|below\s+is\b|sure\b|certainly\b|of\s+course\b|absolutely\b)[^\n]*\b(?:code|version|implementation|edit|change|update|diff|output|result)\b/i;

const MAX_INLINE_OUTPUT_CHARS = 80_000;

/**
 * Removes reasoning/control markup from model output.
 *
 * Complete `...`, `<thinking>...</thinking>`, `<reasoning>...</reasoning>` and
 * `<rewrite_this>...</rewrite_this>` blocks are removed (content and all).
 * Unclosed opening tags are treated as reasoning and cut off to the end of the
 * text. Stray open/close tags left behind and `<CURSOR>` markers are removed.
 */
export function stripReasoning(text: string): string {
  if (!text) return '';
  let out = text.replace(CURSOR_MARKER_RE, '');

  // Each iteration removes one block, so this always terminates.
  for (;;) {
    const open = REASONING_OPEN_TAG_RE.exec(out);
    if (!open) break;
    const tagName = open[1].toLowerCase();
    const afterOpen = out.slice(open.index + open[0].length);
    const close = new RegExp(`</${tagName}\\s*>`, 'i').exec(afterOpen);
    if (!close) {
      // Unclosed reasoning block: everything after the tag is reasoning.
      out = out.slice(0, open.index);
      break;
    }
    out = out.slice(0, open.index) + afterOpen.slice(close.index + close[0].length);
  }

  return out.replace(REASONING_STRAY_TAG_RE, '');
}

/**
 * Removes a complete Markdown code fence (with or without a language tag).
 * Content before the opening fence and after the closing fence is discarded.
 * An unbalanced fence is left untouched so `validateInlineOutput` can reject it
 * instead of applying possibly truncated code.
 */
export function stripCodeFences(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const openIndex = lines.findIndex((line) => /^[\t ]*```/.test(line));
  if (openIndex === -1) return normalized;

  let closeIndex = -1;
  for (let index = openIndex + 1; index < lines.length; index += 1) {
    if (/^[\t ]*```[\t ]*$/.test(lines[index])) {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex === -1) return normalized;

  return lines.slice(openIndex + 1, closeIndex).join('\n');
}

/**
 * Normalises raw model output into candidate code: strips reasoning markup and
 * fences, normalises line endings, trims only leading/trailing blank lines
 * (indentation is preserved) and caps absurdly long output.
 */
export function sanitizeInlineOutput(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\r\n?/g, '\n');
  text = stripReasoning(text);
  text = stripCodeFences(text);
  text = text.replace(/^(?:[ \t]*\n)+/, '');
  text = text.replace(/(?:\n[ \t]*)+$/, '');
  if (!text.trim()) return '';
  if (text.length > MAX_INLINE_OUTPUT_CHARS) {
    text = text.slice(0, MAX_INLINE_OUTPUT_CHARS).replace(/(?:\n[ \t]*)+$/, '');
  }
  return text;
}

export interface InlineValidationResult {
  ok: boolean;
  code: string;
  reason?: string;
}

/**
 * Sanitises model output and decides whether it is safe to apply.
 *
 * `code` is the sanitised text; callers must only apply it when `ok` is true
 * (and `inline.ts` throws instead of returning it when it is not).
 */
export function validateInlineOutput(original: string, generated: string): InlineValidationResult {
  const code = sanitizeInlineOutput(generated);

  if (!code.trim()) {
    return { ok: false, code, reason: 'empty output' };
  }
  if (REASONING_LEFTOVER_RE.test(code) || REWRITE_WORD_RE.test(code)) {
    return { ok: false, code, reason: 'reasoning markup left in output' };
  }
  if (SPECIAL_TOKEN_RE.test(code)) {
    return { ok: false, code, reason: 'special token left in output' };
  }
  if (CONFLICT_MARKER_RE.test(code)) {
    return { ok: false, code, reason: 'git conflict markers' };
  }
  if (MARKDOWN_FENCE_RE.test(code)) {
    return { ok: false, code, reason: 'markdown code fence left in output' };
  }

  const normalizedOriginal = original.replace(/\r\n?/g, '\n');
  if (code.trim() === normalizedOriginal.trim()) {
    return { ok: false, code, reason: 'no change' };
  }

  const firstLine = code.split('\n', 1)[0] ?? '';
  if (PROSE_PREAMBLE_RE.test(firstLine)) {
    return { ok: false, code, reason: 'prose preamble' };
  }

  return { ok: true, code };
}
