import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpStdioClient, flattenMcpContent } from '../electron/mcpClient.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(here, 'fixtures', 'mock-mcp-server.mjs');

test('MCP client initializes, lists tools and calls them over stdio', async () => {
  const client = new McpStdioClient({
    command: process.execPath,
    args: [fixture],
    shell: false,
  });
  try {
    await client.start();
    assert.equal(client.connected, true);

    const tools = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name).sort(),
      ['echo', 'fail'],
    );
    const echo = tools.find((tool) => tool.name === 'echo');
    assert.equal(echo?.inputSchema?.type, 'object');

    const ok = await client.callTool('echo', { text: 'hello' });
    assert.equal(ok.isError, false);
    assert.match(ok.text, /echo: hello/);

    const failed = await client.callTool('fail', {});
    assert.equal(failed.isError, true);
    assert.equal(failed.text, 'boom');
  } finally {
    client.dispose();
  }
});

test('MCP client surfaces protocol errors', async () => {
  const client = new McpStdioClient({
    command: process.execPath,
    args: [fixture],
    shell: false,
  });
  try {
    await client.start();
    await assert.rejects(() => client.callTool('missing', {}), /unknown tool/i);
  } finally {
    client.dispose();
  }
});

test('flattens MCP content blocks into readable tool output', () => {
  const outcome = flattenMcpContent({
    content: [
      { type: 'text', text: 'line one' },
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'resource', resource: { uri: 'file:///tmp/a' } },
    ],
  });
  assert.match(outcome.text, /line one/);
  assert.match(outcome.text, /image content/);
  assert.match(outcome.text, /file:\/\/\/tmp\/a/);
  assert.equal(outcome.isError, false);

  const empty = flattenMcpContent({ content: [] });
  assert.equal(empty.text, '(no output)');
});
