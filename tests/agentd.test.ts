import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LineFramer,
  RpcErrorCode,
  encodeMessage,
  failure,
  notification,
  parseMessage,
  success,
} from '../agentd/src/protocol.ts';
import { DaemonHarness, startMockProvider } from './support/daemonHarness.ts';
import { buildHeaders, chatEndpoint, extractToolDeltas, normalizeUsage, parseRetryAfterMs, streamChat, textOf } from '../agentd/src/chatStream.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Polls an async condition; `DaemonHarness.waitFor` only takes sync predicates. */
async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/* ------------------------------------------------------------------ framing */

test('LineFramer reassembles messages split across chunks', () => {
  const framer = new LineFramer();
  // A chunk with no newline yields nothing yet.
  assert.deepEqual(framer.push('{"a":1}'), []);
  // An incomplete second line is held back, not emitted.
  assert.deepEqual(framer.push('\n{"b"'), ['{"a":1}']);
  assert.deepEqual(framer.push(':2}\n'), ['{"b":2}']);
  // CRLF from a Windows peer is tolerated.
  assert.deepEqual(framer.push('{"c":3}\r\n'), ['{"c":3}']);
  // Several messages in one chunk are all returned.
  assert.deepEqual(framer.push('{"d":4}\n{"e":5}\n'), ['{"d":4}', '{"e":5}']);
  assert.equal(framer.flush(), null);
});

test('LineFramer exposes an unterminated trailing line', () => {
  const framer = new LineFramer();
  assert.deepEqual(framer.push('partial'), []);
  assert.equal(framer.flush(), 'partial');
  assert.equal(framer.flush(), null);
});

/* ----------------------------------------------------------------- protocol */

test('parseMessage distinguishes requests, notifications and responses', () => {
  const request = parseMessage('{"jsonrpc":"2.0","id":1,"method":"llm.stream","params":{"a":1}}');
  assert.equal(request && 'method' in request && 'id' in request, true);

  const note = parseMessage('{"jsonrpc":"2.0","method":"stream.llm","params":{"x":1}}');
  assert.equal(note && 'method' in note && !('id' in note), true);

  const ok = parseMessage('{"jsonrpc":"2.0","id":1,"result":{"accepted":true}}');
  assert.deepEqual(ok, { jsonrpc: '2.0', id: 1, result: { accepted: true } });

  const err = parseMessage('{"jsonrpc":"2.0","id":2,"error":{"code":-32601,"message":"nope"}}');
  assert.equal(err && 'error' in err && err.error.message, 'nope');

  assert.equal(parseMessage('   '), null);
  assert.throws(() => parseMessage('{ not json'));
  assert.throws(() => parseMessage('{"jsonrpc":"2.0","id":1}'), /neither method, result nor error/);
});

test('encodeMessage stays single-line for payloads containing newlines', () => {
  const encoded = encodeMessage(
    notification('stream.llm', { requestId: 'r1', type: 'delta', content: 'a\nb\r\nc' }),
  );
  assert.equal(encoded.split('\n').length, 2, 'exactly one trailing newline');
  assert.equal(JSON.parse(encoded.trim()).params.content, 'a\nb\r\nc');
});

test('success and failure normalise undefined results', () => {
  assert.deepEqual(success(1, undefined), { jsonrpc: '2.0', id: 1, result: null });
  const err = failure(2, RpcErrorCode.MethodNotFound, 'x');
  assert.equal(err.error.code, -32601);
  assert.equal('data' in err.error, false);
});

/* ------------------------------------------------------------- chat helpers */

test('chatEndpoint derives the completions path from any base form', () => {
  assert.equal(chatEndpoint('http://x/v1'), 'http://x/v1/chat/completions');
  assert.equal(chatEndpoint('http://x/v1/'), 'http://x/v1/chat/completions');
  assert.equal(chatEndpoint('http://x/v1/chat/completions'), 'http://x/v1/chat/completions');
  assert.equal(chatEndpoint('http://x/v1/completions'), 'http://x/v1/chat/completions');
  assert.throws(() => chatEndpoint('ftp://x/v1'), /http or https/);
  assert.throws(() => chatEndpoint(''), /empty/);
});

test('chatEndpoint preserves a query string instead of splicing into it', () => {
  // Regression: `base + '/chat/completions'` turned this into
  // "…/v1?api-version=1/chat/completions" — path glued onto the query value.
  assert.equal(
    chatEndpoint('http://x/v1?api-version=1'),
    'http://x/v1/chat/completions?api-version=1',
  );
  assert.equal(
    chatEndpoint('https://gateway.test/openai/deployments/gpt?api-version=2024-02-01'),
    'https://gateway.test/openai/deployments/gpt/chat/completions?api-version=2024-02-01',
  );
  // Already-complete URLs keep their query too.
  assert.equal(
    chatEndpoint('http://x/v1/chat/completions?k=v'),
    'http://x/v1/chat/completions?k=v',
  );
});

