#!/usr/bin/env node
/**
 * Builds vscode-extension/him-plus-<version>.vsix without depending on vsce.
 *
 * A VSIX is an Open Packaging Conventions (OPC) zip: "[Content_Types].xml", a
 * "_rels/.rels" relationship part, an "extension.vsixmanifest", and the payload
 * under "extension/". This writes all four so the archive installs from the
 * HIM+ Code CLI, the Extensions view, or a plain unzip into data/extensions.
 *
 * Usage: node scripts/package-him-vscode-extension.mjs [--skip-build]
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const extDir = path.join(root, 'vscode-extension');
const manifestPath = path.join(extDir, 'package.json');
const skipBuild = process.argv.includes('--skip-build');

const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const { name, version, publisher, displayName, description, engines, icon } = pkg;

if (!name || !version || !publisher) {
  throw new Error('package.json must define name, version and publisher.');
}

// Payload allowlist. Everything the extension host needs at runtime, and nothing
// else: sources, node_modules and previous .vsix files stay out of the archive.
const payload = [
  'package.json',
  'dist/extension.js',
  'media/him-activity.svg',
  'media/icon.png',
  'themes/manifest.json',
  ...fs
    .readdirSync(path.join(extDir, 'themes'))
    .filter((entry) => entry.endsWith('.json') && entry !== 'manifest.json')
    .map((entry) => `themes/${entry}`),
];

for (const relative of payload) {
  if (!fs.existsSync(path.join(extDir, relative))) {
    throw new Error(`Missing payload file: vscode-extension/${relative}`);
  }
}

if (!skipBuild) {
  // Bundle with the local esbuild binary directly instead of shelling out to
  // `npm run build`, so this works from any cwd and without npm on PATH.
  const esbuild = path.join(extDir, 'node_modules', 'esbuild', 'bin', 'esbuild');
  if (!fs.existsSync(esbuild)) {
    throw new Error('esbuild is not installed in vscode-extension; run npm install there.');
  }
  const build = spawnSync(
    process.execPath,
    [
      esbuild,
      'src/extension.ts',
      '--bundle',
      '--platform=node',
      '--format=cjs',
      '--external:vscode',
      '--outfile=dist/extension.js',
    ],
    { cwd: extDir, stdio: 'inherit' },
  );
  if (build.status !== 0) throw new Error('esbuild bundling failed.');
}

const escapeXml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="${escapeXml(name)}" Version="${escapeXml(version)}" Publisher="${escapeXml(publisher)}" />
    <DisplayName>${escapeXml(displayName || name)}</DisplayName>
    <Description xml:space="preserve">${escapeXml(description)}</Description>
    <Tags>ai,chat,copilot,theme,color-theme</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${escapeXml(engines?.vscode || '*')}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.EnabledApiProposals" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExecutesCode" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
      <Property Id="Microsoft.VisualStudio.Services.Content.Pricing" Value="Free" />
    </Properties>
    ${icon ? `<Icon>extension/${escapeXml(icon)}</Icon>` : ''}
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    ${icon ? `<Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/${escapeXml(icon)}" Addressable="true" />` : ''}
  </Assets>
</PackageManifest>
`;

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" />
  <Default Extension="vsix" ContentType="application/octet-stream" />
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="svg" ContentType="image/svg+xml" />
  <Default Extension="png" ContentType="image/png" />
  <Default Extension="md" ContentType="text/markdown" />
  <Override PartName="/extension.vsixmanifest" ContentType="application/octet-stream" />
</Types>
`;

const relationships = `<?xml version="1.0" encoding="utf-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Type="http://schemas.microsoft.com/developer/vsx-schema/2011#/types/extension" Target="/extension.vsixmanifest" Id="R1" />
</Relationships>
`;

// Stage the OPC scaffolding next to the payload, then let Python's zipfile write
// the archive so entry names (including "[Content_Types].xml") are exact.
const stage = path.join(extDir, '.vsix-stage');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.writeFileSync(path.join(stage, 'extension.vsixmanifest'), vsixManifest);
fs.writeFileSync(path.join(stage, '[Content_Types].xml'), contentTypes);
fs.mkdirSync(path.join(stage, '_rels'), { recursive: true });
fs.writeFileSync(path.join(stage, '_rels', '.rels'), relationships);

const outFile = path.join(extDir, `${name}-${version}.vsix`);
const script = `
import os, sys, zipfile
stage = sys.argv[1]
ext = sys.argv[2]
out = sys.argv[3]
payload = sys.argv[4:]
fixed = [
    ('extension.vsixmanifest', os.path.join(stage, 'extension.vsixmanifest')),
    ('[Content_Types].xml', os.path.join(stage, '[Content_Types].xml')),
    ('_rels/.rels', os.path.join(stage, '_rels', '.rels')),
]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name, source in fixed:
        archive.write(source, name)
    for relative in payload:
        source = os.path.join(ext, relative)
        archive.write(source, 'extension/' + relative.replace(os.sep, '/'))
print('wrote', out)
`;

const zip = spawnSync(
  'python',
  ['-c', script, stage, extDir, outFile, ...payload],
  { stdio: 'inherit' },
);
fs.rmSync(stage, { recursive: true, force: true });
if (zip.status !== 0) throw new Error('Zipping the VSIX failed.');

const size = fs.statSync(outFile).size;
console.log(`\n${path.relative(root, outFile)}  (${(size / 1024).toFixed(1)} kB)`);
console.log(`payload: ${payload.length} files, engine ${engines?.vscode}`);
