#!/usr/bin/env node
// Mock ACP agent used by tests/acpVision.test.ts.
// Advertises (or rejects) image prompt support and reports the received blocks.
// Usage: node mock-acp-vision.mjs [vision|novision]

const supportsImages = process.argv[2] !== 'novision';
const sessionId = 'sess-vision';

process.stdin.setEncoding('utf8');
let buffer = '';

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function handle(message) {
  const { id, method, params } = message;
  if (method === undefined || id === undefined) return;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: false,
          promptCapabilities: {
            image: supportsImages,
            audio: false,
            embeddedContext: false,
          },
        },
        authMethods: [],
      },
    });
    return;
  }
  if (method === 'session/new') {
    send({ jsonrpc: '2.0', id, result: { sessionId } });
    return;
  }
  if (method === 'session/prompt') {
    const blocks = Array.isArray(params?.prompt) ? params.prompt : [];
    const kinds = blocks.map((block) => block?.type || 'unknown').join(',');
    const imageBytes = blocks
      .filter((block) => block?.type === 'image')
      .reduce((total, block) => total + String(block.data || '').length, 0);
    send({
      jsonrpc: '2.0',
      id: 700,
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `blocks:${kinds};imgBytes:${imageBytes}` },
        },
      },
    });
    send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
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
        // ignore malformed input
      }
    }
    newline = buffer.indexOf('\n');
  }
});

process.stdin.on('end', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
