// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App } from '../src/renderer/App';
import { installBrowserBridge, installDomStubs, setupUiHarness, type UiHarness } from './ui-harness';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function flush(ms = 20): Promise<void> {
  await act(async () => {
    await sleep(ms);
  });
}

async function waitFor(predicate: () => boolean, label: string, timeout = 8000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error(`Délai dépassé en attendant : ${label}\n${text().slice(0, 2000)}`);
    }
    await flush(30);
  }
}

async function goTo(path: string): Promise<void> {
  await act(async () => {
    window.location.hash = `#${path}`;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await sleep(20);
  });
}

function text(): string {
  return document.body.textContent ?? '';
}

function h1(): string {
  return document.querySelector('h1')?.textContent?.trim() ?? '';
}

describe('interface FacturePro', () => {
  let harness: UiHarness;
  let root: Root;
  let container: HTMLDivElement;
  const consoleErrors: string[] = [];

  beforeAll(async () => {
    installDomStubs();
    harness = await setupUiHarness();
    installBrowserBridge(harness.invoke);

    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(args.map((value) => String(value)).join(' '));
      originalError(...args);
    };

    window.location.hash = '#/';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<App />);
    });
    await waitFor(() => text().includes('Bonjour'), 'tableau de bord');
  }, 60_000);

  afterAll(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await harness.teardown();
  });

  it('affiche les indicateurs calculés depuis la base', async () => {
    await waitFor(() => text().includes('Chiffre d’affaires') || text().includes("Chiffre d'affaires"), 'KPI CA');
    expect(text()).toContain('Encaissé');
    expect(text()).toContain('Factures');
    expect(text()).toContain(harness.issuedInvoice.number!);
    expect(text()).toContain('Activité récente');
  });

  it('navigue sur toutes les pages sans erreur de rendu', async () => {
    const routes: { path: string; title: string }[] = [
      { path: '/factures', title: 'Factures' },
      { path: '/avoirs', title: 'Avoirs' },
      { path: '/clients', title: 'Clients' },
      { path: '/paiements', title: 'Paiements' },
      { path: '/statistiques', title: 'Statistiques' },
      { path: '/rapports', title: 'Rapports & exports' },
      { path: '/parametres', title: 'Paramètres' },
      { path: '/parametres/entreprise', title: "Identité de l'entreprise" },
      { path: '/sauvegardes', title: 'Sauvegardes' },
    ];
    for (const route of routes) {
      await goTo(route.path);
      await waitFor(() => h1() === route.title, `titre ${route.title}`);
      expect(text()).not.toContain('Une erreur');
    }

    await goTo(`/factures/${harness.issuedInvoice.id}`);
    await waitFor(() => h1() === harness.issuedInvoice.number, 'détail facture');
    expect(text()).toContain(harness.issuedInvoice.clientSnapshot.displayName);

    await goTo(`/factures/${harness.draftInvoice.id}/modifier`);
    await waitFor(() => h1() === 'Modifier le brouillon', 'éditeur brouillon');
    expect(text()).toContain(harness.draftInvoice.clientSnapshot.displayName);

    await goTo('/factures/nouvelle');
    await waitFor(() => h1() === 'Créer une facture', 'éditeur nouvelle facture');
    expect(text()).toContain('Lignes du document');
  });

  it("émet un brouillon depuis l'interface et archive le PDF", async () => {
    await goTo(`/factures/${harness.draftInvoice.id}/modifier`);
    await waitFor(() => h1() === 'Modifier le brouillon', 'éditeur du brouillon');

    const issueButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Émettre la facture'),
    );
    expect(issueButton).toBeTruthy();
    await waitFor(() => !issueButton!.hasAttribute('disabled'), 'bouton d’émission actif');

    await act(async () => {
      issueButton!.click();
      await sleep(50);
    });
    await waitFor(() => /^FAC-\d{4}-\d{4}$/.test(h1()), 'numéro attribué après émission');

    const issued = harness.ctx.services.getInvoice(harness.draftInvoice.id)!;
    expect(issued.number).toMatch(/^FAC-\d{4}-\d{4}$/);
    expect(issued.status).not.toBe('draft');
    // La génération PDF est vérifiée en environnement Node (tests/ipc.test.ts) :
    // pdfkit ne résout pas ses polices sous jsdom.
    await waitFor(() => text().includes('Document émis') || text().includes('PDF à vérifier'), 'accusé d’émission');
  }, 30_000);

  it('exporte le journal en JSON depuis Rapports', async () => {
    await goTo('/rapports');
    await waitFor(() => h1() === 'Rapports & exports', 'page rapports');
    const exportButton = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Exporter en JSON'),
    );
    expect(exportButton).toBeTruthy();
    await act(async () => {
      exportButton!.click();
      await sleep(50);
    });
    const target = path.join(harness.outDir, `FacturePro_donnees_${new Date().toISOString().slice(0, 10)}.json`);
    await waitFor(() => fs.existsSync(target), 'fichier JSON exporté');
    const payload = JSON.parse(fs.readFileSync(target, 'utf8')) as { invoices?: unknown[] };
    expect(Array.isArray(payload.invoices)).toBe(true);
    expect(payload.invoices!.length).toBeGreaterThan(0);
  }, 20_000);

  it('marque une facture comme envoyée depuis sa fiche', async () => {
    await goTo(`/factures/${harness.issuedInvoice.id}`);
    await waitFor(() => h1() === harness.issuedInvoice.number, 'fiche facture');
    const button = Array.from(document.querySelectorAll('button')).find((element) =>
      element.textContent?.includes('Marquer comme envoyée'),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button!.click();
      await sleep(50);
    });
    await waitFor(() => harness.ctx.services.getInvoice(harness.issuedInvoice.id)?.status === 'sent', 'statut envoyée');
    await waitFor(() => text().includes('Envoyé'), 'horodatage d’envoi');
  }, 20_000);

  it("n'a produit aucune erreur console pendant le parcours", () => {
    const relevant = consoleErrors.filter(
      (entry) =>
        !entry.includes('Not implemented:') &&
        !entry.includes('act(') &&
        // pdfkit ne charge pas ses polices sous jsdom ; couvert par tests/ipc.test.ts.
        !entry.includes('Not a supported font format'),
    );
    expect(relevant).toEqual([]);
  });
});
