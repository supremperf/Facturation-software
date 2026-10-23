import fs from 'node:fs';
import path from 'node:path';
import {
  BrowserWindow,
  Menu,
  type MenuItemConstructorOptions,
  app,
  dialog,
  protocol,
  session,
  shell,
} from 'electron';
import { APP_EVENTS } from '@shared/ipc';
import { AppServices } from './services/app-services';
import { registerIpc } from './ipc/register';
import { createLogger, type Logger } from './infra/logger';

const APP_ID = 'fr.facturepro.app';
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL?.trim() || null;

app.setName('FacturePro');
app.setAppUserModelId(APP_ID);
// Interface et sélecteurs de date en français, quel que soit le système.
app.commandLine.appendSwitch('lang', 'fr-FR');
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

let services: AppServices | null = null;
let mainWindow: BrowserWindow | null = null;
let logger: Logger | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function dataDir(): string {
  return process.env.FACTUREPRO_DATA_DIR?.trim() || app.getPath('userData');
}

function rendererRoot(): string {
  return path.join(__dirname, '..', 'renderer');
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function registerAppProtocol(): void {
  const root = path.resolve(rendererRoot());
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'facturepro') {
        return new Response('Hôte inconnu', { status: 404 });
      }
      let pathname = decodeURIComponent(url.pathname);
      if (!pathname || pathname === '/') pathname = '/index.html';
      const filePath = path.resolve(path.join(root, pathname));
      if (filePath !== root && !filePath.startsWith(root + path.sep)) {
        return new Response('Accès refusé', { status: 403 });
      }
      const data = await fs.promises.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
          'Content-Security-Policy': CSP,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
        },
      });
    } catch {
      return new Response('Fichier introuvable', { status: 404 });
    }
  });
}

function buildApplicationMenu(): void {
  const send = (event: string, payload?: unknown) => {
    const win = BrowserWindow.getFocusedWindow() ?? mainWindow;
    win?.webContents.send(event, payload);
  };
  const viewMenu: MenuItemConstructorOptions[] = [
    { role: 'reload', label: 'Recharger' },
    { role: 'resetZoom', label: 'Taille normale' },
    { role: 'zoomIn', label: 'Agrandir' },
    { role: 'zoomOut', label: 'Réduire' },
    { type: 'separator' },
    { role: 'togglefullscreen', label: 'Plein écran' },
  ];
  if (!app.isPackaged) {
    viewMenu.splice(1, 0, { role: 'toggleDevTools', label: 'Outils de développement' });
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Nouvelle facture',
          accelerator: 'CmdOrCtrl+N',
          click: () => send(APP_EVENTS.menuNewInvoice),
        },
        {
          label: 'Paramètres',
          accelerator: 'CmdOrCtrl+,',
          click: () => send(APP_EVENTS.menuOpenSettings),
        },
        { type: 'separator' },
        {
          label: 'Ouvrir le dossier de données',
          click: () => {
            void shell.openPath(dataDir());
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' },
      ],
    },
    { role: 'editMenu', label: 'Édition' },
    { label: 'Affichage', submenu: viewMenu },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos de FacturePro',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'À propos de FacturePro',
              message: `FacturePro ${app.getVersion()}`,
              detail: [
                'Logiciel de facturation professionnel français, fonctionnant hors ligne.',
                '',
                `Données enregistrées dans : ${dataDir()}`,
                'Conservez des sauvegardes régulières (10 ans de conservation comptable).',
                '',
                'FacturePro génère des PDF lisibles. Il ne constitue pas une plateforme agréée',
                'de facturation électronique et ne transmet pas de factures structurées.',
              ].join('\n'),
              buttons: ['Fermer'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const preload = path.join(__dirname, '..', 'preload', 'index.js');
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#050b16',
    title: 'FacturePro',
    autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      plugins: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (['https:', 'http:'].includes(parsed.protocol)) void shell.openExternal(parsed.toString());
    } catch {
      /* URL invalide : ignorée */
    }
    return { action: 'deny' };
  });

  const allowedNavigation = (url: string): boolean => {
    if (url.startsWith('app://facturepro')) return true;
    if (DEV_SERVER_URL && url.startsWith(DEV_SERVER_URL)) return true;
    return false;
  };

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!allowedNavigation(url)) {
      event.preventDefault();
      try {
        const parsed = new URL(url);
        if (['https:', 'http:'].includes(parsed.protocol)) void shell.openExternal(parsed.toString());
      } catch {
        /* ignore */
      }
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadURL('app://facturepro/index.html');
  }
}

function configureSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
  });
}

async function bootstrap(): Promise<void> {
  const baseDir = dataDir();
  logger = createLogger(path.join(baseDir, 'logs'), 'main');
  logger.info(`Démarrage de FacturePro ${app.getVersion()} — données: ${baseDir}`);

  process.on('uncaughtException', (error) => {
    logger?.error('Exception non capturée.', error);
  });
  process.on('unhandledRejection', (reason) => {
    logger?.error('Promesse rejetée non gérée.', reason);
  });

  registerAppProtocol();
  configureSessionSecurity();

  const fontsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'fonts')
    : path.join(app.getAppPath(), 'assets', 'fonts');
  const wasmPath = path.join(__dirname, 'sql-wasm.wasm');

  try {
    services = await AppServices.create({
      baseDir,
      wasmPath,
      fontsDir,
      appVersion: app.getVersion(),
      logger,
    });
  } catch (error) {
    logger.error('Initialisation de la base impossible.', error);
    await dialog.showMessageBox({
      type: 'error',
      title: 'FacturePro — erreur au démarrage',
      message: 'Impossible d’ouvrir la base de données locale.',
      detail:
        error instanceof Error
          ? error.message
          : 'Vérifiez les droits d’accès au dossier de données et l’espace disque disponible.',
      buttons: ['Quitter'],
    });
    app.quit();
    return;
  }

  buildApplicationMenu();
  registerIpc({ services, getWindow: () => mainWindow, devServerUrl: DEV_SERVER_URL });
  createWindow();

  setTimeout(() => {
    try {
      services?.maybeAutoBackup();
    } catch (error) {
      logger?.warn('Sauvegarde automatique au démarrage impossible.', error);
    }
  }, 4000);
}

if (gotLock) {
  app.whenReady().then(bootstrap).catch((error) => {
    logger?.error('Erreur fatale au démarrage.', error);
    dialog.showErrorBox('FacturePro', 'Le logiciel n’a pas pu démarrer.');
    app.quit();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  try {
    services?.db.close();
  } catch {
    /* déjà fermée */
  }
});
