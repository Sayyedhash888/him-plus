import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatCompletionsUrl,
  cleanCompletion,
  completionsUrl,
  resolveHimModel,
  trimSuffixOverlap,
  type HimConfig,
} from '../vscode-extension/src/himConfig.ts';

const config: HimConfig = {
  providers: [
    {
      id: 'p1',
      name: 'Mock',
      baseUrl: 'http://127.0.0.1:8999/v1',
      apiKey: 'key',
      headers: { 'X-Test': '1' },
      models: [
        { id: 'fast', enabled: true },
        { id: 'big', enabled: true },
        { id: 'off', enabled: false },
      ],
    },
  ],
  defaults: {
    primary: { providerId: 'p1', modelId: 'big' },
    fast: { providerId: 'p1', modelId: 'fast' },
    planning: null,
  },
  fim: {
    enabled: true,
    mode: 'fim',
    model: null,
  },
};

test('resolves an explicit enabled HIM+ model', () => {
  const resolved = resolveHimModel(config, { providerId: 'p1', modelId: 'big' }, 'fast');
  assert.equal(resolved?.provider.name, 'Mock');
  assert.equal(resolved?.model.id, 'big');
});

test('falls back from a disabled model to the requested default', () => {
  const resolved = resolveHimModel(config, { providerId: 'p1', modelId: 'off' }, 'fast');
  assert.equal(resolved?.model.id, 'fast');
});

test('builds OpenAI-compatible FIM and chat endpoints', () => {
  assert.equal(chatCompletionsUrl('http://x/v1'), 'http://x/v1/chat/completions');
  assert.equal(chatCompletionsUrl('http://x/v1/chat/completions'), 'http://x/v1/chat/completions');
  assert.equal(completionsUrl('http://x/v1/chat/completions'), 'http://x/v1/completions');
  assert.equal(completionsUrl('http://x/v1'), 'http://x/v1/completions');
});

test('strips markdown fences from completion output', () => {
  assert.equal(cleanCompletion('```python\nprint(1)\n```'), 'print(1)');
  assert.equal(cleanCompletion('  value  '), '  value  ');
});

test('removes already-present suffix text from a completion', () => {
  assert.equal(trimSuffixOverlap('return 42\n}\n', '\n}\nnext()'), 'return 42');
});