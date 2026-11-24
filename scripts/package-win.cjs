const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
const releaseRoot = path.join(root, 'release');
const outDir = path.join(releaseRoot, 'HIM+-win32-x64');
const appResources = path.join(outDir, 'resources', 'app');
const builtIndex = path.join(root, 'dist', 'index.html');
const builtMain = path.join(root, 'dist-electron', 'main.cjs');

if (!fs.existsSync(builtIndex) || !fs.existsSync(builtMain)) {
  console.error('Build output missing. Run "npm run build" before packaging.');
  process.exit(1);
}
if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('Electron runtime is missing. Reinstall dependencies first.');
  process.exit(1);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.cpSync(electronDist, outDir, { recursive: true });

const defaultApp = path.join(outDir, 'resources', 'default_app.asar');
fs.rmSync(defaultApp, { force: true });

const sourceExe = path.join(outDir, 'electron.exe');
const targetExe = path.join(outDir, 'HIM+.exe');
fs.renameSync(sourceExe, targetExe);

fs.mkdirSync(appResources, { recursive: true });
fs.cpSync(path.join(root, 'dist'), path.join(appResources, 'dist'), { recursive: true });
fs.cpSync(path.join(root, 'dist-electron'), path.join(appResources, 'dist-electron'), {
  recursive: true,
});
for (const mapFile of ['main.cjs.map', 'preload.cjs.map']) {
  fs.rmSync(path.join(appResources, 'dist-electron', mapFile), { force: true });
}

// Native PTY module: shipped as-is because its prebuilt .node binaries must sit
// on disk and are required at runtime (esbuild keeps it external).
const ptyModules = [
  ['@homebridge', 'node-pty-prebuilt-multiarch'],
  ['@github', 'copilot-language-server'],
];
for (const segments of ptyModules) {
  const source = path.join(root, 'node_modules', ...segments);
  if (!fs.existsSync(source)) {
    console.warn(`Skipping missing native module: ${segments.join('/')}`);
    continue;
  }
  const target = path.join(appResources, 'node_modules', ...segments);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
}

fs.writeFileSync(
  path.join(appResources, 'package.json'),
  JSON.stringify(
    {
      name: 'him-plus',
      productName: 'HIM+',
      version: '0.1.0',
      description: 'HIM+ — Integrated development environment with AI agents.',
      main: 'dist-electron/main.cjs',
      author: 'HIM+',
    },
    null,
    2,
  ),
);

const iconPng = path.join(root, 'build', 'icon.png');
const iconIco = path.join(root, 'build', 'icon.ico');
if (fs.existsSync(iconPng)) {
  fs.copyFileSync(iconPng, path.join(outDir, 'HIM+ icon.png'));
}
if (fs.existsSync(iconIco)) {
  fs.copyFileSync(iconIco, path.join(outDir, 'HIM+.ico'));
}

const executablePath = targetExe;
if (!fs.existsSync(executablePath)) {
  throw new Error('Packaged executable was not created.');
}

// Release integrity: publish a standard sha256sum-style checksum next to the
// executable so users and CI can verify the unsigned artifact after download.
const checksum = crypto.createHash('sha256').update(fs.readFileSync(executablePath)).digest('hex');
const checksumPath = path.join(outDir, 'SHA256SUMS.txt');
fs.writeFileSync(checksumPath, `${checksum}  ${path.basename(executablePath)}\n`);

console.log('');
console.log('HIM+ portable app created:');
console.log(`  ${executablePath}`);
console.log('');
console.log('Start Menu shortcut is created by the desktop install step on the host machine.');
console.log('');
console.log('SHA-256 checksum written:');
console.log(`  ${checksumPath}`);
console.log(`  ${checksum}  ${path.basename(executablePath)}`);