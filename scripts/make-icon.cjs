const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.commandLine.appendSwitch('force-device-scale-factor', '1');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildIco(png256) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png256.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png256]);
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'brand', 'him-icon.svg'),
    'utf8',
  );
  const svgData = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const size = 512;
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}
    img{display:block;width:${size}px;height:${size}px}
  </style></head><body><img src="${svgData}" /></body></html>`;
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await wait(450);
  const image = await win.webContents.capturePage();
  const outDir = path.join(__dirname, '..', 'build');
  fs.mkdirSync(outDir, { recursive: true });

  const png512 = image.toPNG();
  const png256 = image.resize({ width: 256, height: 256, quality: 'best' }).toPNG();
  fs.writeFileSync(path.join(outDir, 'icon.png'), png512);
  fs.writeFileSync(path.join(outDir, 'icon-256.png'), png256);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(png256));

  console.log('[brand] wrote build/icon.png, build/icon-256.png and build/icon.ico');
  win.destroy();
  app.quit();
});