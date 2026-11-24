import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acpGrantKey,
  classifyAcpPermission,
  shouldAutoAllowAcp,
} from '../electron/acpPermission.ts';

test('classifies reads, writes and commands', () => {
  assert.equal(classifyAcpPermission({ kind: 'read', title: 'read_files' }), 'read');
  assert.equal(classifyAcpPermission({ kind: 'edit', title: 'Edit src/app.ts' }), 'write');
  assert.equal(
    classifyAcpPermission({ kind: 'execute', title: 'Run command', rawInput: { command: 'git status' } }),
    'execute',
  );
  assert.equal(classifyAcpPermission({ title: 'list directory' }), 'read');
  assert.equal(classifyAcpPermission({ title: 'mystery' }), 'other');
});

test('plan mode allows only reads', () => {
  assert.equal(shouldAutoAllowAcp('plan', 'read'), true);
  assert.equal(shouldAutoAllowAcp('plan', 'write'), false);
  assert.equal(shouldAutoAllowAcp('plan', 'execute'), false);
});

test('review mode auto-allows reads but asks for writes and commands', () => {
  assert.equal(shouldAutoAllowAcp('review', 'read'), true);
  assert.equal(shouldAutoAllowAcp('review', 'write'), false);
  assert.equal(shouldAutoAllowAcp('review', 'execute'), false);
  assert.equal(shouldAutoAllowAcp('review', 'other'), false);
});

test('auto mode allows everything through the client gate', () => {
  for (const kind of ['read', 'write', 'execute', 'other'] as const) {
    assert.equal(shouldAutoAllowAcp('auto', kind), true);
  }
});

test('grant keys include the kind and title', () => {
  assert.equal(acpGrantKey('write', { title: 'Edit src/app.ts' }), 'write:Edit src/app.ts');
  assert.equal(acpGrantKey('read', {}), 'read:tool');
});
