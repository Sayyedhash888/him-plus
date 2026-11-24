import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JupyterLabConfig, JupyterLabPalette } from '../shared/types';

/**
 * Detects the user's JupyterLab look & feel from ~/.jupyter:
 *  - custom/current_theme.txt (custom theme name)
 *  - apputils themes settings (selected theme + adaptive mode)
 *  - notebook tracker settings (line numbers / wrap / brackets)
 *  - custom/custom.css design tokens (--jp-* variables)
 *  - installed labextensions (informational)
 *
 * Electron-free so it can be unit-tested against a fixture directory. HIM+ only
 * mirrors notebook *behaviour* from this; the visual theme stays HIM+.
 */

const FALLBACK: JupyterLabPalette = {
  background: '#f6f7f9',
  surface: '#f0f2f5',
  cellBackground: '#ffffff',
  border: '#dde0e5',
  text: '#1c1f24',
  muted: '#5f6672',
  accent: '#1f9e8b',
  accentSoft: '#e5f6f3',
  keyword: '#9a2849',
  string: '#1a7f37',
  number: '#0550ae',
  comment: '#6e7781',
  function: '#8250df',
  variable: '#24292e',
  type: '#953800',
};

export type { JupyterLabConfig, JupyterLabPalette };

function stripJsonComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/.*$/gm, '$1');
}

function readJsonc(file: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8'))) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

function readText(file: string): string | null {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

function cssVariables(css: string | null): Map<string, string> {
  const vars = new Map<string, string>();
  if (!css) return vars;
  const pattern = /--([a-zA-Z0-9-]+)\s*:\s*([^;}\n]+);?/g;
  for (const match of css.matchAll(pattern)) {
    vars.set(match[1], match[2].trim());
  }
  return vars;
}

function pick(vars: Map<string, string>, names: string[], fallback: string): string {
  for (const name of names) {
    const value = vars.get(name);
    if (value && !/var\(/i.test(value)) return value;
  }
  return fallback;
}

function isDark(color: string): boolean {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!hex) return false;
  const value = parseInt(hex[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}

function listExtensions(root: string): string[] {
  const dirs = [
    path.join(root, '..', 'share', 'jupyter', 'labextensions'),
    path.join(
      process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Python',
      'share',
      'jupyter',
      'labextensions',
    ),
  ];
  for (const dir of dirs) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const names: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name.startsWith('@')) {
            for (const scoped of fs.readdirSync(path.join(dir, entry.name), {
              withFileTypes: true,
            })) {
              if (scoped.isDirectory()) names.push(`${entry.name}/${scoped.name}`);
            }
          } else {
            names.push(entry.name);
          }
        }
      }
      if (names.length) return names.sort();
    } catch {
      // try next location
    }
  }
  return [];
}

export function detectJupyterConfig(
  root = path.join(os.homedir(), '.jupyter'),
): JupyterLabConfig {
  const themeName = readText(path.join(root, 'custom', 'current_theme.txt'))?.trim() || null;
  const themeSettings = readJsonc(
    path.join(
      root,
      'lab',
      'user-settings',
      '@jupyterlab',
      'apputils-extension',
      'themes.jupyterlab-settings',
    ),
  );
  const notebookSettings = readJsonc(
    path.join(
      root,
      'lab',
      'user-settings',
      '@jupyterlab',
      'notebook-extension',
      'tracker.jupyterlab-settings',
    ),
  );
  const palette: JupyterLabPalette = { ...FALLBACK };
  const css = readText(path.join(root, 'custom', 'custom.css'));
  const detected = Boolean(css || themeName || themeSettings || notebookSettings);
  if (css) {
    const vars = cssVariables(css);
    palette.background = pick(vars, ['jp-layout-color1', 'jp-layout-color0'], palette.background);
    palette.surface = pick(vars, ['jp-layout-color2', 'jp-layout-color1'], palette.surface);
    palette.cellBackground = pick(
      vars,
      ['jp-layout-color0', 'jp-mirror-editor-bg'],
      palette.cellBackground,
    );
    palette.border = pick(vars, ['jp-border-color0', 'jp-border-color1'], palette.border);
    palette.text = pick(vars, ['jp-ui-font-color0', 'jp-mirror-editor-color'], palette.text);
    palette.muted = pick(vars, ['jp-ui-font-color2', 'jp-ui-font-color3'], palette.muted);
    palette.accent = pick(vars, ['jp-brand-color1', 'jp-brand-color2'], palette.accent);
    palette.accentSoft = pick(vars, ['jp-brand-color4', 'jp-brand-color3'], palette.accentSoft);
    palette.keyword = pick(vars, ['jp-mirror-editor-keyword-color'], palette.keyword);
    palette.string = pick(vars, ['jp-mirror-editor-string-color'], palette.string);
    palette.number = pick(vars, ['jp-mirror-editor-number-color'], palette.number);
    palette.comment = pick(vars, ['jp-mirror-editor-comment-color'], palette.comment);
    palette.function = pick(
      vars,
      ['jp-mirror-editor-def-color', 'jp-mirror-editor-variable-2-color'],
      palette.function,
    );
    palette.variable = pick(vars, ['jp-mirror-editor-variable-color'], palette.variable);
    palette.type = pick(vars, ['jp-mirror-editor-type-color', 'jp-brand-color0'], palette.type);
  }
  const codeCellConfig =
    notebookSettings && typeof notebookSettings.codeCellConfig === 'object'
      ? (notebookSettings.codeCellConfig as Record<string, unknown>)
      : {};
  const cssVars = css ? cssVariables(css) : new Map<string, string>();
  const codeFontFamily = pick(cssVars, ['jp-code-font-family'], '');
  const codeFontSizeRaw = pick(cssVars, ['jp-code-font-size'], '');
  const codeFontSize = Number.parseFloat(codeFontSizeRaw) || null;
  return {
    detected,
    themeName:
      themeName || (typeof themeSettings?.theme === 'string' ? themeSettings.theme : null),
    dark: isDark(palette.background),
    codeFontFamily: codeFontFamily || null,
    codeFontSize,
    lineNumbers: codeCellConfig.lineNumbers === true,
    lineWrap: codeCellConfig.lineWrap === true,
    autoClosingBrackets: codeCellConfig.autoClosingBrackets !== false,
    palette,
    extensions: listExtensions(root),
    configRoot: detected ? root : null,
  };
}
