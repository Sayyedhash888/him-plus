import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configureAgentHost,
  getAgentHost,
  relativize,
  resetAgentHost,
  tryGetAgentHost,
} from '../src/lib/agent/host.ts';
import { InMemoryAgentHost, type ModelResolver } from '../src/lib/agent/memoryHost.ts';
import type { AgentSession, ChatEntry } from '../src/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The seam that lets the agent loop run outside the Electron renderer. These tests
 * pin the interface's contract: the narrow reads, the fire-and-forget writes, and
 * the invariants the loop depends on but the old store-based code left implicit.
 */

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    title: 'Session',
    status: 'idle',
    permission: 'auto',
    messages: [],
    changes: [],
    artifacts: [],
    terminalRuns: [],
    tokens: { input: 0, output: 0 },
    workspaceRoot: 'D:/projects/app',
    worktree: null,
    model: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeMessage(id: string, overrides: Partial<ChatEntry> = {}): ChatEntry {
  return {
    id,
    role: 'assistant',
    content: '',
    createdAt: 1,
    ...overrides,
  } as ChatEntry;
}

/* --------------------------------------------------------------- the registry */

test('getAgentHost throws before a host is configured', () => {
  resetAgentHost();
  assert.equal(tryGetAgentHost(), null);
  assert.throws(() => getAgentHost(), /has not been configured/);
});

test('configureAgentHost installs a host and resetAgentHost clears it', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  configureAgentHost(host);
  assert.equal(getAgentHost(), host);
  resetAgentHost();
  assert.equal(tryGetAgentHost(), null);
});

/* -------------------------------------------------------------- write contract */

test('writes are fire-and-forget: every mutation returns undefined', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  // The loop never consumes a mutation result, so a host is free to queue these.
  assert.equal(host.updateSession('s1', (s) => s), undefined);
  assert.equal(host.appendMessage('s1', makeMessage('m1')), undefined);
  assert.equal(host.patchMessage('s1', 'm1', { content: 'x' }), undefined);
  assert.equal(host.removeMessage('s1', 'm1'), undefined);
  assert.equal(host.setStatus('s1', 'running'), undefined);
  assert.equal(host.setPendingApproval('s1', null), undefined);
  assert.equal(host.addUsage('s1', { input: 1, output: 2 }), undefined);
  assert.equal(host.setToolCall('s1', 'm1', 'c1', { status: 'done' }), undefined);
});

test('mutating an unknown session is a no-op, not a resurrection', () => {
  const host = new InMemoryAgentHost();
  host.updateSession('ghost', (s) => ({ ...s, title: 'zombie' }));
  host.appendMessage('ghost', makeMessage('m1'));
  host.setStatus('ghost', 'error', 'boom');
  assert.equal(host.getSession('ghost'), null);
  assert.deepEqual(host.allSessions(), []);
});

test('setToolCall will not invent a message that does not exist', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.setToolCall('s1', 'missing-message', 'c1', { status: 'done' });
  assert.deepEqual(host.getSession('s1')?.messages, []);
  assert.equal(host.applied.length, 0, 'nothing should be recorded for a bad message id');
});

test('appendMessage, patchMessage and removeMessage behave in order', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.appendMessage('s1', makeMessage('m1', { content: 'a' }));
  host.patchMessage('s1', 'm1', { content: 'b' });
  assert.equal(host.getSession('s1')?.messages.length, 1);
  assert.equal(host.getSession('s1')?.messages[0].content, 'b');
  // Patching a non-existent message leaves the transcript untouched.
  host.patchMessage('s1', 'nope', { content: 'c' });
  assert.equal(host.getSession('s1')?.messages[0].content, 'b');
  host.removeMessage('s1', 'm1');
  assert.deepEqual(host.getSession('s1')?.messages, []);
});

test('setStatus carries the error alongside the status', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.setStatus('s1', 'error', 'provider exploded');
  assert.equal(host.getSession('s1')?.status, 'error');
  assert.equal(host.getSession('s1')?.error, 'provider exploded');
  // Omitting the error must not clear a previous one implicitly... it replaces
  // the status, so only an explicit '' should clear.
  host.setStatus('s1', 'running');
  assert.equal(host.getSession('s1')?.status, 'running');
});

test('setPendingApproval round-trips an approval request and its clear', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.setPendingApproval('s1', { messageId: 'm1', toolCallId: 'c1' });
  assert.deepEqual(host.getSession('s1')?.pendingApproval, { messageId: 'm1', toolCallId: 'c1' });
  host.setPendingApproval('s1', null);
  assert.equal(host.getSession('s1')?.pendingApproval, null);
});

