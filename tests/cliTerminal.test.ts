import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendCliOutput, sanitizeCliOutput, stripAnsi } from '../src/lib/cliTerminal.ts';

test('strips ANSI colour and control sequences', () => {
  const raw = '\u001b[32m✓\u001b[0m done\u001b[2K';
  assert.equal(stripAnsi(raw), '✓ done');
  assert.equal(sanitizeCliOutput(raw), '✓ done');
});

test('collapses carriage-return progress redraws to the final frame', () => {
  assert.equal(sanitizeCliOutput('installing 10%\rinstalling 55%\rinstalled'), 'installed');
});

test('applies backspaces and removes stray control characters', () => {
  assert.equal(sanitizeCliOutput('abc\b\bd'), 'ad');
  assert.equal(sanitizeCliOutput('hello\u0007\u0000 world'), 'hello world');
});

test('preserves normal multi-line output and indentation', () => {
  const raw = 'line one\n  indented\n\nline four\n';
  assert.equal(sanitizeCliOutput(raw), 'line one\n  indented\n\nline four');
});

test('appendCliOutput keeps the newest tail under the cap', () => {
  const text = appendCliOutput('a'.repeat(30), 'b'.repeat(30), 40);
  assert.equal(text.length, 40);
  assert.ok(text.endsWith('b'.repeat(30)));
});
