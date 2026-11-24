import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACP_REGISTRY, acpRegistry, checkAcpHealth } from '../electron/acpRegistry.ts';
import { toAcpMcpServers } from '../shared/acp.ts';

test('ACP registry entries are valid and unique', () => {
  const ids = new Set<string>();
  for (const entry of ACP_REGISTRY) {
    assert.ok(entry.id.trim(), 'id required');
    assert.equal(ids.has(entry.id), false, `duplicate id ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.name.trim(), 'name required');
    assert.ok(entry.command.trim(), 'command required');
    assert.ok(Array.isArray(entry.args), 'args required');
    assert.ok(entry.installHint.trim(), 'install hint required');
  }
  assert.ok(ACP_REGISTRY.length >= 8, 'expected a useful registry');
  assert.equal(acpRegistry().length, ACP_REGISTRY.length);
});

test('ACP health reports missing commands', () => {
  const result = checkAcpHealth('definitely-not-a-real-command-xyz', []);
  assert.equal(result.ok, false);
  assert.match(result.error || '', /not found/i);
});

test('ACP health accepts commands on PATH', () => {
  const result = checkAcpHealth(process.platform === 'win32' ? 'cmd.exe' : 'sh', []);
  assert.equal(result.ok, true);
});

test('MCP configs convert to the ACP session/new shape', () => {
  const converted = toAcpMcpServers([
    { name: 'files', command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'abc' } },
    { name: '', command: 'ignored', args: [], env: {} },
  ]);
  assert.equal(converted.length, 1);
  assert.deepEqual(converted[0], {
    name: 'files',
    command: 'npx',
    args: ['-y', 'server'],
    env: [{ name: 'TOKEN', value: 'abc' }],
  });
});