test('addUsage accumulates tokens and cost across calls', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.addUsage('s1', { input: 10, output: 5, cost: 0.1 });
  host.addUsage('s1', { input: 2, output: 1, cost: 0.05 });
  const tokens = host.getSession('s1')?.tokens;
  assert.equal(tokens?.input, 12);
  assert.equal(tokens?.output, 6);
  assert.ok(Math.abs((tokens?.cost ?? 0) - 0.15) < 1e-9);
});

test('setToolCall patches only the matching call', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.appendMessage(
    's1',
    makeMessage('m1', {
      toolCalls: [
        { id: 'c1', name: 'read_file', status: 'running' },
        { id: 'c2', name: 'list_files', status: 'running' },
      ],
    } as Partial<ChatEntry>),
  );
  host.setToolCall('s1', 'm1', 'c2', { status: 'done' });
  const calls = host.getSession('s1')?.messages[0].toolCalls ?? [];
  assert.equal(calls.find((call) => call.id === 'c1')?.status, 'running');
  assert.equal(calls.find((call) => call.id === 'c2')?.status, 'done');
});

test('addChange replaces a change for the same path rather than duplicating', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.addChange('s1', { path: 'a.ts', status: 'pending' } as never);
  host.addChange('s1', { path: 'a.ts', status: 'applied' } as never);
  host.addChange('s1', { path: 'b.ts', status: 'pending' } as never);
  const changes = host.getSession('s1')?.changes ?? [];
  assert.equal(changes.length, 2);
  assert.equal(changes.find((change) => change.path === 'a.ts')?.status, 'applied');
});

test('upsertArtifact replaces by id and appends otherwise', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.upsertArtifact('s1', { id: 'a1', title: 'one' } as never);
  host.upsertArtifact('s1', { id: 'a1', title: 'one-updated' } as never);
  host.upsertArtifact('s1', { id: 'a2', title: 'two' } as never);
  const artifacts = host.getSession('s1')?.artifacts ?? [];
  assert.equal(artifacts.length, 2);
  assert.equal(artifacts.find((artifact) => artifact.id === 'a1')?.title, 'one-updated');
});

test('every mutation is recorded for later assertion', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  host.setStatus('s1', 'running');
  host.appendMessage('s1', makeMessage('m1'));
  assert.deepEqual(
    host.applied.map((entry) => entry.kind),
    ['setStatus', 'appendMessage'],
  );
});

/* --------------------------------------------------------- workspace context */

test('getWorkspaceContext withholds editor state for an unrelated workspace', () => {
  const host = new InMemoryAgentHost({
    workspace: {
      root: 'D:/projects/app',
      files: ['a.ts'],
      openTabs: ['a.ts'],
      activeFile: 'a.ts',
      branch: 'main',
    },
  });
  // Same workspace: editor state is meaningful.
  const mine = host.getWorkspaceContext('D:/projects/app');
  assert.deepEqual(mine.openTabs, ['a.ts']);
  assert.equal(mine.activeFile, 'a.ts');

  // A different workspace must not inherit another workspace's tabs.
  const other = host.getWorkspaceContext('D:/projects/other');
  assert.deepEqual(other.openTabs, []);
  assert.equal(other.activeFile, null);
  assert.equal(other.root, 'D:/projects/other');
  // The file map and platform are not workspace-specific UI state, so they remain.
  assert.deepEqual(other.files, ['a.ts']);
  assert.equal(other.branch, 'main');
});

test('getWorkspaceContext passes everything through when no root is set', () => {
  const host = new InMemoryAgentHost({ workspace: { openTabs: ['x.ts'], activeFile: 'x.ts' } });
  const context = host.getWorkspaceContext('D:/anything');
  assert.deepEqual(context.openTabs, ['x.ts']);
  assert.equal(context.activeFile, 'x.ts');
});

test('platform comes from the host, not from the renderer', () => {
  const host = new InMemoryAgentHost();
  assert.equal(host.getWorkspaceContext('D:/x').platform, process.platform);
});

test('requestSettings is recorded rather than opening a UI', () => {
  // The loop calls this when it cannot resolve a model. A headless host has no
  // dialog, so it must be observable instead of silently doing nothing.
  const host = new InMemoryAgentHost();
  assert.deepEqual(host.settingsRequests, []);
  host.requestSettings();
  host.requestSettings();
  assert.equal(host.settingsRequests.length, 2);
});

