import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAcpUsage } from '../electron/acpClient.ts';

test('parses prompt/completion token usage', () => {
  assert.deepEqual(parseAcpUsage({ usage: { promptTokens: 120, completionTokens: 80 } }), {
    inputTokens: 120,
    outputTokens: 80,
    totalTokens: 200,
  });
});

test('parses camelCase ACP usage', () => {
  assert.deepEqual(parseAcpUsage({ tokenUsage: { inputTokens: 10, outputTokens: 5 } }), {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  });
});

test('parses usageMetadata totals', () => {
  assert.deepEqual(parseAcpUsage({ usageMetadata: { totalTokens: 42 } }), {
    inputTokens: undefined,
    outputTokens: undefined,
    totalTokens: 42,
  });
});

test('returns undefined when the agent reports no usage', () => {
  assert.equal(parseAcpUsage({ stopReason: 'end_turn' }), undefined);
  assert.equal(parseAcpUsage({}), undefined);
});
