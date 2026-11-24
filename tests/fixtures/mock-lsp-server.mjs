#!/usr/bin/env node
// Minimal LSP stdio server used by tests/lspClient.test.ts.

let buffer = Buffer.alloc(0);

function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function handle(message) {
  const { id, method, params } = message;
  if (!method) return;
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          definitionProvider: true,
        },
        serverInfo: { name: 'mock-lsp', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'initialized') return;
  if (method === 'textDocument/didOpen') {
    const uri = params?.textDocument?.uri || 'file:///mock.ts';
    send({
      jsonrpc: '2.0',
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            severity: 1,
            message: 'Mock semantic error',
            source: 'mock',
            code: 1234,
          },
          {
            range: { start: { line: 2, character: 3 }, end: { line: 2, character: 6 } },
            severity: 2,
            message: 'Mock warning',
            source: 'mock',
          },
        ],
      },
    });
    return;
  }
  if (method === 'textDocument/hover') {
    send({
      jsonrpc: '2.0',
      id,
      result: { contents: { kind: 'markdown', value: 'Mock hover contents' } },
    });
    return;
  }
  if (method === 'textDocument/definition') {
    send({
      jsonrpc: '2.0',
      id,
      result: [
        {
          uri: params?.textDocument?.uri || 'file:///mock.ts',
          range: { start: { line: 4, character: 1 }, end: { line: 4, character: 6 } },
        },
      ],
    });
    return;
  }
  if (method === 'shutdown') {
    send({ jsonrpc: '2.0', id, result: null });
    return;
  }
  if (method === 'exit') return;
  if (id !== undefined) {
    send({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `method not found: ${method}` },
    });
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
      // ignore malformed frames
    }
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
