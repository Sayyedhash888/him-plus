import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AcpClient } from '../electron/acpClient.ts';

const fixtureDir = path.dirname(fileURLToPath(import.meta.url));
const fixture = path.join(fixtureDir, 'fixtures', 'mock-acp-models.mjs');

async function connect(mode: 'models' | 'config'): Promise<{
  client: AcpClient;
  sessionId: string;
}> {
  const client = new AcpClient({
    onUpdate: () => undefined,
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

test('reads the legacy session/new model catalog and switches with session/set_model', async () => {
  const { client, sessionId } = await connect('models');
  try {
    const models = client.getSessionModels(sessionId);
    assert.equal(models?.currentModelId, 'model-a');
    assert.deepEqual(
      models?.availableModels.map((model) => model.modelId),
      ['model-a', 'model-b'],
    );
    assert.equal(models?.availableModels[0].name, 'Model A');

    const next = await client.setModel(sessionId, 'model-b');
    assert.equal(next?.currentModelId, 'model-b');
    assert.equal(client.getSessionModels(sessionId)?.currentModelId, 'model-b');
    await assert.rejects(() => client.setModel(sessionId, 'nope'), /does not offer/i);
  } finally {
    client.dispose();
  }
});

test('reads configOptions model catalogs and switches with session/set_config_option', async () => {
  const { client, sessionId } = await connect('config');
  try {
    const models = client.getSessionModels(sessionId);
    assert.equal(models?.configId, 'model');
    assert.equal(models?.currentModelId, 'cfg-a');
    assert.deepEqual(
      models?.availableModels.map((model) => model.modelId),
      ['cfg-a', 'cfg-b'],
    );

    const next = await client.setModel(sessionId, 'cfg-b');
    assert.equal(next?.currentModelId, 'cfg-b');
    assert.equal(client.getSessionModels(sessionId)?.currentModelId, 'cfg-b');
  } finally {
    client.dispose();
  }
});

test('applies model updates streamed as session/update notifications', async () => {
  const { client, sessionId } = await connect('config');
  try {
    assert.equal(client.getSessionModels(sessionId)?.currentModelId, 'cfg-a');
    await client.prompt(sessionId, 'hello');
    // The mock switches to cfg-b via config_option_update during the turn.
    assert.equal(client.getSessionModels(sessionId)?.currentModelId, 'cfg-b');
  } finally {
    client.dispose();
  }
});
