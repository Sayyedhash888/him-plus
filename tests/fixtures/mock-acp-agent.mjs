#!/usr/bin/env node
import readline from 'node:readline';

const mode = process.argv[2] || 'stream';
const rl = readline.createInterface({ input: process.stdin });
let nextServerId = 200;
const waiting = new Map();

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function update(updatePayload) {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: { sessionId: 'sess-mock-1', update: updatePayload },
  });
}

function requestFromAgent(method, params) {
  const id = nextServerId++;
  send({ jsonrpc: '2.0', id, method, params });
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
  });
}

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method) {
    if (message.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: 1,
          agentCapabilities: { loadSession: false },
          agentInfo: { name: 'mock-acp', title: 'Mock ACP', version: '1.0.0' },
          authMethods: [{ id: 'mock-login', name: 'Mock sign in' }],
        },
      });
      return;
    }
    if (message.method === 'authenticate') {
      send({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    }
    if (message.method === 'session/new') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: { sessionId: 'sess-mock-1' },
      });
      return;
    }
    if (message.method === 'session/prompt') {
      try {
        update({
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: 'Planning the answer.' },
        });
        update({
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          name: 'write_file',
          title: 'Wrote note.txt',
          kind: 'edit',
          status: 'pending',
          rawInput: { path: 'note.txt', content: 'from acp' },
        });

        if (mode === 'permission') {
          const permission = await requestFromAgent('session/request_permission', {
            sessionId: 'sess-mock-1',
            toolCall: { toolCallId: 'tool-1', title: 'Wrote note.txt', kind: 'edit' },
            options: [
              { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
              { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
            ],
          });
          if (permission?.outcome?.optionId !== 'allow-once') {
            send({
              jsonrpc: '2.0',
              id: message.id,
              result: { stopReason: 'refusal' },
            });
            return;
          }
        }

        const readResult = await requestFromAgent('fs/read_text_file', {
          sessionId: 'sess-mock-1',
          path: 'note.txt',
        });
        if (typeof readResult?.content !== 'string') {
          throw new Error('missing read result');
        }
        await requestFromAgent('fs/write_text_file', {
          sessionId: 'sess-mock-1',
          path: 'note.txt',
          content: 'from acp',
        });
        update({
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          status: 'completed',
          content: [{ type: 'content', content: { type: 'text', text: 'note.txt updated' } }],
        });
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Hello ' },
        });
        update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'world' },
        });
        send({
          jsonrpc: '2.0',
          id: message.id,
          result: { stopReason: 'end_turn' },
        });
      } catch (error) {
        send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: String(error?.message || error) },
        });
      }
      return;
    }
    if (message.method === 'session/cancel') {
      return;
    }
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Unsupported method: ${message.method}` },
    });
    return;
  }

  const pending = waiting.get(message.id);
  if (pending) {
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message || 'Agent error'));
    else pending.resolve(message.result);
  }
});

process.on('SIGTERM', () => process.exit(0));