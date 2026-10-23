/**
 * Test de bout en bout dans un vrai navigateur (Chromium headless).
 *
 * Parcours complet sur une base vierge :
 *   assistant de premier lancement → création d'un client → rédaction d'une
 *   facture → émission (numéro + PDF archivé) → encaissement → avoir →
 *   sauvegarde → export JSON.
 *
 * Le serveur d'aperçu exécute le backend réel (SQLite, PDF, conformité).
 * Lancement : npm run test:e2e
 * E2E_KEEP_DATA=1 (et éventuellement E2E_DATA_DIR=chemin) conserve la base créée,
 * ce qui permet de régénérer les captures d'écran de documentation.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { prepareChromiumEnv } from './chromium-env.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = Number(process.env.E2E_PORT ?? 4180);
const BASE = `http://127.0.0.1:${PORT}`;
const keepData = process.env.E2E_KEEP_DATA === '1';
const dataDir = process.env.E2E_DATA_DIR
  ? path.resolve(process.env.E2E_DATA_DIR)
  : fs.mkdtempSync(path.join(os.tmpdir(), 'facturepro-e2e-'));
if (process.env.E2E_DATA_DIR) fs.rmSync(dataDir, { recursive: true, force: true });
const shotsDir = path.join(ROOT, '.e2e-shots');

const results = [];
let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    results.push(`  ✓ ${label}`);
  } else {
    failures += 1;
    results.push(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForText(page, needle, timeout = 15000) {
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    { timeout },
    needle,
  );
}

async function clickByText(page, text, selector = 'button') {
  const handle = await page.evaluateHandle(
    (label, sel) => Array.from(document.querySelectorAll(sel)).find((el) => el.textContent?.trim().includes(label)),
    text,
    selector,
  );
  const element = handle.asElement();
  if (!element) throw new Error(`Élément introuvable : « ${text} »`);
  await element.click();
  handle.dispose();
  return element;
}

async function fill(page, selector, value) {
  await page.waitForSelector(selector, { timeout: 15000 });
  await page.click(selector);
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(selector, value, { delay: 8 });
  const typed = await page.$eval(selector, (element) => element.value);
  if (typed !== value) throw new Error(`Saisie incorrecte dans ${selector} : « ${typed} » au lieu de « ${value} »`);
}

async function main() {
  const server = spawn(process.execPath, [path.join(ROOT, 'dist-preview', 'server.cjs')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', FACTUREPRO_PREVIEW_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  server.stdout.on('data', (chunk) => serverLog.push(chunk.toString()));
  server.stderr.on('data', (chunk) => serverLog.push(chunk.toString()));

  const ready = async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`${BASE}/api/health`);
        if (response.ok) return;
      } catch {
        /* pas encore prêt */
      }
      await sleep(250);
    }
    throw new Error(`Serveur d'aperçu indisponible.\n${serverLog.join('')}`);
  };

  fs.mkdirSync(shotsDir, { recursive: true });
  prepareChromiumEnv();
  let browser = null;

  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, '--lang=fr-FR'],
      executablePath: await chromium.executablePath(),
      headless: 'shell',
      // Sans délai, un échec de lancement laisse le script suspendu indéfiniment.
      timeout: 60_000,
      defaultViewport: { width: 1440, height: 940 },
    });
    await ready();
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(String(error)));

    /* ------------------------- 1. Premier lancement ------------------------- */
    await page.goto(`${BASE}/#/`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Configurons votre espace');
    check('assistant de premier lancement affiché sur une base vierge', true);

    await fill(page, 'input[placeholder="Atelier Lumen SAS"]', 'Studio Orion SAS');
    await fill(page, 'input[placeholder="Atelier Lumen"]', 'Studio Orion');
    await fill(page, 'input[placeholder="732829320"]', '552100554');
    await fill(page, 'input[placeholder="12 rue des Lilas"]', '18 rue du Faubourg');
    await fill(page, 'input[placeholder="75011"]', '67000');
    await fill(page, 'input[placeholder="Paris"]', 'Strasbourg');
    await page.screenshot({ path: path.join(shotsDir, '01-premier-lancement.png') });
    await clickByText(page, "Créer mon espace");
    await waitForText(page, 'Bonjour');
    check('création de l’espace et arrivée sur le tableau de bord', true);
    await waitForText(page, 'Aucune facture pour le moment');
    check('état vide explicite sans donnée de démonstration', true);
    const emptyText = (await page.evaluate(() => document.body.innerText)).replace(/[\u202f\u00a0]/g, ' ');
    check(
      'aucun montant fictif affiché sur une base vide',
      emptyText.includes('0,00 €') && !/\d[\d\s]*\d,\d{2} €/.test(emptyText.replace(/0,00 €/g, '')),
    );
    await waitForText(page, 'Mentions légales à compléter');
    check('le tableau de bord signale les mentions légales encore vides', true);

    /* ------------------- 2 bis. Mentions légales (paramètres) -------------- */
    await page.goto(`${BASE}/#/parametres`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Mentions légales');
    await fill(page, 'input[aria-label="Taux des pénalités de retard"]', '10');
    await fill(page, 'input[aria-label="Escompte pour paiement anticipé"]', 'Aucun escompte accordé pour paiement anticipé.');
    await clickByText(page, 'Enregistrer les paramètres');
    await waitForText(page, 'Paramètres enregistrés');
    check('paramètres enregistrés (pénalités, escompte)', true);

    /* ------------------------ 3. Création client --------------------------- */
    await page.goto(`${BASE}/#/clients`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Votre carnet d’adresses est vide');
    await clickByText(page, 'Nouveau client');
    await waitForText(page, 'Raison sociale');
    await fill(page, 'input[placeholder="Société Martin"]', 'Société Martin');
    await fill(page, 'input[placeholder="Élodie"]', 'Julien');
    await fill(page, 'input[placeholder="Réné"]', 'Martin');
    await fill(page, 'input[placeholder="443061841"]', '443061841');
    await fill(page, 'input[placeholder="44306184100005"]', '44306184100005');
    await fill(page, 'input[placeholder="FR12345678901"]', 'FR64443061841');
    await fill(page, 'input[placeholder="contact@exemple.fr"]', 'compta@societe-martin.fr');
    await fill(page, 'input[placeholder="25 avenue de la République"]', '25 avenue de la République');
    await fill(page, 'input[placeholder="75011"]', '69003');
    await fill(page, 'input[placeholder="Paris"]', 'Lyon');
    await page.screenshot({ path: path.join(shotsDir, '02-nouveau-client.png') });
    await clickByText(page, 'Créer le client');
    await waitForText(page, 'Société Martin');
    check('client professionnel créé et listé', true);

    /* ----------------------- 4. Rédaction facture -------------------------- */
    await page.goto(`${BASE}/#/factures/nouvelle`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Choisir un client');
    await clickByText(page, 'Choisir un client');
    await waitForText(page, 'Sélectionner un client');
    await clickByText(page, 'Société Martin', '.client-option');
    await waitForText(page, 'Société Martin');

    await fill(page, 'input[aria-label="Désignation"]', 'Développement application web');
    await fill(page, 'input[aria-label="Prix unitaire HT"]', '500');
    await fill(page, 'input[aria-label="Quantité"]', '2');
    await page.screenshot({ path: path.join(shotsDir, '03-facture-en-cours.png') });

    await waitForText(page, 'Document conforme');
    check('contrôle de conformité vert avant émission', true);
    await clickByText(page, 'Émettre la facture');
    await page.waitForFunction(() => /^FAC-\d{4}-\d{4}$/.test(document.querySelector('h1')?.textContent ?? ''), {
      timeout: 20000,
    });
    const number = await page.$eval('h1', (element) => element.textContent.trim());
    const invoicePath = await page.evaluate(() => window.location.hash);
    check(`facture émise avec un numéro définitif (${number})`, /^FAC-\d{4}-\d{4}$/.test(number));
    check('redirection vers la fiche de la facture émise', invoicePath.startsWith('#/factures/'), invoicePath);
    await waitForText(page, 'Document conforme');

    /* ---------------------------- 5. PDF archivé --------------------------- */
    const pdfPath = path.join(dataDir, 'documents', 'Factures', String(new Date().getFullYear()), `${number}.pdf`);
    check('PDF archivé sur le disque à l’émission', fs.existsSync(pdfPath), pdfPath);
    if (fs.existsSync(pdfPath)) {
      const content = fs.readFileSync(pdfPath).subarray(0, 5).toString();
      check('le fichier archivé est un PDF valide', content === '%PDF-');
    }

    /* ------------------------------ 6. Avoir ------------------------------- */
    await clickByText(page, 'Créer un avoir');
    await waitForText(page, "Motif de l'avoir");
    const creditHash = await page.evaluate(() => window.location.hash);
    check(
      'écran de création d’avoir rattaché à la facture d’origine',
      creditHash.includes('type=credit_note') && creditHash.includes('source='),
      creditHash,
    );
    await page.screenshot({ path: path.join(shotsDir, '04-avoir.png') });

    await fill(
      page,
      'input[placeholder="Retour de marchandise, erreur de facturation, geste commercial…"]',
      'Geste commercial après échange avec le client.',
    );
    await fill(page, 'input[aria-label="Désignation"]', 'Geste commercial');
    await fill(page, 'input[aria-label="Prix unitaire HT"]', '100');
    await waitForText(page, 'Document conforme');
    await clickByText(page, 'Émettre l’avoir');
    await page.waitForFunction(() => /^AV-\d{4}-\d{4}$/.test(document.querySelector('h1')?.textContent ?? ''), {
      timeout: 20000,
    });
    const creditNumber = await page.$eval('h1', (element) => element.textContent.trim());
    check(`avoir émis avec un numéro distinct (${creditNumber})`, /^AV-\d{4}-\d{4}$/.test(creditNumber));
    const creditPdf = path.join(dataDir, 'documents', 'Avoirs', String(new Date().getFullYear()), `${creditNumber}.pdf`);
    check('PDF de l’avoir archivé', fs.existsSync(creditPdf), creditPdf);
    await page.screenshot({ path: path.join(shotsDir, '05-avoir-detail.png') });

    /* ---------------------------- 7. Encaissement -------------------------- */
    await page.goto(`${BASE}/${invoicePath}`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Encaisser');
    await clickByText(page, 'Encaisser');
    await waitForText(page, 'Montant');
    await sleep(400);
    await page.screenshot({ path: path.join(shotsDir, '06-encaissement.png') });
    await fill(page, 'input[aria-label="Montant encaissé"]', '500');
    await clickByText(page, 'Enregistrer le paiement');
    await waitForText(page, 'Partiellement payée');
    check('encaissement partiel : statut « Partiellement payée » recalculé', true);


    /* --------------------------- 8. Sauvegarde ----------------------------- */
    await page.goto(`${BASE}/#/sauvegardes`, { waitUntil: 'networkidle0' });
    await waitForText(page, 'Sauvegardes');
    await clickByText(page, 'Créer une sauvegarde');
    await waitForText(page, 'Sauvegarde-FacturePro');
    check('sauvegarde créée et listée', true);
    const backups = fs.readdirSync(path.join(dataDir, 'backups')).filter((name) => name.endsWith('.zip'));
    check('archive ZIP de sauvegarde présente sur le disque', backups.length > 0, backups.join(', '));

    /* ------------------------------- 9. Export ----------------------------- */
    await page.goto(`${BASE}/#/rapports`, { waitUntil: 'networkidle0' });
    await clickByText(page, 'Exporter en JSON');
    const exportFile = path.join(dataDir, 'exports', `FacturePro_donnees_${new Date().toISOString().slice(0, 10)}.json`);
    for (let attempt = 0; attempt < 40 && !fs.existsSync(exportFile); attempt += 1) await sleep(250);
    check('export JSON généré', fs.existsSync(exportFile));
    if (fs.existsSync(exportFile)) {
      const payload = JSON.parse(fs.readFileSync(exportFile, 'utf8'));
      check('l’export contient la facture émise', JSON.stringify(payload).includes(number));
    }
    await page.screenshot({ path: path.join(shotsDir, '06-rapports.png') });

    /* --------------------------- 10. Statistiques -------------------------- */
    await page.goto(`${BASE}/#/statistiques`, { waitUntil: 'networkidle0' });
    await waitForText(page, "Chiffre d'affaires HT");
    const stats = await page.evaluate(() => document.body.innerText);
    check('statistiques alimentées par la base (CA non nul)', !stats.includes("0,00 €\nChiffre d'affaires HT"));
    await page.screenshot({ path: path.join(shotsDir, '07-statistiques.png') });

    check('aucune erreur JavaScript pendant le parcours', consoleErrors.length === 0, consoleErrors.join(' | '));
  } catch (error) {
    if (browser) {
      const pages = await browser.pages();
      const current = pages[pages.length - 1];
      if (current) {
        await current.screenshot({ path: path.join(shotsDir, 'echec.png') }).catch(() => undefined);
        console.error(
          '\nDernier écran :\n',
          (await current.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 3000),
        );
      }
    } else {
      console.error('\nNavigateur indisponible :\n', serverLog.join(''));
    }
    throw error;
  } finally {
    // Tout nettoyage doit avoir lieu même si le lancement du navigateur échoue,
    // sinon le serveur d'aperçu reste vivant et le script ne se termine jamais.
    if (browser) await browser.close();
    server.kill('SIGTERM');
    await sleep(600);
    if (keepData) console.log(`\nDonnées conservées dans ${dataDir}`);
    else fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log('\nParcours de bout en bout (Chromium headless)\n');
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} vérifications réussies.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('\nÉchec du parcours E2E :', error);
  process.exitCode = 1;
});
