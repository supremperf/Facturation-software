import { cp, mkdir, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const ASSETS = path.join(ROOT, 'assets');

await mkdir(path.join(ASSETS, 'fonts'), { recursive: true });

const FONT_SOURCES = [
  ['node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf', 'DejaVuSans.ttf'],
  ['node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf', 'DejaVuSans-Bold.ttf'],
  ['node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Oblique.ttf', 'DejaVuSans-Oblique.ttf'],
];

for (const [from, to] of FONT_SOURCES) {
  const src = path.join(ROOT, from);
  try {
    await access(src);
    await cp(src, path.join(ASSETS, 'fonts', to));
  } catch {
    throw new Error(`Police manquante: ${from}. Lancez npm install.`);
  }
}

await writeFile(
  path.join(ASSETS, 'fonts', 'LICENSE.txt'),
  `DejaVu Fonts — licence Bitstream Vera / Arev (voir https://dejavu-fonts.github.io/License.html).
Ces polices sont embarquées dans les PDF générés par FacturePro afin de garantir
le rendu des caractères accentués français et du symbole euro.
`,
);

// L'icône de l'application est générée localement (PNG + ICO) : sans ce fichier
// electron-builder refuserait de produire l'installeur Windows.
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-icon.mjs')], { stdio: 'inherit' });

// eslint-disable-next-line no-console
console.log('Assets prepared (fonts + icons).');
