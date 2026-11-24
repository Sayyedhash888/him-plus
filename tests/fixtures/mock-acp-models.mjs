#!/usr/bin/env node
// Mock ACP agent advertising a model catalog in both protocol shapes.
// Usage: node mock-acp-models.mjs [models|config]

const mode = process.argv[2] === 'config' ? 'config' : 'models';
const sessionId = mode === 'config' ? 'sess-config' : 'sess-models';

let currentModelId = mode === 'config' ? 'cfg-a' : 'model-a';

const legacyModels = {
  currentModelId,
  availableModels: [
    { modelId: 'model-a', name: 'Model A', description: 'First legacy model' },
    { modelId: 'model-b', name: 'Model B' },
  ],
};

const configOptions = () => [
  {
    id: 'model',
    name: 'Model',
    type: 'select',
    currentValue: currentModelId,
    options: [
      { value: 'cfg-a', name: 'Config A' },
      { value: 'cfg-b', name: 'Config B', description: 'Second config model' },
    ],
  },
];

process.stdin.setEncoding('utf8');
let buffer = '';

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sessionPayload() {
  return mode === 'config'
    ? { sessionId, configOptions: configOptions() }
    : { sessionId, models: { ...legacyModels, currentModelId } };
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
        agentCapabilities: { loadSession: false },
        authMethods: [],
      },
    });
    return;
  }
  if (method === 'session/new') {
    send({ jsonrpc: '2.0', id, result: sessionPayload() });
    return;
  }
  if (method === 'session/set_model') {
    if (mode !== 'models') {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'set_model unsupported' } });
      return;
    }
    currentModelId = params?.modelId;
    send({ jsonrpc: '2.0', id, result: {} });
    return;
  }
  if (method === 'session/set_config_option') {
    if (mode !== 'config') {
      send({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: 'set_config_option unsupported' },
      });
      return;
    }
    if (params?.configId !== 'model') {
      send({ jsonrpc: '2.0', id, error: { code: -32602, message: 'unknown configId' } });
      return;
    }
    currentModelId = params?.value;
    send({ jsonrpc: '2.0', id, result: { configOptions: configOptions() } });
    return;
  }
  if (method === 'session/prompt') {
    // Advertise a mid-session model change, then finish the turn.
    if (mode === 'config') {
      currentModelId = 'cfg-b';
      send({
        jsonrpc: '2.0',
        id: 900,
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'config_option_update',
            configOptions: configOptions(),
          },
        },
      });
    } else {
      currentModelId = 'model-b';
      send({
        jsonrpc: '2.0',
        id: 901,
        method: 'session/update',
        params: {
          sessionId,
          update: { sessionUpdate: 'current_model_update', modelId: currentModelId },
        },
      });
    }
    send({
      jsonrpc: '2.0',
      id: 902,
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'ok' },
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
