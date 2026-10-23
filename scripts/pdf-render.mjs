/**
 * Rastérise un PDF en images PNG (une par page) pour vérifier à l'œil le rendu
 * A4 : logo, marges, pieds de page, mentions légales.
 *
 * Le rendu passe par pdf.js dans Chromium headless — aucune dépendance
 * système (poppler, ghostscript) n'est nécessaire.
 *
 * Usage :
 *   node scripts/pdf-render.mjs <fichier.pdf> [préfixe-de-sortie]
 *   node scripts/pdf-render.mjs .preview-data/documents/Factures/2026/FAC-2026-0001.pdf /tmp/facture
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareChromiumEnv } from './chromium-env.mjs';

const ROOT = process.cwd();
const pdfPath = path.resolve(process.argv[2] ?? '');
const prefix = process.argv[3] ?? path.join('/tmp', 'pdf-page');
if (!pdfPath || !fs.existsSync(pdfPath)) {
  console.error('Fichier PDF introuvable. Usage : node scripts/pdf-render.mjs <fichier.pdf> [préfixe]');
  process.exit(1);
}

const PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rendu PDF</title><style>
  body { margin: 0; background: #334155; }
  canvas { display: block; margin: 12px auto; box-shadow: 0 0 12px #0006; background: #fff; }
</style></head><body><div id="host"></div>
<script type="module">
  import * as pdfjs from '/node_modules/pdfjs-dist/build/pdf.min.mjs';
  pdfjs.GlobalWorkerOptions.workerSrc = '/node_modules/pdfjs-dist/build/pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ url: '/document.pdf' }).promise;
  const host = document.getElementById('host');
  for (let index = 1; index <= pdf.numPages; index += 1) {
    const page = await pdf.getPage(index);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.dataset.page = String(index);
    host.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
  window.__pages = pdf.numPages;
</script></body></html>`;

const port = Number(process.env.PDF_RENDER_PORT ?? 4188);
const server = http.createServer((request, response) => {
  const url = decodeURIComponent((request.url ?? '/').split('?')[0]);
  if (url === '/' || url === '/index.html') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
    return;
  }
  const file = url === '/document.pdf' ? pdfPath : path.join(ROOT, url);
  // Le serveur ne sert que le PDF demandé et les fichiers du dépôt.
  if (!file.startsWith(ROOT) && file !== pdfPath) {
    response.writeHead(403);
    response.end('Accès refusé');
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end(String(error));
      return;
    }
    const isPdf = file.endsWith('.pdf');
    response.writeHead(200, {
      'content-type': isPdf ? 'application/pdf' : 'text/javascript; charset=utf-8',
    });
    response.end(data);
  });
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

prepareChromiumEnv();
const browser = await puppeteer.launch({
  args: [...chromium.args],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  timeout: 60_000,
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 900, height: 1300 });
  page.on('pageerror', (error) => console.error('Erreur de rendu :', error.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__pages !== undefined, { timeout: 60_000 });
  const count = await page.evaluate(() => window.__pages);
  const canvases = await page.$$('canvas');
  for (let index = 0; index < canvases.length; index += 1) {
    await canvases[index].screenshot({ path: `${prefix}-${index + 1}.png` });
  }
  console.log(`${count} page(s) rendue(s) → ${prefix}-*.png`);
} finally {
  await browser.close();
  server.close();
}