test('buildHeaders lets a custom Authorization override the key', () => {
  const base = buildHeaders('secret', undefined, 'application/json');
  assert.equal(base.Authorization, 'Bearer secret');

  const overridden = buildHeaders('secret', { authorization: 'Custom x' }, 'application/json');
  // Exactly one auth header, under the canonical name — a second `authorization`
  // entry would let a case-sensitive server read the stale bearer token.
  const authKeys = Object.keys(overridden).filter((key) => key.toLowerCase() === 'authorization');
  assert.deepEqual(authKeys, ['Authorization']);
  assert.equal(overridden.Authorization, 'Custom x');

  // Non-auth custom headers pass through untouched.
  const extra = buildHeaders('secret', { 'X-Trace': '1' }, 'application/json');
  assert.equal(extra['X-Trace'], '1');
  assert.equal(extra.Authorization, 'Bearer secret');
});

test('normalizeUsage accepts snake_case, camelCase and cost', () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }), {
    promptTokens: 1,
    completionTokens: 2,
    totalTokens: 3,
    cost: undefined,
  });
  assert.deepEqual(normalizeUsage({ promptTokens: 4, total_cost: 0.5 }), {
    promptTokens: 4,
    completionTokens: undefined,
    totalTokens: undefined,
    cost: 0.5,
  });
  assert.equal(normalizeUsage({ unrelated: true }), undefined);
  assert.equal(normalizeUsage(null), undefined);
});

