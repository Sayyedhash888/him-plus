import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LspClient } from '../electron/lspClient.ts';
import type { LspDiagnostic } from '../shared/types.ts';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(fixtureDir, 'fixtures', 'mock-lsp-server.mjs');
const root = os.tmpdir();
const targetFile = path.join(root, 'mock.ts');

function createClient(onDiagnostics: (p: string, d: LspDiagnostic[]) => void): LspClient {
  return new LspClient({
    command: process.execPath,
    args: [fixture],
    cwd: fixtureDir,
    rootPath: root,
    shell: false,
    onDiagnostics,
  });
}

function waitForDiagnostics(events: LspDiagnostic[][]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (events.length > 0) {
        resolve();
        return;
      }
      if (Date.now() - started > 5000) {
        reject(new Error('Timed out waiting for publishDiagnostics'));
        return;
      }
      setTimeout(poll, 25);
    };
    poll();
  });
}

test('LSP client initializes and maps published diagnostics', async () => {
  const events: LspDiagnostic[][] = [];
  const client = createClient((_path, diagnostics) => events.push(diagnostics));
  try {
    await client.start();
    assert.equal(client.connected, true);
    assert.equal(client.serverCapabilities.hoverProvider, true);
    client.didOpen(targetFile, 'typescript', 'const x = 1;\n');
    await waitForDiagnostics(events);
    const [error, warning] = events[0];
    assert.equal(events[0].length, 2);
    assert.equal(error.message, 'Mock semantic error');
    assert.equal(error.severity, 1);
    assert.equal(error.line, 1);
    assert.equal(error.column, 1);
    assert.equal(error.endColumn, 5);
    assert.equal(error.source, 'mock');
    assert.equal(error.code, '1234');
    assert.equal(warning.severity, 2);
    assert.equal(warning.line, 3);
    assert.equal(warning.column, 4);
  } finally {
    client.dispose();
  }
});

test('LSP client supports hover and definition requests', async () => {
  const client = createClient(() => undefined);
  try {
    await client.start();
    client.didOpen(targetFile, 'typescript', 'const x = 1;\n');
    const hover = await client.hover(targetFile, { line: 0, character: 3 });
    assert.equal(hover?.contents, 'Mock hover contents');
    const definition = await client.definition(targetFile, { line: 0, character: 3 });
    assert.equal(definition.length, 1);
    assert.equal(definition[0].path, targetFile);
    assert.equal(definition[0].range.start.line, 5);
    assert.equal(definition[0].range.start.character, 2);
  } finally {
    client.dispose();
  }
});

test('LSP client reports a clean failure when the server is missing', async () => {
  const client = new LspClient({
    command: 'definitely-not-a-real-language-server',
    args: [],
    cwd: fixtureDir,
    rootPath: root,
    shell: false,
    onDiagnostics: () => undefined,
  });
  await assert.rejects(() => client.start(), /ENOENT|not recognized|failed/i);
  client.dispose();
});
