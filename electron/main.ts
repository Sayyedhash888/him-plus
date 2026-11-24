import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import path from 'node:path';
import { ConfigStore } from './config';
import { ChatStore, registerChatIpc } from './chatStore';
import { registerAttachmentIpc } from './attachments';
import { registerFsIpc } from './fsops';
import { registerFimIpc } from './fim';
import { disposeAcpClients, registerAcpIpc } from './acp';
import { disposeLsp, registerLspIpc } from './lsp';
import { registerGitIpc } from './git';
import { registerLlmIpc } from './llm';
import { registerShellIpc } from './shell';
import { disposeAllPtys, registerPtyIpc } from './pty';
import { disposeAllNotebooks, registerNotebookIpc } from './nb';
import { disposeDebugSession, registerDebugIpc } from './debug';
import { disposeCopilotSession, registerCopilotIpc } from './copilot';
import { disposeCliAgents, registerCliAgentIpc } from './cliAgent';
import { registerUpdateIpc } from './update';
import { registerJupyterIpc } from './jupyter';
import { registerCheckpointIpc } from './checkpoints';
import { registerWebIpc } from './web';
import { registerWatchIpc, stopWatching } from './watcher';
import { disposeMcpClients, registerMcpIpc } from './mcp';
import type { ConfirmOptions } from '../shared/types';

app.setName('HIM+');
if (process.env.HIM_CONFIG_DIR) {
  app.setPath('userData', process.env.HIM_CONFIG_DIR);
}
app.setAppUserModelId('com.himplus.desktop');

let mainWindow: BrowserWindow | null = null;
let configStore: ConfigStore;
let initialWorkspace: string | null = null;

{
  const index = process.argv.findIndex((arg) => arg === '--workspace' || arg === '-w');
  const candidate = index >= 0 ? process.argv[index + 1] : '';
  if (candidate && !candidate.startsWith('-')) {
    initialWorkspace = path.resolve(candidate);
  }
}

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function sendWindowControl(channel: string): void {
  if (!mainWindow) return;
  if (channel === 'window:minimize') mainWindow.minimize();
  if (channel === 'window:maximize') {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  }
  if (channel === 'window:close') mainWindow.close();
}

function registerAppIpc(): void {
  configStore = new ConfigStore();
  configStore.load();

  const chatStore = new ChatStore(path.join(app.getPath('userData'), 'chats.db'));
  registerChatIpc(chatStore);

  ipcMain.handle('config:get', () => configStore.load());
  ipcMain.handle('config:save', (_event, config) => {
    configStore.save(config);
  });
  ipcMain.handle('config:path', () => configStore.getPath());
  ipcMain.handle('config:reveal', () => {
    shell.showItemInFolder(configStore.getPath());
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const config = configStore.load();
    const defaultPath = config.lastWorkspace || app.getPath('documents');
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Open workspace',
      buttonLabel: 'Open workspace',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath,
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle('dialog:confirm', async (_event, options: ConfirmOptions) => {
    const result = await dialog.showMessageBox(mainWindow!, {
      type: options.danger ? 'warning' : 'question',
      title: options.title || 'HIM+',
      message: options.message,
      detail: options.detail,
      buttons: [options.confirmLabel || 'Confirm', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    return result.response === 0;
  });

  ipcMain.on('window:minimize', () => sendWindowControl('window:minimize'));
  ipcMain.on('window:maximize', () => sendWindowControl('window:maximize'));
  ipcMain.on('window:close', () => sendWindowControl('window:close'));
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false);

  ipcMain.handle('app:initialWorkspace', () => {
    const workspace = initialWorkspace;
    initialWorkspace = null;
    return workspace;
  });

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL.');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Only http(s) links can be opened externally.');
    }
    await shell.openExternal(parsed.toString());
  });

  ipcMain.on('app:showItemInFolder', (_event, itemPath: string) => {
    if (typeof itemPath === 'string' && itemPath.trim()) shell.showItemInFolder(itemPath);
  });
}

function registerFeatureIpc(): void {
  registerFsIpc();
  registerAttachmentIpc();
  registerGitIpc();
  registerLlmIpc();
  registerFimIpc();
  registerAcpIpc();
  registerWebIpc();
  registerWatchIpc();
  registerMcpIpc();
  registerLspIpc();
  registerPtyIpc();
  registerNotebookIpc();
  registerDebugIpc();
  registerCopilotIpc();
  registerCliAgentIpc();
  registerUpdateIpc();
  registerJupyterIpc();
  registerCheckpointIpc();
  registerShellIpc();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    frame: false,
    backgroundColor: '#080808',
    title: 'HIM+',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        void shell.openExternal(parsed.toString());
      }
    } catch {
      // ignore
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl && url.startsWith(devUrl)) return;
    if (url.startsWith('file://')) return;
    event.preventDefault();
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      mainWindow?.webContents.toggleDevTools();
      event.preventDefault();
    }
    if (process.env.VITE_DEV_SERVER_URL && (input.control || input.meta) && input.key.toLowerCase() === 'r') {
      mainWindow?.webContents.reload();
      event.preventDefault();
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized', false);
  });
}

app.whenReady().then(() => {
  registerAppIpc();
  registerFeatureIpc();

  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  stopWatching();
  disposeCliAgents();
  disposeCopilotSession();
  disposeDebugSession();
  disposeAllNotebooks();
  disposeAllPtys();
  disposeLsp();
  disposeMcpClients();
  disposeAcpClients();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
