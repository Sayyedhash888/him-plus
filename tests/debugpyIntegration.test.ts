import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DapClient } from '../electron/dapClient.ts';

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for debugger state.');
}

test('debugpy adapter launches a script and stops at a breakpoint', { timeout: 120_000 }, async (t) => {
  const probe = spawnSync('python', ['-c', 'import debugpy'], { stdio: 'ignore' });
  if (probe.status !== 0) {
    t.skip('debugpy is not installed for this python');
    return;
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'him-dbg-'));
  const file = path.join(dir, 'target.py');
  fs.writeFileSync(
    file,
    ['def add(a, b):', '    total = a + b', '    return total', '', 'print(add(2, 3))', ''].join('\n'),
    'utf8',
  );

  const child = spawn('python', ['-Xfrozen_modules=off', '-m', 'debugpy.adapter'], {
    cwd: dir,
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const events: Array<{ event: string; body: unknown }> = [];
  const client = new DapClient({ onEvent: (event, body) => events.push({ event, body }) });
  client.attachStdio(child.stdin, child.stdout);
  try {
    await client.request('initialize', {
      clientID: 'him-plus-test',
      adapterID: 'python',
      linesStartAt1: true,
      columnsStartAt1: true,
    });
    const launchResponse = client.request('launch', {
      name: 'HIM+ test',
      type: 'python',
      request: 'launch',
      program: file,
      cwd: dir,
      console: 'internalConsole',
      justMyCode: true,
      stopOnEntry: false,
      env: {},
      args: [],
    });
    launchResponse.catch(() => undefined);
    await client.waitForEvent('initialized', 10_000);
    await client.request('setBreakpoints', {
      source: { path: file, name: 'target.py' },
      breakpoints: [{ line: 2 }],
      lines: [2],
    });
    await client.request('configurationDone', {});
    await waitFor(() => events.some((entry) => entry.event === 'stopped'), 25_000);

    const stopped = events.find((entry) => entry.event === 'stopped');
    const threadId = Number((stopped?.body as { threadId?: number })?.threadId || 1);
    const stack = (await client.request('stackTrace', {
      threadId,
      startFrame: 0,
      levels: 10,
    })) as {
      stackFrames?: Array<{ id: number; name: string; line: number; source?: { path?: string } }>;
    };
    assert.ok((stack.stackFrames || []).length > 0, 'expected a stack frame');
    assert.equal(stack.stackFrames?.[0]?.line, 2);
    assert.ok(
      (stack.stackFrames?.[0]?.source?.path || '').replaceAll('\\', '/').endsWith('target.py'),
    );

    const scopes = (await client.request('scopes', {
      frameId: stack.stackFrames?.[0]?.id,
    })) as { scopes?: Array<{ variablesReference: number; name: string }> };
    assert.ok((scopes.scopes || []).length > 0, 'expected variable scopes');

    const locals = scopes.scopes?.find((scope) => /locals/i.test(scope.name)) || scopes.scopes?.[0];
    if (locals) {
      const variables = (await client.request('variables', {
        variablesReference: locals.variablesReference,
      })) as { variables?: Array<{ name: string; value: string }> };
      assert.ok((variables.variables || []).length > 0, 'expected variables in scope');
    }

    await client.request('continue', { threadId }).catch(() => undefined);
    await waitFor(
      () => events.some((entry) => entry.event === 'terminated' || entry.event === 'exited'),
      15_000,
    ).catch(() => undefined);
  } finally {
    try {
      await client.request('disconnect', { terminateDebuggee: true }, 2_000).catch(
        () => undefined,
      );
    } catch {
      // ignore
    }
    client.dispose();
    try {
      child.kill();
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
    } catch {
      // Windows may briefly hold debuggee files; temp dir is harmless.
    }
    void stderr;
  }
});
