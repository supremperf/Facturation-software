import { build } from 'esbuild';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

await build({
  entryPoints: [path.join(root, 'scripts/preview-server.ts')],
  outfile: path.join(root, 'dist-preview/server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  external: ['electron', 'pdfkit', 'fontkit', 'sql.js'],
  logLevel: 'info',
  legalComments: 'none',
});

// eslint-disable-next-line no-console
console.log('Serveur d’aperçu construit (dist-preview/server.cjs).');
