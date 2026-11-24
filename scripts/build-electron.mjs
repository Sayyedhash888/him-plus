import { build } from 'esbuild';
import fs from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['electron/main.ts', 'electron/preload.ts'],
  outdir: 'dist-electron',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron', '@homebridge/node-pty-prebuilt-multiarch'],
  sourcemap: true,
  outExtension: { '.js': '.cjs' },
  logLevel: 'info',
};

async function copyBrandIcon() {
  try {
    await fs.mkdir('dist-electron', { recursive: true });
    await fs.copyFile('build/icon.png', 'dist-electron/icon.png');
  } catch {
    // The icon is optional until `npm run brand:icon` has been run.
  }
}

async function copySqlWasm() {
  await fs.mkdir('dist-electron', { recursive: true });
  await fs.copyFile('node_modules/sql.js/dist/sql-wasm.wasm', 'dist-electron/sql-wasm.wasm');
}

async function copyNotebookBridge() {
  await fs.mkdir('dist-electron', { recursive: true });
  await fs.copyFile('electron/nbKernelBridge.py', 'dist-electron/nbKernelBridge.py');
}

if (watch) {
  const { context } = await import('esbuild');
  const ctx = await context(options);
  await ctx.watch();
  await copyBrandIcon();
  await copySqlWasm();
  await copyNotebookBridge();
  console.log('[electron] watching…');
} else {
  await build(options);
  await copyBrandIcon();
  await copySqlWasm();
  await copyNotebookBridge();
}
