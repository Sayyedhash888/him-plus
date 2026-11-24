import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient, type AcpClientOptions, type AcpServerUpdate } from '../electron/acpClient.ts';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const agentPath = path.join(fixtureDir, 'fixtures', 'mock-acp-agent.mjs');

interface Recorded {
  updates: AcpServerUpdate[];
  writes: { path: string; content: string }[];
  reads: string[];
  permissions: { toolCall: Record<string, unknown>; optionIds: string[] }[];
}

async function runTurn(
  mode: 'stream' | 'permission',
  permission = 'allow-once',
): Promise<Recorded> {
  const recorded: Recorded = { updates: [], writes: [], reads: [], permissions: [] };
  const options: AcpClientOptions = {
    onUpdate: (update) => recorded.updates.push(update),
    requestPermission: async (request) => {
      recorded.permissions.push({
        toolCall: request.toolCall,
        optionIds: request.options.map((option) => option.optionId),
      });
      return { optionId: permission };
    },
    readTextFile: async (request) => {
      recorded.reads.push(request.path);
      return 'previous contents';
    },
    writeTextFile: async (request) => {
      recorded.writes.push({ path: request.path, content: request.content });
    },
  };
  const client = new AcpClient(options);
  try {
    await client.start({
      command: process.execPath,
      args: [agentPath, mode],
      cwd: fixtureDir,
      env: {},
    });
    const sessionId = await client.newSession(fixtureDir);
    const outcome = await client.prompt(sessionId, 'Make the change.');
    assert.equal(outcome.stopReason, 'end_turn');
  } finally {
    client.dispose();
  }
  return recorded;
}

test('streams ACP text, tool calls, and file access', async () => {
  const recorded = await runTurn('stream');
  const text = recorded.updates
    .filter((update) => update.sessionUpdate === 'agent_message_chunk')
    .map((update) => String((update.content as { text?: string })?.text || ''))
    .join('');
  assert.equal(text, 'Hello world');
  assert.equal(recorded.reads[0], 'note.txt');
  assert.deepEqual(recorded.writes, [{ path: 'note.txt', content: 'from acp' }]);
  const toolUpdate = recorded.updates.find(
    (update) => update.sessionUpdate === 'tool_call_update',
  );
  assert.equal(toolUpdate?.status, 'completed');
});

test('ACP start failure includes the agent stderr diagnostics', async () => {  const failingPath = path.join(fixtureDir, 'fixtures', 'failing-acp-server.mjs');
  const client = new AcpClient({
    onUpdate: () => undefined,
    requestPermission: async () => ({ optionId: 'reject-once' }),
  });
  try {
    await assert.rejects(
      () =>
        client.start({
          command: process.execPath,
          args: [failingPath],
          cwd: fixtureDir,
          shell: false,
        }),
      (error: Error) => {
        assert.match(error.message, /disconnected/i);
        assert.match(error.message, /unknown option '--acp'/);
        return true;
      },
    );
  } finally {
    client.dispose();
  }
});

test('advertises agent auth methods and runs the authenticate flow', async () => {
  const client = new AcpClient({
    onUpdate: () => undefined,
    requestPermission: async () => ({ optionId: 'reject-once' }),
  });
  try {
    await client.start({
      command: process.execPath,
      args: [agentPath],
      cwd: fixtureDir,
      shell: false,
    });
    assert.deepEqual(
      client.getAuthMethods().map((method) => method.id),
      ['mock-login'],
    );
    await client.authenticate('mock-login');
  } finally {
    client.dispose();
  }
});

test('routes ACP permission requests to the client policy', async () => {
  const recorded = await runTurn('permission');
  assert.equal(recorded.permissions.length, 1);
  assert.equal(
    (recorded.permissions[0].toolCall as { toolCallId?: string }).toolCallId,
    'tool-1',
  );
  assert.deepEqual(recorded.permissions[0].optionIds, ['allow-once', 'reject-once']);
  assert.equal(recorded.writes.length, 1);
});