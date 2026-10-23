/**
 * Lance le serveur d'aperçu en s'assurant que la dernière version de
 * l'interface est construite (dist/renderer).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

if (!fs.existsSync(path.join(root, 'dist', 'renderer', 'index.html'))) {
  // eslint-disable-next-line no-console
  console.log("Interface non construite : exécution de « npm run build:renderer »…");
  const build = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:renderer'], {
    cwd: root,
    stdio: 'inherit',
  });
  await new Promise((resolve, reject) => {
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Build de l’interface échoué.'))));
  });
}

// Base d'aperçu persistante dans le dépôt (ignorée par git) : les données
// survivent aux redémarrages du serveur, contrairement à un dossier temporaire.
const dataDir = process.env.FACTUREPRO_PREVIEW_DIR ?? path.join(root, '.preview-data');

const child = spawn(process.execPath, [path.join(root, 'dist-preview', 'server.cjs')], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, FACTUREPRO_PREVIEW_DIR: dataDir },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
