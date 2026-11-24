import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CopilotConnection } from '../electron/copilotConnection.ts';

function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('Timed out waiting for the Copilot server.'));
        return;
      }
      setTimeout(poll, 150);
    };
    poll();
  });
}

test('the real Copilot language server starts and reports status', { timeout: 120_000 }, async (t) => {
  const script = path.join(
    process.cwd(),
    'node_modules',
    '@github',
    'copilot-language-server',
    'dist',
    'language-server.js',
  );
  if (!fs.existsSync(script)) {
    t.skip('@github/copilot-language-server is not installed');
    return;
  }
  const child = spawn(process.execPath, [script, '--stdio'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as ChildProcessWithoutNullStreams;
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const connection = new CopilotConnection();
  connection.attachStdio(child.stdin, child.stdout);
  const notifications: Array<{ method: string; params: unknown }> = [];
  connection.onNotification((method, params) => notifications.push({ method, params }));
  connection.onRequest(() => ({ result: null }));
  try {
    const init = (await connection.request('initialize', {
      processId: process.pid,
      clientInfo: { name: 'him-plus-test', version: '0.1.0' },
      workspaceFolders: [
        { uri: pathToFileURL(process.cwd()).toString(), name: 'him-plus' },
      ],
      capabilities: {
        workspace: { workspaceFolders: true },
        textDocument: {
          synchronization: { dynamicRegistration: false },
          inlineCompletion: { dynamicRegistration: false },
        },
      },
      initializationOptions: {
        editorInfo: { name: 'HIM+ test', version: '0.1.0' },
        editorPluginInfo: { name: 'HIM+ test', version: '0.1.0' },
      },
    })) as { capabilities?: Record<string, unknown> };
    assert.ok(init && typeof init === 'object', 'expected initialize result');
    connection.notify('initialized', {});
    await waitFor(
      () => notifications.some((entry) => entry.method === 'didChangeStatus'),
      45_000,
    );
    const status = notifications.find((entry) => entry.method === 'didChangeStatus')?.params as {
      kind?: string;
    };
    assert.ok(
      typeof status?.kind === 'string' && status.kind.length > 0,
      'expected a Copilot status kind',
    );
  } finally {
    connection.dispose();
    try {
      child.kill();
    } catch {
      // ignore
    }
    void stderr;
  }
});
