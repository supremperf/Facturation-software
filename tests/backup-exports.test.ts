import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { todayISO } from '@shared/dates';
import { AppServices } from '../src/main/services/app-services';
import { silentLogger } from '../src/main/infra/logger';
import { createTestServices, draftFor, proClient, type TestContext } from './fixtures';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestServices();
  const client = ctx.services.createClient(proClient());
  const draft = ctx.services.saveDraft(draftFor(client.id, client.address));
  const { invoice } = await ctx.services.issueInvoice(draft.id);
  ctx.services.addPayment({
    invoiceId: invoice.id,
    date: todayISO(),
    amountCents: 20_000,
    method: 'virement',
    reference: 'VIR-001',
    note: '',
  });
});

afterEach(async () => {
  await ctx.cleanup();
});

describe('sauvegardes', () => {
  it('crée une sauvegarde complète avec manifeste, base et PDF', () => {
    const backup = ctx.services.createBackup(false);
    expect(fs.existsSync(backup.path)).toBe(true);
    expect(backup.automatic).toBe(false);
    const zip = new AdmZip(backup.path);
    expect(zip.getEntry('manifest.json')).toBeTruthy();
    expect(zip.getEntry('data/facturepro.db')).toBeTruthy();
    const pdfEntry = zip
      .getEntries()
      .find((entry) => entry.entryName.startsWith('documents/Factures/') && entry.entryName.endsWith('.pdf'));
    expect(pdfEntry).toBeTruthy();
    const manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf8'));
    expect(manifest.app).toBe('FacturePro');
    expect(manifest.invoices).toBe(1);
    expect(ctx.services.listBackups()[0].name).toBe(backup.name);
  });

  it('restaure une sauvegarde et remplace les données', async () => {
    const backup = ctx.services.createBackup(false);
    const client = ctx.services.listClients()[0];
    const second = ctx.services.saveDraft(draftFor(client.id, client.address));
    await ctx.services.issueInvoice(second.id);
    expect(ctx.services.listInvoices({ status: 'all' }).total).toBe(2);
    await ctx.services.restoreBackup(backup.path);
    expect(ctx.services.listInvoices({ status: 'all' }).total).toBe(1);
    const invoice = ctx.services.listInvoices({ status: 'all' }).items[0];
    expect(invoice.number).toBe('FAC-2026-0001');
    const read = ctx.services.readPdf(invoice.id);
    expect(read.integrity).toBe(true);
    expect(ctx.services.listBackups().length).toBeGreaterThanOrEqual(1);
    expect(
      ctx.services.dashboard('year').recentActivities.some((a) => a.type === 'backup_restored'),
    ).toBe(true);
  });

  it('rejette un faux fichier de sauvegarde', () => {
    const fake = path.join(ctx.dir, 'fake.zip');
    const zip = new AdmZip();
    zip.addFile('hello.txt', Buffer.from('not a backup'));
    zip.writeZip(fake);
    expect(() => ctx.services.importBackup(fake)).toThrow(/invalide|FacturePro/i);
  });

  it('exporte et supprime une sauvegarde', () => {
    const backup = ctx.services.createBackup(false);
    const target = path.join(ctx.dir, 'export', 'backup.zip');
    const exported = ctx.services.exportBackup(backup.path, target);
    expect(fs.existsSync(exported)).toBe(true);
    ctx.services.deleteBackup(backup.path);
    expect(ctx.services.listBackups().find((b) => b.path === backup.path)).toBeUndefined();
  });
});

describe('exports', () => {
  it('exporte les factures en CSV lisible par Excel', () => {
    const target = path.join(ctx.dir, 'exports', 'factures.csv');
    const result = ctx.services.exportInvoicesCsv({}, target);
    expect(result.count).toBe(1);
    const content = fs.readFileSync(target, 'utf8');
    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(content).toContain('"Numéro";"Type";"Date émission"');
    expect(content).toContain('FAC-2026-0001');
    expect(content).toContain('"1000,00"');
    expect(content).toContain('Société Martin');
  });

  it('exporte la TVA collectée par taux', () => {
    const target = path.join(ctx.dir, 'exports', 'tva.csv');
    ctx.services.exportVatCsv('2026-01-01', '2026-12-31', target);
    const content = fs.readFileSync(target, 'utf8');
    expect(content).toContain('20,00 %');
    expect(content).toContain('200,00');
  });

  it('exporte un JSON structuré', () => {
    const target = path.join(ctx.dir, 'exports', 'donnees.json');
    ctx.services.exportJson(target);
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(parsed.app).toBe('FacturePro');
    expect(parsed.settings.business.legalName).toBe('Atelier Lumen SAS');
    expect(parsed.invoices).toHaveLength(1);
    expect(parsed.payments).toHaveLength(1);
  });

  it('exporte une archive ZIP de PDF nommés proprement', () => {
    const invoice = ctx.services.listInvoices({ status: 'all' }).items[0];
    const target = path.join(ctx.dir, 'exports', 'pdfs.zip');
    const result = ctx.services.exportPdfZip([invoice.id], target);
    expect(result.count).toBe(1);
    const zip = new AdmZip(target);
    const names = zip.getEntries().map((entry) => entry.entryName);
    expect(names).toContain('FACTURE_FAC-2026-0001_Societe_Martin.pdf');
  });
});

describe('récupération après corruption', () => {
  it('refuse une base corrompue et en crée une nouvelle sans supprimer l’original', async () => {
    await ctx.services.dispose();
    const dbPath = path.join(ctx.dir, 'data', 'facturepro.db');
    const previousPath = path.join(ctx.dir, 'data', 'facturepro.previous.db');
    fs.writeFileSync(dbPath, 'fichier corrompu');
    fs.writeFileSync(previousPath, 'autre corruption');
    const reopened = await AppServices.create({
      baseDir: ctx.dir,
      wasmPath: path.resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
      fontsDir: path.resolve(__dirname, '../node_modules/dejavu-fonts-ttf/ttf'),
      appVersion: '0.0.0-test',
      logger: silentLogger,
    });
    try {
      expect(reopened.listClients()).toHaveLength(0);
      expect(reopened.getSettings().business.legalName).toBe('');
      const files = fs.readdirSync(path.join(ctx.dir, 'data'));
      expect(files.some((name) => name.includes('.corrupt-'))).toBe(true);
      expect(reopened.diagnostics().integrity).toBe('ok');
    } finally {
      await reopened.dispose();
    }
  });
});
