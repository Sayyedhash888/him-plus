/**
 * Mock OpenAI-compatible provider for the him-agentd tests.
 *
 * Prints `LISTENING <port>` on stdout once bound, so a test can start it on an
 * ephemeral port and read the port back without racing.
 *
 * Query/behaviour switches:
 *   ?content=a,b,c     deltas to stream before [DONE]
 *   ?status=500        fail the request with that HTTP status instead
 *   ?retryAfter=1      send a Retry-After header with the failure
 *   ?stall=1           send a delta, then never finish (triggers idle timeout)
 *   ?silent=1          accept the connection and send nothing (header timeout)
 *   ?tools=1           also emit a tool-call delta
 *   ?usage=1           include a usage block on the final chunk
 *
 * POST /v1/chat/completions  -> SSE (when body.stream) or a single JSON message
 * GET  /v1/models            -> { data: [{ id }] }
 */
import http from 'node:http';

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const query = url.searchParams;

  if (req.method === 'GET' && url.pathname.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'mock-large' }, { id: 'mock-small' }] }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    let parsed = {};
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      parsed = {};
    }

    const status = Number(query.get('status') || 0);
    if (status) {
      const headers = { 'Content-Type': 'application/json' };
      const retryAfter = query.get('retryAfter');
      if (retryAfter) headers['Retry-After'] = retryAfter;
      res.writeHead(status, headers);
      res.end(JSON.stringify({ error: { message: `mock failure ${status}` } }));
      return;
    }

    if (query.get('silent')) {
      // Accept and hold the connection open: exercises the header timeout path.
      return;
    }

    const model = parsed.model || 'mock-model';
    const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    if (!parsed.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'cmpl-mock',
          choices: [{ index: 0, message: { role: 'assistant', content: 'non-streamed' } }],
          model,
        }),
      );
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const delta = (content) =>
      send({ id: 'cmpl-mock', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: { content } }] });

    if (query.get('tools')) {
      send({
        id: 'cmpl-mock',
        object: 'chat.completion.chunk',
        model,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'read_file', arguments: '{"path":"a' } },
              ],
            },
          },
        ],
      });
      send({
        id: 'cmpl-mock',
        object: 'chat.completion.chunk',
        model,
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '.ts"}' } }] } }],
      });
    }

    const parts = (query.get('content') || 'Hello, world').split(',');
    parts.forEach((part, index) => {
      if (index === parts.length - 1 && query.get('usage')) {
        send({
          id: 'cmpl-mock',
          object: 'chat.completion.chunk',
          model,
          choices: [{ index: 0, delta: { content: part }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        });
      } else {
        delta(part);
      }
    });

    if (query.get('stall')) return;

    res.write('data: [DONE]\n\n');
    if (!query.get('usage')) {
      // A trailing finish_reason chunk, as real providers send.
      send({ id: 'cmpl-mock', object: 'chat.completion.chunk', model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    }
    res.end();
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`LISTENING ${address.port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500);
  });
}
