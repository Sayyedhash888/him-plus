#!/usr/bin/env node
// Minimal MCP stdio server used by tests/mcpClient.test.ts.
// Speaks newline-delimited JSON-RPC 2.0 on stdin/stdout.

process.stdin.setEncoding('utf8');
let buffer = '';

const tools = [
  {
    name: 'echo',
    description: 'Echo the provided text back.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo.' } },
      required: ['text'],
    },
  },
  {
    name: 'fail',
    description: 'Always reports an error result.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function handle(message) {
  const { id, method, params } = message;
  if (method === undefined) return; // response from client, ignore
  if (id === undefined) return; // notification
  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-mcp', version: '1.0.0' },
      },
    });
    return;
  }
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools } });
    return;
  }
  if (method === 'tools/call') {
    const name = params?.name;
    const args = params?.arguments || {};
    if (name === 'echo') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `echo: ${args.text}` }] },
      });
      return;
    }
    if (name === 'fail') {
      send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: 'boom' }], isError: true },
      });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32602, message: `unknown tool ${name}` } });
    return;
  }
  if (method === 'ping') {
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
}

process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try {
        handle(JSON.parse(line));
      } catch {
        // ignore malformed lines
      }
    }
    newline = buffer.indexOf('\n');
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
