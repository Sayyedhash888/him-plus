import { ipcMain } from 'electron';
import { detectJupyterConfig } from './jupyterConfig';

export { detectJupyterConfig };

export function registerJupyterIpc(): void {
  ipcMain.handle('jupyter:detect', () => detectJupyterConfig());
}
