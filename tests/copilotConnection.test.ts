import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CopilotConnection } from '../electron/copilotConnection.ts';

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'mock-copilot-server.mjs',
);

function start(): { child: ChildProcessWithoutNullStreams; connection: CopilotConnection } {
  const child = spawn(process.execPath, [fixture], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  }) as ChildProcessWithoutNullStreams;
  const connection = new CopilotConnection();
  connection.attachStdio(child.stdin, child.stdout);
  return { child, connection };
}

test('copilot connection performs initialize, sign-in, status and inline completion', async () => {
  const { child, connection } = start();
  const notifications: Array<{ method: string; params: unknown }> = [];
  connection.onNotification((method, params) => notifications.push({ method, params }));
  connection.onRequest((method) => {
    if (method === 'workspace/configuration') return { result: [] };
    return { result: null };
  });
  try {
    const init = (await connection.request('initialize', {
      processId: process.pid,
      capabilities: {},
    })) as { capabilities?: { inlineCompletionProvider?: boolean } };
    assert.equal(init.capabilities?.inlineCompletionProvider, true);
    connection.notify('initialized', {});

    const signIn = (await connection.request('signIn', {})) as {
      userCode?: string;
      command?: { command?: string };
    };
    assert.equal(signIn.userCode, 'ABCD-EFGH');
    assert.equal(signIn.command?.command, 'github.copilot.finishDeviceFlow');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(
      notifications.some(
        (entry) =>
          entry.method === 'didChangeStatus' &&
          (entry.params as { kind?: string } | null)?.kind === 'Normal',
      ),
    );

    const completion = (await connection.request('textDocument/inlineCompletion', {
      textDocument: { uri: 'file:///workspace/app.py', version: 1 },
      position: { line: 0, character: 3 },
    })) as { items?: Array<{ insertText?: string }> };
    assert.equal(completion.items?.[0]?.insertText, 'print("mock")');
  } finally {
    connection.dispose();
    child.kill();
  }
});
