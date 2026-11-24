import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient } from '../electron/acpClient.ts';
import type { AcpSessionUpdate } from '../shared/acp.ts';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(fixtureDir, 'fixtures', 'mock-acp-vision.mjs');

async function connect(
  mode: 'vision' | 'novision',
  updates: AcpSessionUpdate[],
): Promise<{ client: AcpClient; sessionId: string }> {
  const client = new AcpClient({
    onUpdate: (update) => updates.push(update),
    requestPermission: async () => ({ optionId: 'allow-once' }),
  });
  await client.start({
    command: process.execPath,
    args: [fixture, mode],
    cwd: fixtureDir,
    env: {},
  });
  const sessionId = await client.newSession(fixtureDir);
  return { client, sessionId };
}

function textOf(updates: AcpSessionUpdate[]): string {
  return updates
    .filter((update) => update.sessionUpdate === 'agent_message_chunk')
    .map((update) => String((update.content as { text?: string })?.text || ''))
    .join('');
}

test('sends images as ACP image content blocks when the agent advertises support', async () => {
  const updates: AcpSessionUpdate[] = [];
  const { client, sessionId } = await connect('vision', updates);
  try {
    assert.equal(client.supportsImages, true);
    assert.equal(client.getPromptCapabilities().image, true);

    // "AAAA" is 4 base64 characters (3 bytes of image data).
    await client.prompt(sessionId, 'what is this?', [
      { mime: 'image/png', data: 'AAAA' },
    ]);
    const text = textOf(updates);
    assert.match(text, /blocks:text,image/);
    assert.match(text, /imgBytes:4/);
  } finally {
    client.dispose();
  }
});

test('refuses to send image blocks when the agent did not advertise image support', async () => {
  const updates: AcpSessionUpdate[] = [];
  const { client, sessionId } = await connect('novision', updates);
  try {
    assert.equal(client.supportsImages, false);
    assert.equal(client.getPromptCapabilities().image, false);
    await assert.rejects(
      () => client.prompt(sessionId, 'see this', [{ mime: 'image/png', data: 'AAAA' }]),
      /image prompt support/i,
    );
    // Text-only prompts still work on the same agent.
    await client.prompt(sessionId, 'text only');
    assert.match(textOf(updates), /blocks:text;/);
  } finally {
    client.dispose();
  }
});
