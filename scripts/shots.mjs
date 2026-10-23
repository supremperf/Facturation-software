/**
 * Captures d'écran de documentation (navigateur headless).
 * Le serveur d'aperçu doit déjà tourner : npm run preview
 * Usage : node scripts/shots.mjs [dossier-de-sortie] [port]
 */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareChromiumEnv } from './chromium-env.mjs';

const outDir = path.resolve(process.argv[2] ?? 'docs/screenshots');
const port = process.argv[3] ?? process.env.PORT ?? '4173';
const base = `http://127.0.0.1:${port}`;

const PAGES = [
  ['/', 'tableau-de-bord'],
  ['/factures', 'factures'],
  ['/clients', 'clients'],
  ['/paiements', 'paiements'],
  ['/statistiques', 'statistiques'],
  ['/rapports', 'rapports'],
  ['/parametres', 'parametres'],
  ['/parametres/entreprise', 'identite-entreprise'],
  ['/sauvegardes', 'sauvegardes'],
];

fs.mkdirSync(outDir, { recursive: true });
prepareChromiumEnv();
const browser = await puppeteer.launch({
  args: [...chromium.args, '--lang=fr-FR'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
  timeout: 60_000,
  defaultViewport: { width: 1440, height: 940 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));

async function capture(route, name) {
  await page.goto(`${base}/#${route}`, { waitUntil: 'networkidle0' });
  await new Promise((resolve) => setTimeout(resolve, 1400));
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  // eslint-disable-next-line no-console
  console.log(`capture ${name}.png`);
}

for (const [route, name] of PAGES) await capture(route, name);

// Fiches détaillées : la première facture émise et le premier avoir.
const call = async (channel, payload = null) => {
  const response = await fetch(`${base}/api/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel, payload }),
  });
  const body = await response.json();
  return body.ok ? body.data : null;
};
const list = await call('invoices:list', { pageSize: 50 });
const invoice = list?.items.find((item) => item.type === 'invoice' && item.status !== 'draft');
const credit = list?.items.find((item) => item.type === 'credit_note');
if (invoice) await capture(`/factures/${invoice.id}`, 'facture-detail');
if (credit) await capture(`/factures/${credit.id}`, 'avoir-detail');

await browser.close();
if (errors.length > 0) {
  // eslint-disable-next-line no-console
  console.error('Erreurs JavaScript :', errors);
  process.exitCode = 1;
}
