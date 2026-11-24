import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pty = require('@homebridge/node-pty-prebuilt-multiarch') as {
  spawn(
    file: string,
    args: string[],
    options: { cols?: number; rows?: number; cwd?: string; env?: Record<string, string> },
  ): {
    onData(listener: (chunk: string) => void): { dispose(): void };
    onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
    write(data: string): void;
    kill(): void;
  };
};

test(
  'a PTY-driven CLI receives chat input and streams output back',
  { timeout: 30_000 },
  async () => {
    const script = [
      'process.stdout.write("READY\\r\\n");',
      'process.stdin.setEncoding("utf8");',
      'let buffer = "";',
      'process.stdin.on("data", (chunk) => {',
      '  buffer += chunk;',
      '  let index;',
      '  while ((index = buffer.indexOf("\\r")) !== -1) {',
      '    const line = buffer.slice(0, index);',
      '    buffer = buffer.slice(index + 1);',
      '    process.stdout.write("ECHO:" + line + "\\r\\n");',
      '  }',
      '});',
    ].join('');
    const child = pty.spawn(process.execPath, ['-e', script], {
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: { ...process.env },
    });
    let output = '';
    let resolveEcho: (() => void) | null = null;
    const echoSeen = new Promise<void>((resolve) => {
      resolveEcho = resolve;
    });
    child.onData((chunk) => {
      output += chunk;
      if (output.includes('ECHO:hello from chat')) resolveEcho?.();
    });
    try {
      const deadline = Date.now() + 10_000;
      while (!output.includes('READY') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.match(output, /READY/);
      child.write('hello from chat\r');
      await Promise.race([
        echoSeen,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`PTY echo timeout. Output: ${output.slice(0, 500)}`)), 10_000),
        ),
      ]);
      assert.match(output, /ECHO:hello from chat/);
    } finally {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
  },
);
