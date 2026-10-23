/**
 * Préparation de Chromium pour les tests headless.
 *
 * Le binaire fourni par @sparticuz/chromium est compilé pour Amazon Linux 2023 :
 * sur d'autres distributions il manque des bibliothèques système (libnss3,
 * libatk, etc.). Elles sont livrées dans `al2023.tar.br` ; on les extrait une
 * fois dans un dossier de travail et on pointe LD_LIBRARY_PATH dessus.
 *
 * Sur Windows/macOS (poste de développement), la fonction ne fait rien.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const CACHE_DIR = path.join(os.tmpdir(), 'facturepro-chromium-libs');

export function prepareChromiumEnv() {
  if (process.platform !== 'linux') return null;
  const libDir = path.join(CACHE_DIR, 'lib');
  if (fs.existsSync(libDir)) return withLibraryPath(libDir);

  const entry = require.resolve('@sparticuz/chromium');
  const archive = path.join(path.dirname(path.dirname(entry)), 'bin', 'al2023.tar.br');
  if (!fs.existsSync(archive)) return null;

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let extracted;
  try {
    // Décompression directe du tar (format ustar, pas de GNU longlink ici).
    const tar = zlib.brotliDecompressSync(fs.readFileSync(archive));
    extracted = extractTar(tar, CACHE_DIR);
  } catch (error) {
    console.warn(`[chromium] extraction impossible : ${error.message}`);
    return null;
  }
  if (!fs.existsSync(libDir)) {
    console.warn('[chromium] dossier lib absent après extraction');
    return null;
  }
  return withLibraryPath(libDir, extracted);
}

function withLibraryPath(libDir, count) {
  const current = process.env.LD_LIBRARY_PATH;
  process.env.LD_LIBRARY_PATH = current ? `${libDir}:${current}` : libDir;
  if (count !== undefined) {
    console.log(`[chromium] ${count} entrées extraites dans ${libDir}`);
  }
  return libDir;
}

/** Extraction minimale d'une archive tar non compressée. */
function extractTar(buffer, destination) {
  let offset = 0;
  let files = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156] || 48);
    const full = path.join(destination, prefix ? `${prefix}/${name}` : name);
    const relative = path.relative(destination, full);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`chemin d'archive invalide : ${name}`);
    }
    offset += 512;
    if (type === '5') {
      fs.mkdirSync(full, { recursive: true });
    } else if (type === '0' || type === '\0' || type === '') {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, buffer.subarray(offset, offset + size));
      if (name.endsWith('.so') || /\.so\.\d/.test(name)) {
        fs.chmodSync(full, 0o755);
      }
      files += 1;
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}
