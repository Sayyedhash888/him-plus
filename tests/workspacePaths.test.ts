import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPathInside, workspacePath } from '../src/lib/paths.ts';

test('workspacePath resolves relative paths inside the workspace', () => {
  const resolved = workspacePath('D:/projects/app', 'src/main.ts');
  assert.equal(resolved.rel, 'src/main.ts');
  assert.match(resolved.abs.toLowerCase(), /^[a-z]:\/projects\/app\/src\/main\.ts$/);
});

test('workspacePath accepts absolute paths that stay inside the workspace', () => {
  const resolved = workspacePath('D:/projects/app', 'D:/projects/app/src/util.ts');
  assert.equal(resolved.rel, 'src/util.ts');
});

test('workspacePath rejects traversal and absolute paths outside the workspace', () => {
  assert.throws(() => workspacePath('D:/projects/app', '../secrets.txt'), /outside the active workspace/i);
  assert.throws(() => workspacePath('D:/projects/app', 'D:/Windows/System32/drivers/etc/hosts'), /outside the active workspace/i);
  assert.throws(() => workspacePath('D:/projects/app', '/etc/passwd'), /outside the active workspace/i);
});

test('workspacePath blocks .git internals and invalid characters', () => {
  assert.throws(() => workspacePath('D:/projects/app', '.git/config'), /\.git/i);
  assert.throws(() => workspacePath('D:/projects/app', 'src/\u0000bad.ts'), /invalid character/i);
});

test('isPathInside compares case-insensitively on Windows-style paths', () => {
  assert.equal(isPathInside('D:/Projects/App', 'd:/projects/app/src/a.ts'), true);
  assert.equal(isPathInside('D:/Projects/App', 'D:/Projects/App2/a.ts'), false);
  assert.equal(isPathInside('D:/Projects/App', 'D:/Other/a.ts'), false);
});