/* ------------------------------------------------------------------- effects */

test('a headless host records effects instead of performing them', () => {
  const host = new InMemoryAgentHost();
  host.bumpFs();
  host.refreshGit();
  host.refreshWorkspaceFiles();
  host.reloadFromDisk('D:/w/a.ts', true);
  host.setLastTerminal({ command: 'npm test', cwd: '.', output: 'ok', code: 0 });
  assert.deepEqual(
    host.effects.map((entry) => entry.kind),
    ['bumpFs', 'refreshGit', 'refreshWorkspaceFiles', 'reloadFromDisk', 'setLastTerminal'],
  );
  assert.equal(host.readLastTerminal()?.command, 'npm test');
});

test('a headless host separates "no diagnostics source" from "no problems"', () => {
  // This distinction is load-bearing: an empty list tells the model a broken file
  // is clean, so an absent capability must be reportable separately. The tool
  // checks that before it reports anything.
  const host = new InMemoryAgentHost();
  assert.equal(host.hasDiagnostics(), false, 'no source wired');
  assert.deepEqual(host.diagnostics(), [], 'still safe to call');

  host.diagnosticSource = () => [{ path: 'a.ts', severity: 'error', message: 'boom', line: 3 }];
  assert.equal(host.hasDiagnostics(), true);
  assert.deepEqual(host.diagnostics(), [
    { path: 'a.ts', severity: 'error', message: 'boom', line: 3 },
  ]);
});

test('notify captures user-facing messages instead of rendering them', () => {
  const host = new InMemoryAgentHost();
  host.notify('error', 'Model returned nothing', 'Agent failed');
  host.notify('info', 'Stopped.');
  assert.deepEqual(host.notifications, [
    { kind: 'error', message: 'Model returned nothing', title: 'Agent failed' },
    { kind: 'info', message: 'Stopped.', title: undefined },
  ]);
});

/* ------------------------------------------------- session lifecycle mutations */

test('setPermission updates only the target session', () => {
  const host = new InMemoryAgentHost({
    sessions: [makeSession({ id: 's1' }), makeSession({ id: 's2' })],
  });
  host.setPermission('s1', 'review');
  assert.equal(host.getSession('s1')?.permission, 'review');
  assert.equal(host.getSession('s2')?.permission, 'auto', 'sibling must be untouched');
});

test('maybeTitle only retitles a session still on its generated name', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession({ title: 'Agent 3' })] });
  host.maybeTitle('s1', '  Fix   the   build  ');
  // Whitespace is collapsed, and the title is capped at 52 characters.
  assert.equal(host.getSession('s1')?.title, 'Fix the build');

  // A session the user has already named keeps its name.
  const named = new InMemoryAgentHost({ sessions: [makeSession({ title: 'My session' })] });
  named.maybeTitle('s1', 'Something else');
  assert.equal(named.getSession('s1')?.title, 'My session');

  // Empty prompts do not produce an empty title.
  const blank = new InMemoryAgentHost({ sessions: [makeSession({ title: 'Agent 1' })] });
  blank.maybeTitle('s1', '   ');
  assert.equal(blank.getSession('s1')?.title, 'Agent 1');
});

test('maybeTitle caps a long prompt at 52 characters', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession({ title: 'Agent 1' })] });
  host.maybeTitle('s1', 'x'.repeat(200));
  assert.equal(host.getSession('s1')?.title.length, 52);
});

test('resetConversation clears the transcript and re-queues the session', () => {
  const host = new InMemoryAgentHost({
    sessions: [
      makeSession({
        status: 'error',
        error: 'boom',
        pendingApproval: { messageId: 'm1', toolCallId: 'c1' },
        tokens: { input: 5, output: 7 },
      }),
    ],
  });
  host.appendMessage('s1', makeMessage('m1'));
  host.resetConversation('s1');
  const session = host.getSession('s1')!;
  assert.deepEqual(session.messages, []);
  assert.equal(session.status, 'queued');
  assert.equal(session.error, undefined);
  assert.equal(session.pendingApproval, null);
  assert.deepEqual(session.tokens, { input: 0, output: 0 });
});

/* ------------------------------------------------------- store-bypass guard */

