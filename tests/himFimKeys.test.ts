import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decryptEncPayload,
  resolveApiKey,
  resetHimKeyCache,
} from '../vscode-extension/src/himConfig.ts';
import { readFimState, writeFimState } from '../vscode-extension/src/himConfigEdit.ts';

/**
 * These cover the two bugs that made HIM+ autocomplete fail silently:
 * the at-rest `enc:` key was sent to the provider as ciphertext (HTTP 401), and
 * nothing surfaced that `fim.enabled` was false in the app's config.json.
 */

/** Mirrors Electron's safeStorage layout: "v10" | nonce | ciphertext | tag. */
function sealPayload(plaintext: string, key: Buffer): string {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${Buffer.concat([Buffer.from('v10', 'ascii'), nonce, ciphertext, tag]).toString('base64')}`;
}

const KEY = crypto.randomBytes(32);

test('decrypts an Electron safeStorage v10 payload', () => {
  assert.equal(decryptEncPayload(sealPayload('wand-secret', KEY), KEY), 'wand-secret');
});

test('passes through values that are not encrypted', () => {
  assert.equal(decryptEncPayload('wand-plain', KEY), 'wand-plain');
});

test('rejects a tampered payload instead of returning junk', () => {
  const sealed = sealPayload('wand-secret', KEY);
  const payload = Buffer.from(sealed.slice('enc:'.length), 'base64');
  payload[payload.length - 1] ^= 0xff; // corrupt the GCM tag
  assert.throws(() => decryptEncPayload(`enc:${payload.toString('base64')}`, KEY));
});

test('rejects an unknown payload version', () => {
  const payload = Buffer.concat([Buffer.from('v11', 'ascii'), Buffer.alloc(40, 1)]);
  assert.throws(
    () => decryptEncPayload(`enc:${payload.toString('base64')}`, KEY),
    /Unsupported HIM\+ key format/,
  );
});

test('rejects a truncated payload', () => {
  const payload = Buffer.concat([Buffer.from('v10', 'ascii'), Buffer.alloc(8, 1)]);
  assert.throws(
    () => decryptEncPayload(`enc:${payload.toString('base64')}`, KEY),
    /truncated/,
  );
});

test('an explicit apiKey override wins over the stored key', async () => {
  resetHimKeyCache();
  const resolved = await resolveApiKey('enc:anything', {
    configDir: path.join(os.tmpdir(), 'him-plus-no-such-dir'),
    override: '  plain-override  ',
  });
  assert.equal(resolved, 'plain-override');
});

test('plaintext and empty stored keys resolve without touching DPAPI', async () => {
  resetHimKeyCache();
  const missing = path.join(os.tmpdir(), 'him-plus-no-such-dir');
  assert.equal(await resolveApiKey('wand-plain', { configDir: missing }), 'wand-plain');
  assert.equal(await resolveApiKey('', { configDir: missing }), '');
});

test('an unwrappable key resolves to null so callers can explain why', async () => {
  resetHimKeyCache();
  const synthetic = `enc:${Buffer.concat([
    Buffer.from('v10', 'ascii'),
    Buffer.alloc(12, 7),
    Buffer.alloc(32, 9),
    Buffer.alloc(16, 3),
  ]).toString('base64')}`;
  const resolved = await resolveApiKey(synthetic, {
    configDir: path.join(os.tmpdir(), 'him-plus-no-such-dir'),
  });
  assert.equal(resolved, null);
});

test('readFimState tolerates a missing or malformed config', () => {
  const missing = path.join(os.tmpdir(), 'him-plus-absent-config.json');
  assert.deepEqual(readFimState(missing), {
    found: false,
    enabled: false,
    mode: 'chat',
    model: '',
  });
  const broken = path.join(os.tmpdir(), `him-plus-broken-${process.pid}.json`);
  fs.writeFileSync(broken, '{ not json', 'utf8');
  try {
    assert.equal(readFimState(broken).found, false);
  } finally {
    fs.rmSync(broken, { force: true });
  }
});

test('writeFimState preserves unrelated content and only edits fim.enabled', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'him-plus-config-'));
  const file = path.join(dir, 'config.json');
  const original = JSON.stringify(
    {
      version: 1,
      providers: [
        {
          id: 'p1',
          name: 'Custom provider',
          baseUrl: 'https://example.test/v1',
          apiKey: 'enc:ENCRYPTED-BLOB',
          headers: {},
          models: [{ id: 'm1', enabled: true }],
        },
      ],
      defaults: { primary: { providerId: 'p1', modelId: 'm1' }, fast: null, planning: null },
      prefs: { mode: 'agent', theme: 'graphite' },
      fim: { enabled: false, mode: 'chat', model: { providerId: 'p1', modelId: 'm1' } },
      copilot: { enabled: true },
    },
    null,
    2,
  );
  fs.writeFileSync(file, original, 'utf8');

  try {
    assert.deepEqual(readFimState(file), {
      found: true,
      enabled: false,
      mode: 'chat',
      model: 'm1',
    });

    assert.deepEqual(writeFimState(file, { enabled: true }), { ok: true });

    const edited = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(edited);
    assert.equal(parsed.fim.enabled, true);
    // Everything else must round-trip untouched, key material included.
    assert.equal(parsed.providers[0].apiKey, 'enc:ENCRYPTED-BLOB');
    assert.deepEqual(parsed.defaults, JSON.parse(original).defaults);
    assert.deepEqual(parsed.prefs, JSON.parse(original).prefs);
    assert.deepEqual(parsed.copilot, JSON.parse(original).copilot);
    const before = original.split('\n');
    const after = edited.split('\n');
    assert.equal(before.length, after.length);
    assert.equal(before.filter((line, index) => line !== after[index]).length, 1);

    assert.deepEqual(writeFimState(file, { mode: 'fim' }), { ok: true });
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).fim.mode, 'fim');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeFimState refuses a config it cannot edit precisely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'him-plus-config-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, providers: [] }), 'utf8');
  try {
    const result = writeFimState(file, { enabled: true });
    assert.equal(result.ok, false);
    // The file must be byte-identical after a refusal.
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify({ version: 1, providers: [] }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
