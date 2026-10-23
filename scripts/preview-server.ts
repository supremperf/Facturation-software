/**
 * Serveur d'aperçu de développement.
 *
 * Il exécute le VRAI backend (SQLite sur disque, moteur de conformité, PDF
 * DejaVu) et expose la même couche IPC que le preload Electron, via HTTP.
 * Objectif : pouvoir parcourir l'interface dans un navigateur sans binaire
 * Electron. Ce fichier n'est jamais empaqueté dans l'application.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { IPC, type IpcChannel } from '../src/shared/ipc';
import { createLogger } from '../src/main/infra/logger';
import { AppServices } from '../src/main/services/app-services';
import { createIpcHandlers, dispatchIpc, type IpcHost } from '../src/main/ipc/handlers';

const ROOT = path.resolve(__dirname, '..');
const RENDERER_DIR = path.join(ROOT, 'dist', 'renderer');
const DATA_DIR = process.env.FACTUREPRO_PREVIEW_DIR ?? '/tmp/facturepro-preview';
const EXPORT_DIR = path.join(DATA_DIR, 'exports');
const PORT = Number(process.env.PORT ?? 4173);
// 0.0.0.0 par défaut : le serveur d'aperçu doit rester joignable depuis le
// navigateur de l'utilisateur (proxy de prévisualisation), pas seulement en
// local. Il ne sert que les données locales de démonstration.
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME: Record<string, string> = {
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
};

const BRIDGE = `(() => {
  window.facturepro = {
    invoke: async (channel, payload) => {
      try {
        const response = await fetch('/api/invoke', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ channel, payload }),
        });
        if (!response.ok) {
          return { ok: false, error: { message: 'Serveur d’aperçu indisponible (' + response.status + ').', code: 'HTTP_' + response.status } };
        }
        return await response.json();
      } catch (error) {
        return { ok: false, error: { message: String(error && error.message ? error.message : error), code: 'NETWORK' } };
      }
    },
    on: () => () => {},
    platform: 'web-preview',
    versions: { electron: 'aperçu', chrome: navigator.userAgent, node: 'aperçu' },
  };
})();`;

let services: AppServices | null = null;

function safeResolve(root: string, requestPath: string): string | null {
  const decoded = decodeURIComponent(requestPath.split('?')[0] ?? '/');
  const relative = decoded === '/' ? '/index.html' : decoded;
  const target = path.resolve(path.join(root, relative));
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(payload);
}

function readBody(request: IncomingMessage, limit = 60 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Charge utile trop volumineuse.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(EXPORT_DIR, { recursive: true });

  const logger = createLogger(path.join(DATA_DIR, 'logs'), 'preview');
  services = await AppServices.create({
    baseDir: DATA_DIR,
    wasmPath: path.join(ROOT, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'),
    fontsDir: path.join(ROOT, 'assets', 'fonts'),
    appVersion: 'aperçu',
    logger,
  });

  const host: IpcHost = {
    saveFile: async (fileName) => {
      const safeName = path.basename(fileName).replace(/[^\w.\- ]+/g, '_');
      const target = path.join(EXPORT_DIR, safeName);
      logger.info(`Export d'aperçu : ${target}`);
      return target;
    },
    pickBackupFile: async () => null,
    openPath: async () => '',
    openUrl: async () => undefined,
    printPdf: async () => ({ printed: false, opened: false }),
    notifyDataRestored: () => undefined,
  };
  const handlers = createIpcHandlers(services, host, logger);

  const server = http.createServer(async (request, response) => {
    const url = request.url ?? '/';

    if (url === '/api/health') {
      json(response, 200, {
        ok: true,
        version: services!.appInfo().version,
        database: services!.getSettings().setupCompleted,
      });
      return;
    }

    if (url === '/api/invoke' && request.method === 'POST') {
      try {
        const parsed = JSON.parse(await readBody(request)) as { channel?: string; payload?: unknown };
        const known = (Object.values(IPC) as string[]).includes(parsed.channel ?? '');
        if (!known) {
          json(response, 200, { ok: false, error: { message: 'Canal inconnu.', code: 'UNKNOWN_CHANNEL' } });
          return;
        }
        const envelope = await dispatchIpc(handlers, parsed.channel as IpcChannel, parsed.payload, logger);
        json(response, 200, envelope);
      } catch (error) {
        logger.error('Requête IPC invalide.', error);
        json(response, 200, {
          ok: false,
          error: { message: error instanceof Error ? error.message : 'Requête invalide.', code: 'BAD_REQUEST' },
        });
      }
      return;
    }

    if (url === '/__bridge.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      response.end(BRIDGE);
      return;
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }

    const filePath = safeResolve(RENDERER_DIR, url);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Fichier introuvable. Lancez « npm run build:renderer ».');
      return;
    }

    let data = fs.readFileSync(filePath);
    if (filePath.endsWith('index.html')) {
      data = Buffer.from(
        data
          .toString('utf8')
          .replace('<head>', '<head>\n    <script src="/__bridge.js"></script>')
          .replace(
            '</head>',
            '    <meta name="facturepro-preview" content="Aperçu navigateur — backend réel, données locales de démonstration vides." />\n  </head>',
          ),
      );
    }
    response.writeHead(200, {
      'content-type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : data);
  });

  server.listen(PORT, HOST, () => {
    logger.info(`Serveur d'aperçu prêt sur http://${HOST}:${PORT} — données: ${DATA_DIR}`);
    // eslint-disable-next-line no-console
    console.log(`Aperçu FacturePro : http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    server.close();
    void services?.dispose().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Échec du serveur d’aperçu.', error);
  process.exit(1);
});
