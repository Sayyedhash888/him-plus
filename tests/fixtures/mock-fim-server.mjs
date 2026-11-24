#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.env.PORT || 9977);
const logFile = process.env.LOG_FILE || '';

function log(entry) {
  if (!logFile) return;
  fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
}

const server = http.createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    log({ method: request.method, url: request.url, body: body.slice(0, 2000) });
    response.setHeader('Content-Type', 'application/json');
    if (request.url?.endsWith('/models')) {
      response.end(JSON.stringify({ data: [{ id: 'mock-fast' }] }));
      return;
    }
    if (request.url?.endsWith('/chat/completions')) {
      response.end(
        JSON.stringify({
          choices: [{ message: { content: ' FIM_OK' }, finish_reason: 'stop' }],
        }),
      );
      return;
    }
    if (request.url?.endsWith('/completions')) {
      response.end(
        JSON.stringify({
          choices: [{ text: ' FIM_OK', finish_reason: 'stop' }],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: 'not found' } }));
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`mock fim server on ${port}\n`);
});