/**
 * Finds every store member the agent loop touches.
 *
 * Two access forms exist, and checking only the first would let the seam be
 * bypassed by capturing the state first:
 *
 *   useSessionStore.getState().setStatus(...)                        // direct
 *   const store = useSessionStore.getState(); store.setStatus(...)   // captured
 */
function findStoreAccess(source: string): Array<{ variable: string; member: string }> {
  const found: Array<{ variable: string; member: string }> = [];
  const direct =
    /use(?:Session|Core|Editor|Config)Store\s*\.\s*getState\(\)\s*(?:\r?\n\s*)?\.\s*([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(direct)) {
    found.push({ variable: '(direct)', member: match[1] });
  }

  // Capture form: the store snapshot must be the FINAL value assigned. A plain
  // lookahead is not enough, because the assignment itself may span lines:
  //   const profile = useConfigStore
  //     .getState()
  //     .config?.acpAgents.find(...)
  // so each candidate is confirmed by inspecting the character that follows the
  // match — a `.` means the getState() result was chained into, not captured.
  const capture =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*use(?:Session|Core|Editor|Config)Store\s*\.\s*getState\(\)/g;
  for (const match of source.matchAll(capture)) {
    const variable = match[1];
    const following = source.slice(match.index + match[0].length).trimStart()[0];
    if (following === '.' || following === '?') continue; // chained, not captured
    const usage = new RegExp('\\b' + variable + '\\s*\\.\\s*([A-Za-z_$][\\w$]*)', 'g');
    for (const use of source.matchAll(usage)) {
      found.push({ variable, member: use[1] });
    }
  }
  return found;
}

/**
 * The loop is being moved off the stores file by file. This guard pins the
 * *remaining* direct store access per file, so the seam cannot be quietly
 * bypassed and the allowlists can only shrink.
 *
 * `runtime.ts` is the important one: it is switched over, so its allowlist is
 * empty and any store access at all fails. A per-file map rather than one shared
 * list, because a single list would let `runtime.ts` borrow `tools.ts`'s entries
 * and quietly regress.
 *
 * This is a static check on source text on purpose. A behavioural test cannot
 * detect a new direct store read that happens to work in the renderer.
 */
const ALLOWED_STORE_MEMBERS: Record<string, Set<string>> = {
  // Every agent-loop file is switched over to AgentHost. The contract is zero
  // direct store access in all of them, so re-adding an entry here means the seam
  // is being bypassed and should be fixed rather than allowlisted.
  'runtime.ts': new Set([]),
  'tools.ts': new Set([]),
  'context.ts': new Set([]),
};

test('runtime.ts reaches for the stores zero times', () => {
  const source = readFileSync(path.join(here, '..', 'src', 'lib', 'agent', 'runtime.ts'), 'utf8');
  const accesses = findStoreAccess(source).map((entry) => entry.variable + '.' + entry.member);
  assert.deepEqual(
    accesses,
    [],
    'runtime.ts must go through AgentHost, not the stores. Found:\n  ' + accesses.join('\n  '),
  );
});

test('no agent-loop file imports the renderer stores', () => {
  // Any import from src/store/ pulls in zustand, and zustand pulls in React, which
  // is precisely what stops these modules from running in a plain Node daemon. So
  // the rule is "no store imports at all", not merely "no store access".
  const offenders = [];
  for (const name of Object.keys(ALLOWED_STORE_MEMBERS)) {
    const source = readFileSync(path.join(here, '..', 'src', 'lib', 'agent', name), 'utf8');
    for (const match of source.matchAll(/from\s+'([^']*store\/[^']*)'/g)) {
      offenders.push(name + ' -> ' + match[1]);
    }
    if (/use(?:Session|Core|Editor|Config)Store/.test(source)) {
      offenders.push(name + ' -> store handle');
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'agent files must not touch src/store/:\n  ' + offenders.join('\n  '),
  );
});

test('every agent-loop file stays within its own store allowlist', () => {
  const offenders: string[] = [];
  for (const [name, allowed] of Object.entries(ALLOWED_STORE_MEMBERS)) {
    const source = readFileSync(path.join(here, '..', 'src', 'lib', 'agent', name), 'utf8');
    for (const entry of findStoreAccess(source)) {
      if (!allowed.has(entry.member)) {
        offenders.push(name + ': ' + entry.variable + '.' + entry.member);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'Un-allowlisted store access. Route it through AgentHost instead of widening this list:\n  ' +
      offenders.join('\n  '),
  );
});

test('the guard itself detects both access forms', () => {
  // Guards against the guard silently passing due to a broken regex.
  const sample = [
    'const x = useSessionStore.getState().totallyNewMember;',
    'const store = useSessionStore.getState();',
    'store.anotherNewMember();',
    // A chained read must NOT be mistaken for a store capture, even across lines.
    'const notAStore = useConfigStore',
    '  .getState()',
    '  .config?.acpAgents.find((i) => i.enabled);',
  ].join('\n');
  const members = findStoreAccess(sample).map((entry) => entry.member);
  assert.ok(members.includes('totallyNewMember'), 'direct form must be detected');
  assert.ok(members.includes('anotherNewMember'), 'captured form must be detected');
  assert.ok(!members.includes('enabled'), 'a chained read must not be treated as a capture');
  assert.equal(ALLOWED_STORE_MEMBERS['runtime.ts'].has('totallyNewMember'), false);
  assert.equal(ALLOWED_STORE_MEMBERS['tools.ts'].has('anotherNewMember'), false);
});

/* ------------------------------------------------------------- model resolution */

/**
 * Model policy lives with the host, not the loop, so these tests supply it
 * explicitly. The renderer's real policy is `rendererModelResolver`, which reads
 * the config store and therefore is not importable here.
 */
const testModelResolver: ModelResolver = (session, config) => {
  if (!config) return null;
  const providers = (config as { providers?: Array<{ id: string; models: Array<{ id: string; enabled: boolean }> }> })
    .providers ?? [];
  const pick = (providerId: string, modelId: string) => {
    const provider = providers.find((entry) => entry.id === providerId);
    const model = provider?.models.find((entry) => entry.id === modelId && entry.enabled);
    return provider && model ? ({ ref: { providerId, modelId }, provider, model, label: modelId } as never) : null;
  };
  if (session.model) return pick(session.model.providerId, session.model.modelId);
  const kind = session.permission === 'plan' ? 'planning' : 'primary';
  const ref = (config as { defaults?: Record<string, { providerId: string; modelId: string } | null> })
    .defaults?.[kind];
  return ref ? pick(ref.providerId, ref.modelId) : null;
};

test('resolveModel is delegated to the host-supplied policy', () => {
  const config = {
    providers: [
      {
        id: 'p1',
        name: 'P',
        baseUrl: 'http://x/v1',
        apiKey: '',
        headers: {},
        models: [
          { id: 'big', enabled: true },
          { id: 'small', enabled: true },
        ],
      },
    ],
    defaults: {
      primary: { providerId: 'p1', modelId: 'big' },
      fast: { providerId: 'p1', modelId: 'small' },
      planning: null,
    },
  } as never;

  const host = new InMemoryAgentHost({
    config,
    modelResolver: testModelResolver,
    sessions: [makeSession({ model: { providerId: 'p1', modelId: 'small' } })],
  });
  // An explicit session model wins.
  assert.equal(host.resolveModel(host.getSession('s1')!).model.id, 'small');

  // Without one, the permission mode selects the default.
  const fallbackHost = new InMemoryAgentHost({
    config,
    modelResolver: testModelResolver,
    sessions: [makeSession()],
  });
  assert.equal(fallbackHost.resolveModel(fallbackHost.getSession('s1')!).model.id, 'big');

  // A config-less host resolves nothing rather than guessing.
  const bare = new InMemoryAgentHost({
    modelResolver: testModelResolver,
    sessions: [makeSession()],
  });
  assert.equal(bare.resolveModel(bare.getSession('s1')!), null);
});

test('a host with no model resolver reports no model instead of guessing', () => {
  const host = new InMemoryAgentHost({ sessions: [makeSession()] });
  assert.equal(host.resolveModel(host.getSession('s1')!), null);
});

/* -------------------------------------------------------------- relativize */

test('relativize normalises separators and only strips a real prefix', () => {
  assert.equal(relativize('D:/projects/app', 'D:\\projects\\app\\src\\a.ts'), 'src/a.ts');
  assert.equal(relativize('D:/projects/app/', 'D:/projects/app/src/a.ts'), 'src/a.ts');
  assert.equal(relativize('D:/projects/app', 'D:/projects/app'), '');
  // Not a prefix — must not be trimmed into a bogus relative path.
  assert.equal(relativize('D:/projects/app', 'D:/projects/application/x.ts'), 'D:/projects/application/x.ts');
  // Empty root means there is nothing to strip.
  assert.equal(relativize('', 'D:/x/y.ts'), 'D:/x/y.ts');
});
