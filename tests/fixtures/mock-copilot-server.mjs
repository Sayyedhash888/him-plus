#!/usr/bin/env node
// Mock Copilot language server used by tests/copilotConnection.test.ts.
// Speaks LSP-framed JSON-RPC over stdio.

let buffer = Buffer.alloc(0);

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        capabilities: {
          inlineCompletionProvider: true,
          textDocumentSync: 2,
        },
        serverInfo: { name: 'mock-copilot', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'initialized') return;
  if (method === 'signIn') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        userCode: 'ABCD-EFGH',
        command: {
          command: 'github.copilot.finishDeviceFlow',
          arguments: [],
          title: 'Sign in',
        },
      },
    });
    setTimeout(() => {
      send({
        jsonrpc: '2.0',
        method: 'didChangeStatus',
        params: { kind: 'Normal', message: '', busy: false },
      });
    }, 20);
    return;
  }
  if (method === 'textDocument/inlineCompletion') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        items: [
          {
            insertText: 'print("mock")',
            range: {
              start: { line: 0, character: 3 },
              end: { line: 0, character: 3 },
            },
            command: {
              command: 'github.copilot.didAcceptCompletionItem',
              arguments: ['mock-id'],
            },
          },
        ],
      },
    });
    return;
  }
  if (method === 'workspace/executeCommand') {
    send({ jsonrpc: '2.0', id, result: null });
    return;
  }
  if (method === 'signOut') {
    send({ jsonrpc: '2.0', id, result: null });
    return;
  }
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, result: null });
  }
}

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const header = buffer.subarray(0, headerEnd).toString('ascii');
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const start = headerEnd + 4;
    if (buffer.length < start + length) return;
    const body = buffer.subarray(start, start + length).toString('utf8');
    buffer = buffer.subarray(start + length);
    try {
      handle(JSON.parse(body));
    } catch {
      // ignore
    }
  }
});
