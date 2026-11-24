import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSession,
  deriveTitle,
  describeSubagents,
  findSession,
  normalizeSessions,
  subagentReport,
  subagentTaskPrompt,
} from '../vscode-extension/src/sessions.ts';

test('creates sessions with derived titles and bounded history', () => {
  const session = createSession(
    [
      { role: 'user', content: 'Fix the failing test in auth.spec.ts please' },
      { role: 'assistant', content: 'Working on it.' },
    ],
    undefined,
    1000,
  );
  assert.equal(session.title, 'Fix the failing test in auth.spec.ts please');
  assert.equal(session.history.length, 2);
  assert.equal(session.createdAt, 1000);
});

test('derives a fallback title and truncates long prompts', () => {
  assert.equal(deriveTitle([]), 'New chat');
  const long = 'x'.repeat(80);
  assert.ok(deriveTitle([{ role: 'user', content: long }]).endsWith('…'));
});

test('normalizes persisted sessions and keeps a valid active id', () => {
  const a = createSession([{ role: 'user', content: 'first' }], 'First');
  const b = createSession([{ role: 'user', content: 'second' }], 'Second');
  const stored = normalizeSessions({ activeId: b.id, sessions: [a, b] });
  assert.equal(stored.sessions.length, 2);
  assert.equal(stored.activeId, b.id);
  assert.equal(findSession(stored.sessions, a.id)?.title, 'First');
});

test('falls back to the legacy single transcript', () => {
  const stored = normalizeSessions(null, [
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: 'old answer' },
  ]);
  assert.equal(stored.sessions.length, 1);
  assert.equal(stored.sessions[0].history.length, 2);
  assert.equal(stored.activeId, stored.sessions[0].id);
});

test('rejects malformed persisted data', () => {
  const stored = normalizeSessions({ activeId: 'missing', sessions: 'nope' });
  assert.equal(stored.sessions.length, 1);
  assert.equal(stored.activeId, stored.sessions[0].id);
});

test('builds the subagent prompt and report', () => {
  const prompt = subagentTaskPrompt('Find all TODO comments', 'todos');
  assert.match(prompt, /background helper agent/);
  assert.match(prompt, /“todos”/);
  assert.match(prompt, /Find all TODO comments/);
  assert.match(prompt, /Do not delegate/);
  assert.match(subagentReport('todos', 'Found 3 TODOs'), /Background subagent “todos” finished/);
});

test('describes running and finished subagents', () => {
  const text = describeSubagents([
    { id: 'sub-1', label: 'scan', status: 'running', startedAt: 1 },
    { id: 'sub-2', label: 'review', status: 'done', result: 'LGTM', startedAt: 2 },
  ]);
  assert.match(text, /sub-1 “scan”: running/);
  assert.match(text, /sub-2 “review”: done/);
  assert.match(text, /LGTM/);
  assert.equal(describeSubagents([]), 'No subagents have been started in this session.');
});
