import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface PtyLike {
  onData(listener: (chunk: string) => void): void;
  onExit(listener: (event: { exitCode: number }) => void): void;
  kill(): void;
}

test('PTY prebuild spawns a real process and streams output', { timeout: 25_000 }, async (t) => {
  let pty: { spawn(...args: unknown[]): PtyLike };
  try {
    pty = require('@homebridge/node-pty-prebuilt-multiarch') as typeof pty;
  } catch (error) {
    t.skip(`PTY prebuild unavailable on this platform: ${(error as Error).message}`);
    return;
  }

  const isWindows = process.platform === 'win32';
  const command = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
  const args = isWindows
    ? ['/d', '/s', '/c', 'echo him-pty-ok']
    : ['-c', 'echo him-pty-ok'];

  const child = pty.spawn(command, args, {
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: { ...process.env } as Record<string, string>,
  });

  let output = '';
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PTY output timed out')), 15_000);
    child.onData((chunk) => {
      output += chunk;
      if (output.includes('him-pty-ok')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.onExit(() => {
      clearTimeout(timer);
      setTimeout(resolve, 100);
    });
  });
  try {
    child.kill();
  } catch {
    // already exited
  }
  assert.match(output, /him-pty-ok/);
});
