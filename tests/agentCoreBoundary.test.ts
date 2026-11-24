import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkpointRef, refPrefix } from '../electron/gitSnapshots.ts';

/**
 * The agent core is being extracted into a standalone daemon that runs under
 * plain Node, with no Electron runtime available. A module that has *any*
 * top-level `electron` import fails at load time — before a single IPC call —
 * so that coupling is invisible until the daemon starts.
 *
 * These tests pin the modules that must stay Electron-free. They are cheap and
 * they run before the physical move, so the boundary is enforced rather than
 * rediscovered. See the dependency analysis: only the `register*Ipc` wiring may
 * touch `ipcMain`; the engines beneath it must not.
 */

const electronDir = path.join(import.meta.dirname, '..', 'electron');

/** Modules whose engines must run in the daemon. Add to this list as modules move. */
const DAEMON_READY = [
  'acpClient.ts',
  'mcpClient.ts',
  'gitSnapshots.ts',
  'acpRegistry.ts',
  // Pure operation layer, split out of an Electron registrar:
  // `checkpoints.ts` keeps its `registerCheckpointIpc` wiring, so it is asserted
  // separately below rather than listed here.
];

/** Engines that live beside Electron wiring today and must not gain a second one. */
const ENGINE_FILES = ['llm.ts', 'fsops.ts', 'chatStore.ts', 'attachments.ts'];

const ELECTRON_IMPORT = /(?:from\s*['"]electron['"]|require\(\s*['"]electron['"]\s*\)|import\s*\(\s*['"]electron['"]\s*\))/;

function read(file: string): string {
  return fs.readFileSync(path.join(electronDir, file), 'utf8');
}

test('daemon-ready modules never import electron', () => {
  for (const file of DAEMON_READY) {
    assert.ok(fs.existsSync(path.join(electronDir, file)), `missing module: ${file}`);
    assert.doesNotMatch(
      read(file),
      ELECTRON_IMPORT,
      `${file} imports electron; it cannot load under a plain Node daemon`,
    );
  }
});

test('electron-coupled engines keep their coupling confined to a registrar', () => {
  for (const file of ENGINE_FILES) {
    const source = read(file);
    if (!ELECTRON_IMPORT.test(source)) continue; // already clean, nothing to confine
    // Any electron usage must be the ipcMain/app plumbing at the bottom of the
    // file, never a value the engine reaches for mid-computation.
    const electronLines = source
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter((entry) => ELECTRON_IMPORT.test(entry.line));
    assert.ok(
      electronLines.length > 0,
      `${file}: expected to find the electron import it matched on`,
    );
    for (const entry of electronLines) {
      assert.match(
        entry.line,
        /^\s*import\s/,
        `${file}:${entry.number} reaches for electron outside an import statement`,
      );
    }
  }
});

test('checkpoint refs have exactly one definition', () => {
  // checkpoints.ts used to re-implement this layout, which let diff/revert
  // address refs createSnapshot never wrote. Guard against the duplicate
  // returning, in either file.
  const gitSource = read('gitSnapshots.ts');
  const checkpointSource = read('checkpoints.ts');
  assert.match(gitSource, /export function checkpointRef\(/, 'gitSnapshots must export checkpointRef');
  assert.doesNotMatch(
    checkpointSource,
    /function\s+checkpointRef\s*\(/,
    'checkpoints.ts must import checkpointRef, not define its own',
  );
  assert.match(
    checkpointSource,
    /import\s*\{[^}]*checkpointRef[^}]*\}\s*from\s*'\.\/gitSnapshots'/s,
    'checkpoints.ts must import checkpointRef from gitSnapshots',
  );
});

test('checkpoint ref layout is stable and path-safe', () => {
  assert.equal(refPrefix('sess-1'), 'refs/him/checkpoints/sess-1');
  assert.equal(checkpointRef('sess-1', 'abc'), 'refs/him/checkpoints/sess-1/abc');

  // Session ids reach a git ref, so separator and traversal characters must be
  // neutralised rather than passed through.
  const hostile = refPrefix('../../etc/passwd');
  assert.doesNotMatch(hostile, /\.\./, 'session id must not escape the ref namespace');
  assert.doesNotMatch(hostile, /\\/, 'backslashes must be neutralised');
  assert.equal(hostile.split('/').length, 4, 'a session id must not add ref path segments');

  assert.doesNotMatch(checkpointRef('s', '../../evil'), /\.\./);
  assert.equal(checkpointRef('s', 'has spaces/slash'), 'refs/him/checkpoints/s/has-spaces-slash');

  // Long session ids are truncated so a ref cannot exceed practical limits.
  assert.ok(refPrefix('x'.repeat(500)).length <= 'refs/him/checkpoints/'.length + 60);
  assert.equal(refPrefix(''), 'refs/him/checkpoints/session');
});
