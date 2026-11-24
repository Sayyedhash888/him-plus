import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectJupyterConfig } from '../electron/jupyterConfig.ts';

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'him-jupyter-'));
  fs.mkdirSync(path.join(root, 'custom'), { recursive: true });
  fs.mkdirSync(
    path.join(root, 'lab', 'user-settings', '@jupyterlab', 'apputils-extension'),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(root, 'lab', 'user-settings', '@jupyterlab', 'notebook-extension'),
    { recursive: true },
  );
  fs.writeFileSync(path.join(root, 'custom', 'current_theme.txt'), 'maroon-bird\n');
  fs.writeFileSync(
    path.join(root, 'custom', 'custom.css'),
    [
      ':root {',
      '  --jp-layout-color0: #ffffff;',
      '  --jp-layout-color1: #f6f7f9;',
      '  --jp-layout-color2: #f0f2f5;',
      '  --jp-border-color0: #dde0e5;',
      '  --jp-ui-font-color0: #1c1f24;',
      '  --jp-ui-font-color2: #5f6672;',
      '  --jp-brand-color1: #1f9e8b;',
      '  --jp-brand-color4: #e5f6f3;',
      '  --jp-mirror-editor-keyword-color: #9a2849;',
      '  --jp-code-font-size: 13px;',
      '}',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(
      root,
      'lab',
      'user-settings',
      '@jupyterlab',
      'notebook-extension',
      'tracker.jupyterlab-settings',
    ),
    JSON.stringify({
      autoStartDefaultKernel: true,
      codeCellConfig: { lineNumbers: false, lineWrap: false, autoClosingBrackets: true },
    }),
  );
  return root;
}

test('detects a custom JupyterLab theme and notebook behaviour', () => {
  const root = fixture();
  try {
    const config = detectJupyterConfig(root);
    assert.equal(config.detected, true);
    assert.equal(config.themeName, 'maroon-bird');
    assert.equal(config.lineNumbers, false);
    assert.equal(config.lineWrap, false);
    assert.equal(config.autoClosingBrackets, true);
    assert.equal(config.palette.accent, '#1f9e8b');
    assert.equal(config.palette.keyword, '#9a2849');
    assert.equal(config.dark, false);
    assert.equal(config.codeFontSize, 13);
    assert.equal(config.configRoot, root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('handles a missing Jupyter configuration gracefully', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'him-jupyter-empty-'));
  try {
    const config = detectJupyterConfig(root);
    assert.equal(config.detected, false);
    assert.equal(config.lineNumbers, false);
    assert.equal(config.autoClosingBrackets, true);
    assert.equal(config.configRoot, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
