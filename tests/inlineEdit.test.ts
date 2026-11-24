import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeInlineOutput,
  stripCodeFences,
  stripReasoning,
  validateInlineOutput,
} from '../src/lib/inlineValidation.ts';

// ---------------------------------------------------------------------------
// stripReasoning
// ---------------------------------------------------------------------------

test('strips a complete think block', () => {
  const raw = 'const a = 1;\n<thinking>const secret;</thinking>\nconst c = 3;';
  assert.equal(stripReasoning(raw), 'const a = 1;\n\nconst c = 3;');
});

test('strips complete thinking and reasoning blocks', () => {
  assert.equal(stripReasoning('left<thinking>hidden</thinking>right'), 'leftright');
  assert.equal(stripReasoning('left<reasoning>hidden</reasoning>right'), 'leftright');
  assert.equal(stripReasoning('left<THINK>hidden</THINK>right'), 'leftright');
});

test('strips an unclosed think block to the end of the text', () => {
  const raw = 'const a = 1;\n<thinking>secret';
  assert.equal(stripReasoning(raw), 'const a = 1;\n');
  assert.equal(sanitizeInlineOutput(raw), 'const a = 1;');
  assert.equal(stripReasoning('<thinking>no close'), '');
});

test('strips complete and unclosed rewrite_this blocks', () => {
  assert.equal(stripReasoning('<rewrite_this>const a = 1;</rewrite_this>'), '');
  assert.equal(stripReasoning('const a = 1;<rewrite_this>'), 'const a = 1;');
  assert.equal(stripReasoning('<REWRITE_THIS>hidden</REWRITE_THIS>ok'), 'ok');
});

test('strips stray reasoning open/close tags', () => {
  assert.equal(stripReasoning('const a = 1;</rewrite_this>'), 'const a = 1;');
  assert.equal(stripReasoning('</thinking>const a = 1;'), 'const a = 1;');
  assert.equal(stripReasoning('const a = 1;</reasoning>'), 'const a = 1;');
});

test('strips <CURSOR> markers', () => {
  assert.equal(stripReasoning('const a = <CURSOR>1;'), 'const a = 1;');
  assert.equal(stripReasoning('const a = <cursor />1;'), 'const a = 1;');
  assert.equal(sanitizeInlineOutput('const a = <CURSOR>1;'), 'const a = 1;');
});

// ---------------------------------------------------------------------------
// stripCodeFences
// ---------------------------------------------------------------------------

test('strips a fenced block with a language tag', () => {
  assert.equal(stripCodeFences('```python\nprint(1)\n```'), 'print(1)');
});

test('strips a bare (language-less) fence', () => {
  assert.equal(stripCodeFences('```\nconst x = 1;\n```'), 'const x = 1;');
});

test('strips a fence surrounded by prose', () => {
  const raw = 'Here you go:\n```ts\nconst x = 1;\n```\nDone.';
  assert.equal(stripCodeFences(raw), 'const x = 1;');
});

test('leaves an unbalanced fence in place for validation to reject', () => {
  assert.equal(stripCodeFences('```python\nprint(1)'), '```python\nprint(1)');
});

// ---------------------------------------------------------------------------
// sanitizeInlineOutput
// ---------------------------------------------------------------------------

test('preserves indentation and interior blank lines', () => {
  const raw = '\n\n  def f():\n\n      return 1\n\n';
  assert.equal(sanitizeInlineOutput(raw), '  def f():\n\n      return 1');
});

test('preserves single-line leading indentation', () => {
  assert.equal(sanitizeInlineOutput('    return 1'), '    return 1');
});

test('normalises CRLF to LF', () => {
  assert.equal(sanitizeInlineOutput('a = 1\r\nb = 2\r\n'), 'a = 1\nb = 2');
});

test('strips reasoning and fences together', () => {
  const raw = '<thinking>thinking out loud</thinking>```python\nprint(1)\n```';
  assert.equal(sanitizeInlineOutput(raw), 'print(1)');
});

test('caps absurdly long output at 80k characters', () => {
  assert.equal(sanitizeInlineOutput('x'.repeat(90_000)).length, 80_000);
});

