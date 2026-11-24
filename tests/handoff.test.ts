import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoffPrompt } from '../src/lib/agent/handoff.ts';

test('handoff prompt includes request, untrusted summary, files, checkpoint and task', () => {
  const prompt = buildHandoffPrompt({
    sourceTitle: 'Feature agent',
    request: 'Add pagination to the table',
    summary: 'Implemented pagination and tests.',
    changedPaths: ['src/table.tsx', 'tests/table.test.ts'],
    checkpointLabel: 'Handoff before review',
    instruction: 'Review for regressions.',
  });
  assert.match(prompt, /Agent handoff for review/);
  assert.match(prompt, /Add pagination to the table/);
  assert.match(prompt, /untrusted — verify it yourself/);
  assert.match(prompt, /- src\/table\.tsx/);
  assert.match(prompt, /Handoff before review/);
  assert.match(prompt, /Review for regressions/);
  assert.match(prompt, /verdict, blocking issues/);
});

test('handoff prompt has safe defaults for missing data', () => {
  const prompt = buildHandoffPrompt({
    sourceTitle: 'Empty agent',
    changedPaths: [],
    instruction: '',
  });
  assert.match(prompt, /no recorded user request/);
  assert.match(prompt, /no summary/);
  assert.match(prompt, /no file changes recorded/);
  assert.match(prompt, /No checkpoint was created/);
  assert.match(prompt, /Review the work for correctness/);
});