test('extractToolDeltas handles modern and legacy shapes', () => {
  const modern = extractToolDeltas({
    tool_calls: [{ index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"a"' } }],
  });
  assert.deepEqual(modern, [{ index: 0, id: 'c1', name: 'read_file', arguments: '{"a"' }]);

  const legacy = extractToolDeltas({ function_call: { name: 'old', arguments: '{}' } });
  assert.deepEqual(legacy, [{ index: 0, name: 'old', arguments: '{}' }]);

  assert.equal(extractToolDeltas({}), undefined);
});

test('textOf reads strings, part arrays and objects', () => {
  assert.equal(textOf('plain'), 'plain');
  assert.equal(textOf([{ type: 'text', text: 'a' }, 'b', { content: 'c' }]), 'abc');
  assert.equal(textOf({ text: 'obj' }), 'obj');
  assert.equal(textOf(null), '');
});

test('parseRetryAfterMs honours seconds, dates and caps', () => {
  assert.equal(parseRetryAfterMs('2'), 2000);
  assert.equal(parseRetryAfterMs('0'), null);
  assert.equal(parseRetryAfterMs('-5'), null);
  assert.equal(parseRetryAfterMs('99999'), 15_000, 'capped');
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs('not-a-date'), null);
  const future = new Date(Date.now() + 3000).toUTCString();
  const parsed = parseRetryAfterMs(future);
  assert.ok(parsed !== null && parsed > 0 && parsed <= 15_000);
});

/* ------------------------------------------- streaming against a real server */

test('streamChat emits deltas then exactly one done', async () => {
  const provider = await startMockProvider('?content=Hel,lo&usage=1');
  try {
    const events: any[] = [];
    await streamChat(
      {
        baseUrl: provider.baseUrl,
        model: 'mock-large',
        messages: [{ role: 'user', content: 'hi' }],
      },
      { signal: new AbortController().signal, onEvent: (event) => events.push(event) },
    );
    const deltas = events.filter((event) => event.type === 'delta');
    assert.equal(deltas.map((event) => event.content).join(''), 'Hello');
    assert.equal(events.filter((event) => event.type === 'done').length, 1, 'exactly one done');
    assert.equal(events.filter((event) => event.type === 'error').length, 0);
    assert.equal(events.at(-1).type, 'done');
    assert.equal(events.at(-1).finishReason, 'stop');
  } finally {
    provider.stop();
  }
});

test('streamChat surfaces an HTTP failure as a single error', async () => {
  const provider = await startMockProvider('?status=500');
  try {
    const events: any[] = [];
    await streamChat(
      { baseUrl: provider.baseUrl, model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { signal: new AbortController().signal, onEvent: (event) => events.push(event) },
    );
    assert.equal(events.filter((event) => event.type === 'done').length, 0);
    const errors = events.filter((event) => event.type === 'error');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /HTTP 500/);
  } finally {
    provider.stop();
  }
});

test('streamChat reports a user abort as aborted, not as a failure', async () => {
  const provider = await startMockProvider('?content=a,b,c');
  try {
    const controller = new AbortController();
    const events: any[] = [];
    const done = streamChat(
      { baseUrl: provider.baseUrl, model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      { signal: controller.signal, onEvent: (event) => events.push(event) },
    );
    controller.abort();
    await done;
    const errors = events.filter((event) => event.type === 'error');
    assert.equal(errors.length, 1);
    assert.equal(errors[0].aborted, true);
  } finally {
    provider.stop();
  }
});

test('streamChat times out a provider that never finishes', async () => {
  const provider = await startMockProvider('?stall=1');
  try {
    const events: any[] = [];
    await streamChat(
      { baseUrl: provider.baseUrl, model: 'm', messages: [{ role: 'user', content: 'hi' }] },
      {
        signal: new AbortController().signal,
        onEvent: (event) => events.push(event),
        timeouts: { idleMs: 300 },
      },
    );
    const errors = events.filter((event) => event.type === 'error');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /stopped streaming/);
  } finally {
    provider.stop();
  }
});

/* ----------------------------------------------------- daemon over real stdio */

test('daemon answers llm.fetchModels over stdio', async () => {
  const provider = await startMockProvider();
  const daemon = new DaemonHarness();
  try {
    await daemon.start();
    const result = await daemon.call('llm.fetchModels', { baseUrl: provider.baseUrl });
    assert.deepEqual(result.models, ['mock-large', 'mock-small']);
  } finally {
    daemon.close();
    provider.stop();
  }
});

test('daemon rejects an unknown method without dying', async () => {
  const daemon = new DaemonHarness();
  try {
    await daemon.start();
    await assert.rejects(() => daemon.call('nope.nothing'), /Unknown method/);
    // Still alive and serving.
    const status = await daemon.call('llm.status');
    assert.equal(typeof status.active, 'number');
  } finally {
    daemon.close();
  }
});

test('daemon streams a completion as notifications ending in done', async () => {
  const provider = await startMockProvider('?content=Al,pha&usage=1');
  const daemon = new DaemonHarness();
  try {
    await daemon.start();
    const ack = await daemon.call('llm.stream', {
      requestId: 'r1',
      baseUrl: provider.baseUrl,
      model: 'mock-large',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.deepEqual(ack, { accepted: true, requestId: 'r1' });

    await daemon.waitFor(
      () =>
        daemon.notifications('stream.llm').some((entry) => entry.params.type === 'done'),
      15_000,
      'stream completion',
    );
    const events = daemon.notifications('stream.llm').map((entry) => entry.params);
    assert.deepEqual(
      events.filter((event) => event.type === 'delta').map((event) => event.content).join(''),
      'Alpha',
    );
    const terminals = events.filter((event) => event.type === 'done' || event.type === 'error');
    assert.equal(terminals.length, 1, 'exactly one terminal event');
    assert.equal(terminals[0].type, 'done');
    assert.deepEqual(terminals[0].usage, { promptTokens: 7, completionTokens: 3, totalTokens: 10 });
    // Every event carries its own correlation key.
    assert.ok(events.every((event) => event.requestId === 'r1'));
  } finally {
    daemon.close();
    provider.stop();
  }
});

test('daemon streams two requests concurrently without cross-talk', async () => {
  const provider = await startMockProvider('?content=one');
  const daemon = new DaemonHarness();
  try {
    await daemon.start();
    // Both in flight at once: the daemon must not serialise or interleave them.
    daemon.callNoWait('llm.stream', {
      requestId: 'concurrent-A',
      baseUrl: provider.baseUrl,
      model: 'mock-large',
      messages: [{ role: 'user', content: 'A' }],
    });
    daemon.callNoWait('llm.stream', {
      requestId: 'concurrent-B',
      baseUrl: provider.baseUrl,
      model: 'mock-large',
      messages: [{ role: 'user', content: 'B' }],
    });

    await daemon.waitFor(() => {
      const done = daemon
        .notifications('stream.llm')
        .filter((entry) => entry.params.type === 'done')
        .map((entry) => entry.params.requestId);
      return done.includes('concurrent-A') && done.includes('concurrent-B');
    }, 20_000, 'both streams to finish');

    const ids = new Set(
      daemon.notifications('stream.llm').map((entry) => entry.params.requestId),
    );
    assert.deepEqual([...ids].sort(), ['concurrent-A', 'concurrent-B']);
    // Each stream terminated exactly once.
    for (const id of ['concurrent-A', 'concurrent-B']) {
      const terminals = daemon
        .notifications('stream.llm')
        .filter(
          (entry) =>
            entry.params.requestId === id &&
            (entry.params.type === 'done' || entry.params.type === 'error'),
        );
      assert.equal(terminals.length, 1, `${id} must terminate once`);
    }
  } finally {
    daemon.close();
    provider.stop();
  }
});

test('daemon aborts one stream without disturbing another', async () => {
  const provider = await startMockProvider('?stall=1');
  const daemon = new DaemonHarness();
  try {
    await daemon.start();
    daemon.callNoWait('llm.stream', {
      requestId: 'abort-me',
      baseUrl: provider.baseUrl,
      model: 'mock-large',
      messages: [{ role: 'user', content: 'x' }],
    });
    daemon.callNoWait('llm.stream', {
      requestId: 'abort-me-too',
      baseUrl: provider.baseUrl,
      model: 'mock-large',
      messages: [{ role: 'user', content: 'y' }],
    });
    // Wait until both are registered before aborting one.
    await waitUntil(async () => (await daemon.call('llm.status')).active >= 2, 10_000, 'two active streams');

    const aborted = await daemon.call('llm.abort', { requestId: 'abort-me' });
    assert.equal(aborted.aborted, true);

    await daemon.waitFor(
      () =>
        daemon
          .notifications('stream.llm')
          .some((entry) => entry.params.requestId === 'abort-me' && entry.params.type === 'error'),
      10_000,
      'aborted stream to report',
    );

    // The other stream is untouched and still active.
    const status = await daemon.call('llm.status');
    assert.equal(status.active, 1, 'only the non-aborted stream remains');
    assert.equal(
      daemon
        .notifications('stream.llm')
        .some((entry) => entry.params.requestId === 'abort-me-too' && entry.params.type === 'error'),
      false,
      'aborting one stream must not fail the other',
    );
  } finally {
    daemon.close();
    provider.stop();
  }
});

test('daemon rejects a duplicate concurrent request id', async () => {
  const provider = await startMockProvider('?stall=1');
  const daemon = new DaemonHarness();
  try {
    await daemon.start();
    const params = {
      requestId: 'dup',
      baseUrl: provider.baseUrl,
      model: 'mock-large',
      messages: [{ role: 'user', content: 'x' }],
    };
    await daemon.call('llm.stream', params);
    await assert.rejects(() => daemon.call('llm.stream', params), /already streaming/);
  } finally {
    daemon.close();
    provider.stop();
  }
});

test('daemon reports a stream error as one terminal notification', async () => {
  const provider = await startMockProvider('?status=400');
  const daemon = new DaemonHarness();
  try {
    await daemon.start();
    await daemon.call('llm.stream', {
      requestId: 'r-fail',
      baseUrl: provider.baseUrl,
      model: 'mock-large',
      messages: [{ role: 'user', content: 'x' }],
    });
    await daemon.waitFor(
      () =>
        daemon
          .notifications('stream.llm')
          .some((entry) => entry.params.type === 'error'),
      15_000,
      'stream error',
    );
    const events = daemon.notifications('stream.llm').map((entry) => entry.params);
    assert.equal(events.filter((event) => event.type === 'error').length, 1);
    assert.equal(events.filter((event) => event.type === 'done').length, 0);
    assert.match(events.find((event) => event.type === 'error').message, /HTTP 400/);
  } finally {
    daemon.close();
    provider.stop();
  }
});

test('daemon cancels in-flight work when the client disconnects', async () => {
  const provider = await startMockProvider('?stall=1');
  const daemon = new DaemonHarness();
  try {
    await daemon.start();
    await daemon.call('llm.stream', {
      requestId: 'orphan',
      baseUrl: provider.baseUrl,
      model: 'mock-large',
      messages: [{ role: 'user', content: 'x' }],
    });
    const status = await daemon.call('llm.status');
    assert.equal(status.active, 1);
    daemon.close();
    // The child must exit rather than leak with a stalled provider attached.
    await new Promise((resolve) => setTimeout(resolve, 800));
  } finally {
    daemon.close();
    provider.stop();
  }
});

/* ------------------------------------------------------------ boundary checks */

test('the daemon entry never imports electron', () => {
  for (const file of ['main.ts', 'server.ts', 'protocol.ts', 'llmService.ts', 'chatStream.ts']) {
    const source = readFileSync(path.join(here, '..', 'agentd', 'src', file), 'utf8');
    assert.doesNotMatch(
      source,
      /from\s*['"]electron['"]|require\(\s*['"]electron['"]\s*\)/,
      `${file} must stay Electron-free`,
    );
  }
});
