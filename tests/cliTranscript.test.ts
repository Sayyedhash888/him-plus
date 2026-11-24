import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSegmentsFromMessages,
  clipCliOutput,
  cliTranscriptChars,
  estimateTokens,
  shouldCompactCli,
} from '../src/lib/cliTranscript.ts';

test('estimates tokens from characters', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
});

test('rebuilds chat segments from persisted messages', () => {
  const segments = buildSegmentsFromMessages([
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'Hi there' },
    { role: 'user', content: 'second' },
    { role: 'assistant', content: 'reply' },
  ]);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].prompt, 'hello');
  assert.equal(segments[0].raw, 'Hi there');
  assert.equal(segments[1].prompt, 'second');
  assert.equal(segments[1].raw, 'reply');
});

test('handles compaction notes and assistant-first transcripts', () => {
  const segments = buildSegmentsFromMessages([
    { role: 'system', content: 'Earlier context compacted', compactionNote: true },
    { role: 'assistant', content: 'restored output' },
  ]);
  assert.match(segments[0].raw, /Earlier context compacted/);
  assert.match(segments[0].raw, /restored output/);
});

test('compaction threshold requires length and size', () => {
  const small = Array.from({ length: 10 }, () => ({ role: 'user' as const, content: 'x' }));
  assert.equal(shouldCompactCli(small), false);
  const big = Array.from({ length: 10 }, () => ({
    role: 'assistant' as const,
    content: 'y'.repeat(10_000),
  }));
  assert.equal(shouldCompactCli(big), true);
  assert.ok(cliTranscriptChars(big) > 90_000);
});

test('clipCliOutput keeps the newest tail', () => {
  const clipped = clipCliOutput('a'.repeat(20) + 'TAIL', 10);
  assert.ok(clipped.endsWith('TAIL'));
  assert.match(clipped, /chars of terminal output omitted/);
});
