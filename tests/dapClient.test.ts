import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { DapClient } from '../electron/dapClient.ts';

function startMockAdapter(): Promise<{ port: number; close(): void; sent: unknown[] }> {
  return new Promise((resolve) => {
    const sent: unknown[] = [];
    const sockets = new Set<net.Socket>();
    const server = net.createServer((socket) => {
      sockets.add(socket);
      let buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => {
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
          const payload = JSON.parse(buffer.subarray(start, start + length).toString('utf8'));
          buffer = buffer.subarray(start + length);
          sent.push(payload);
          const reply = (body: unknown) => {
            const data = Buffer.from(JSON.stringify(body), 'utf8');
            socket.write(`Content-Length: ${data.length}\r\n\r\n`);
            socket.write(data);
          };
          if (payload.type === 'request' && payload.command === 'initialize') {
            reply({ seq: 1, type: 'response', request_seq: payload.seq, success: true, command: 'initialize', body: { supportsConfigurationDoneRequest: true } });
            reply({ seq: 2, type: 'event', event: 'initialized', body: {} });
          } else if (payload.type === 'request' && payload.command === 'attach') {
            reply({ seq: 3, type: 'response', request_seq: payload.seq, success: true, command: 'attach', body: {} });
            setTimeout(() => {
              reply({ seq: 4, type: 'event', event: 'stopped', body: { reason: 'breakpoint', threadId: 1 } });
            }, 20);
          } else if (payload.type === 'request' && payload.command === 'stackTrace') {
            reply({
              seq: 5,
              type: 'response',
              request_seq: payload.seq,
              success: true,
              command: 'stackTrace',
              body: { stackFrames: [{ id: 7, name: 'main', line: 3, column: 1, source: { path: 'D:/repo/app.py' } }] },
            });
          } else if (payload.type === 'request' && payload.command === 'fail') {
            reply({ seq: 6, type: 'response', request_seq: payload.seq, success: false, command: 'fail', message: 'simulated failure' });
          } else if (payload.type === 'request') {
            reply({ seq: 7, type: 'response', request_seq: payload.seq, success: true, command: payload.command, body: {} });
          }
        }
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        sent,
        close: () => {
          for (const socket of sockets) socket.destroy();
          server.close();
        },
      });
    });
  });
}

test('DAP client performs the initialize/attach handshake and receives events', async () => {
  const adapter = await startMockAdapter();
  const events: Array<{ event: string; body: unknown }> = [];
  const client = new DapClient({ onEvent: (event, body) => events.push({ event, body }) });
  try {
    await client.connect('127.0.0.1', adapter.port);
    assert.equal(client.connected, true);
    const init = (await client.request('initialize', { clientID: 'him-plus' })) as {
      supportsConfigurationDoneRequest?: boolean;
    };
    assert.equal(init.supportsConfigurationDoneRequest, true);
    await client.request('attach', { justMyCode: true });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(events.some((entry) => entry.event === 'initialized'));
    assert.ok(events.some((entry) => entry.event === 'stopped'));

    const stack = (await client.request('stackTrace', { threadId: 1 })) as {
      stackFrames: Array<{ id: number; name: string; line: number; source: { path: string } }>;
    };
    assert.equal(stack.stackFrames[0].name, 'main');
    assert.equal(stack.stackFrames[0].source.path, 'D:/repo/app.py');

    await assert.rejects(() => client.request('fail'), /simulated failure/);
  } finally {
    client.dispose();
    adapter.close();
  }
});