test('returns an empty string for whitespace-only output', () => {
  assert.equal(sanitizeInlineOutput('   \n\n'), '');
});

// ---------------------------------------------------------------------------
// validateInlineOutput — rejections
// ---------------------------------------------------------------------------

test('rejects empty output', () => {
  assert.equal(validateInlineOutput('x = 1', '').ok, false);
  assert.equal(validateInlineOutput('x = 1', '   \n\n').ok, false);
});

test('rejects git conflict markers', () => {
  const generated = 'x = 1\n<<<<<<< HEAD\ny = 2\n=======\nz = 3\n>>>>>>> branch';
  const result = validateInlineOutput('x = 1', generated);
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /conflict/i);
});

test('rejects leftover reasoning markup', () => {
  // Truncated / malformed tags survive stripReasoning and must be rejected.
  assert.equal(validateInlineOutput('x = 1', 'x = 2\n<thinking').ok, false);
  assert.equal(validateInlineOutput('x = 1', 'x = 2 // rewrite_this').ok, false);
  assert.equal(validateInlineOutput('x = 1', 'x = 2 </rewrite_this').ok, false);
});

test('rejects raw special tokens', () => {
  assert.equal(validateInlineOutput('x = 1', 'x = 2 <|endoftext|>').ok, false);
});

test('rejects leftover markdown fences', () => {
  assert.equal(validateInlineOutput('x = 1', 'x = 2\n```').ok, false);
});

test('rejects a no-change result', () => {
  const result = validateInlineOutput('a = 1\nb = 2\n', 'a = 1\nb = 2');
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /no change/i);
});

test('rejects a no-change result across CRLF/LF line endings', () => {
  assert.equal(validateInlineOutput('a = 1\r\nb = 2\r\n', 'a = 1\nb = 2').ok, false);
});

test('rejects a no-change result wrapped in fences', () => {
  assert.equal(validateInlineOutput('x = 1', '```\nx = 1\n```').ok, false);
});

test('rejects an introductory prose preamble on the first line', () => {
  const result = validateInlineOutput('x = 1', "Here's the updated code:\nx = 2");
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /prose/i);

  assert.equal(
    validateInlineOutput('x = 1', 'Sure, here is the new implementation:\nx = 2').ok,
    false,
  );
});

// ---------------------------------------------------------------------------
// validateInlineOutput — acceptance
// ---------------------------------------------------------------------------

test('accepts ordinary Python code after sanitising', () => {
  const original = 'def add(a, b):\n    return a + b\n';
  const generated = 'def add(a, b):\n    """Add two numbers."""\n    return a + b';
  const result = validateInlineOutput(original, generated);
  assert.equal(result.ok, true);
  assert.equal(result.code, generated);
});

test('accepts ordinary TypeScript code after sanitising', () => {
  const original = 'const double = (n: number) => {\n  return n * 2;\n};';
  const generated = 'const double = (n: number) => {\n  // Doubles the value.\n  return n * 2;\n};';
  const result = validateInlineOutput(original, generated);
  assert.equal(result.ok, true);
  assert.equal(result.code, generated);
});

test('accepts indented multi-line code unchanged after sanitising', () => {
  const code = 'def f():\n    x = 1\n\n    return x';
  assert.equal(sanitizeInlineOutput(code), code);
  assert.equal(validateInlineOutput('def f():\n    return 0', code).ok, true);
});

test('accepts fenced output and returns the fenced content', () => {
  const result = validateInlineOutput('x = 1', '```python\nx = 2\n```');
  assert.equal(result.ok, true);
  assert.equal(result.code, 'x = 2');
});

test('accepts output whose first line is legitimately not prose', () => {
  const generated = '// Here is the updated code path.\nconst x = 2;';
  const result = validateInlineOutput('const x = 1;', generated);
  assert.equal(result.ok, true);
  assert.equal(result.code, generated);
});

test('accepts reasoning-free code that merely mentions think in an identifier', () => {
  const generated = 'const thinkCount = 2;';
  const result = validateInlineOutput('const thinkCount = 1;', generated);
  assert.equal(result.ok, true);
  assert.equal(result.code, generated);
});
