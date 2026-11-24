import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pythonRunCommand, runCommandForTab } from '../src/lib/runCommand.ts';

test('builds a quoted python command for a Windows path', () => {
  assert.equal(
    pythonRunCommand('D:\\Zed\\Main.py'),
    'python "D:\\Zed\\Main.py"',
  );
});

test('builds a quoted python command for a path with spaces', () => {
  assert.equal(
    pythonRunCommand('D:\\Projects\\My App\\main.py'),
    'python "D:\\Projects\\My App\\main.py"',
  );
});

test('returns no run command for unsupported languages', () => {
  assert.equal(
    runCommandForTab({ language: 'typescript', path: 'D:\\Zed\\main.ts' }),
    null,
  );
});

test('returns a python command for python tabs', () => {
  assert.equal(
    runCommandForTab({ language: 'python', path: 'D:\\Zed\\Main.py' }),
    'python "D:\\Zed\\Main.py"',
  );
});