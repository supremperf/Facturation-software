import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '..');
const outdir = path.join(root, 'dist/main');

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  // pdfkit/fontkit lisent leurs ressources (.afm, .icc) au runtime : ils doivent
  // rester externes et être dépaquetés de l'asar. Bundler pdfkit produit un
  // bundle CJS avec import.meta.url indéfini, ce qui casse le démarrage.
  external: ['electron', 'pdfkit', 'fontkit', 'sql.js'],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
  legalComments: 'none',
  minify: false,
};

await build({
  ...common,
  entryPoints: [path.join(root, 'src/main/index.ts')],
  outfile: path.join(outdir, 'index.js'),
});

await build({
  ...common,
  entryPoints: [path.join(root, 'src/preload/index.ts')],
  outfile: path.join(root, 'dist/preload/index.js'),
});

// sql.js needs its wasm binary next to the main bundle.
await cp(
  path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm'),
  path.join(outdir, 'sql-wasm.wasm'),
);

// eslint-disable-next-line no-console
console.log('Main + preload built.');
