#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.env.PORT || 9765);
const logFile = process.env.LOG_FILE || '';

const server = http.createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    if (logFile) {
      fs.appendFileSync(
        logFile,
        `${JSON.stringify({ url: request.url, body: body.slice(0, 3000) })}\n`,
      );
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.url?.endsWith('/chat/completions')) {
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: 'assistant',
                content:
                  'Mock answer from HIM+ Code. The workspace model bridge is working.',
              },
            },
          ],
        }),
      );
      return;
    }
    if (request.url?.endsWith('/completions')) {
      response.end(JSON.stringify({ choices: [{ text: ' FIM_OK' }] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: { message: 'not found' } }));
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`mock HIM+ extension server on ${port}\n`);
});