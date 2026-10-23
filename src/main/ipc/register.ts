import path from 'node:path';
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import { APP_EVENTS, IPC, type IpcChannel, type IpcEnvelope } from '@shared/ipc';
import type { AppServices } from '../services/app-services';
import { createIpcHandlers, dispatchIpc, type FileFilter, type IpcHost } from './handlers';

interface RegisterOptions {
  services: AppServices;
  getWindow: () => BrowserWindow | null;
  devServerUrl: string | null;
}

/**
 * Branche la couche IPC sur Electron. Le mapping métier vit dans
 * `handlers.ts` et reste testable sans Electron.
 */
export function registerIpc(options: RegisterOptions): void {
  const { services, getWindow, devServerUrl } = options;
  const logger = services.logger;

  const isTrustedSender = (url: string): boolean => {
    if (!url) return false;
    if (url.startsWith('app://facturepro')) return true;
    if (
      devServerUrl &&
      (url.startsWith(devServerUrl) || url.startsWith(devServerUrl.replace('localhost', '127.0.0.1')))
    ) {
      return true;
    }
    return process.env.NODE_ENV === 'development' && url.startsWith('file://');
  };

  const saveDialog = async (
    defaultFileName: string,
    filters: FileFilter[],
  ): Promise<string | null> => {
    const win = getWindow();
    const options: Electron.SaveDialogOptions = {
      title: 'Enregistrer sous',
      defaultPath: path.join(app.getPath('documents'), defaultFileName),
      filters,
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    return result.filePath;
  };

  const pickBackupFile = async (): Promise<string | null> => {
    const win = getWindow();
    const options: Electron.OpenDialogOptions = {
      title: 'Importer une sauvegarde',
      filters: [{ name: 'Sauvegarde FacturePro', extensions: ['zip'] }],
      properties: ['openFile'],
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  };

  const printPdfFile = async (filePath: string): Promise<{ printed: boolean; opened: boolean }> => {
    const printWindow = new BrowserWindow({
      show: false,
      width: 900,
      height: 1100,
      webPreferences: {
        plugins: true,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    try {
      await printWindow.loadURL(`file://${filePath.replace(/\\/g, '/')}`);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const printed = await new Promise<boolean>((resolve) => {
        printWindow.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
          if (!success) logger.warn(`Impression non aboutie : ${reason}`);
          resolve(success);
        });
      });
      if (!printed) {
        const error = await shell.openPath(filePath);
        return { printed: false, opened: !error };
      }
      return { printed: true, opened: false };
    } catch (error) {
      logger.warn('Impression directe impossible, ouverture du lecteur PDF.', error);
      const openError = await shell.openPath(filePath);
      return { printed: false, opened: !openError };
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy();
    }
  };

  const host: IpcHost = {
    saveFile: (defaultFileName, filters) => saveDialog(defaultFileName, filters),
    pickBackupFile,
    openPath: (target) => shell.openPath(target),
    openUrl: async (url) => {
      await shell.openExternal(url);
    },
    printPdf: (filePath) => printPdfFile(filePath),
    notifyDataRestored: () => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(APP_EVENTS.dataRestored, { restoredAt: new Date().toISOString() });
      }
    },
  };

  const handlers = createIpcHandlers(services, host, logger);

  const forbidden = (channel: IpcChannel, senderUrl: string): IpcEnvelope<never> => {
    logger.warn(`IPC refusé depuis une origine non fiable : ${senderUrl} (${channel})`);
    return {
      ok: false,
      error: { message: 'Origine non autorisée pour cette opération.', code: 'IPC_FORBIDDEN' },
    };
  };

  for (const channel of Object.values(IPC) as IpcChannel[]) {
    ipcMain.handle(channel, async (event, raw): Promise<IpcEnvelope<unknown>> => {
      const senderUrl = event.senderFrame?.url ?? event.sender.getURL();
      if (!isTrustedSender(senderUrl)) return forbidden(channel, senderUrl);
      return dispatchIpc(handlers, channel, raw, logger);
    });
  }
}
