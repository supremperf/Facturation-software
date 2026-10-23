import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayISO } from '@shared/dates';
import { AppServices } from '../src/main/services/app-services';
import { silentLogger } from '../src/main/infra/logger';
import { completeSettings, createTestServices, draftFor, proClient, type TestContext } from './fixtures';

let ctx: TestContext;
let clientId: string;

beforeEach(async () => {
  ctx = await createTestServices();
  const client = ctx.services.createClient(proClient());
  clientId = client.id;
});

afterEach(async () => {
  await ctx.cleanup();
});

function clientAddress() {
  return ctx.services.getClient(clientId).address;
}

async function issueOne(overrides: Parameters<typeof draftFor>[2] = {}) {
  const draft = ctx.services.saveDraft(draftFor(clientId, clientAddress(), overrides));
  const result = await ctx.services.issueInvoice(draft.id);
  return result.invoice;
}

describe('cycle de vie des factures', () => {
  it('crée un brouillon, le valide puis l’émet avec un PDF archivé', async () => {
    const draft = ctx.services.saveDraft(draftFor(clientId, clientAddress()));
    expect(draft.status).toBe('draft');
    expect(draft.number).toBeNull();
    expect(draft.totals.totalHtCents).toBe(100_000);
    expect(draft.totals.totalVatCents).toBe(20_000);
    expect(draft.totals.totalTtcCents).toBe(120_000);
    const report = ctx.services.validateInvoice(draft.id);
    expect(report.canIssue).toBe(true);
    const { invoice } = await ctx.services.issueInvoice(draft.id);
    const year = todayISO().slice(0, 4);
    expect(invoice.number).toBe(`FAC-${year}-0001`);
    expect(invoice.status).toBe('issued');
    expect(invoice.issuedAt).toBeTruthy();
    expect(invoice.pdf).not.toBeNull();
    expect(invoice.pdf?.sha256).toMatch(/^[a-f0-9]{64}$/);
    const pdfPath = path.join(ctx.dir, invoice.pdf!.path);
    expect(fs.existsSync(pdfPath)).toBe(true);
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(1000);
    expect(invoice.clientSnapshot.displayName).toBe('Société Martin');
    expect(invoice.sellerSnapshot.legalName).toBe('Atelier Lumen SAS');
    expect(invoice.legalSnapshot.rulesVersion).toBeTruthy();
    const read = ctx.services.readPdf(invoice.id);
    expect(read.integrity).toBe(true);
    expect(Buffer.from(read.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuse l’émission si une mention obligatoire manque', async () => {
    const settings = ctx.services.getSettings();
    settings.legal.latePenaltyRateBp = null;
    ctx.services.saveSettings(settings);
    const draft = ctx.services.saveDraft(draftFor(clientId, clientAddress()));
    await expect(ctx.services.issueInvoice(draft.id)).rejects.toMatchObject({ code: 'COMPLIANCE' });
    expect(ctx.services.getInvoice(draft.id).status).toBe('draft');
  });

  it('ne permet ni modification ni suppression d’une facture émise', async () => {
    const invoice = await issueOne();
    expect(() => ctx.services.updateDraft(invoice.id, draftFor(clientId, clientAddress()))).toThrow(
      /avoir/i,
    );
    expect(() => ctx.services.deleteDraft(invoice.id)).toThrow(/avoir/i);
    expect(ctx.services.getInvoice(invoice.id).status).toBe('issued');
  });

  it('attribue des numéros uniques et chronologiques', async () => {
    const year = todayISO().slice(0, 4);
    const first = await issueOne();
    const second = await issueOne({ lines: [{ ...draftFor(clientId, clientAddress()).lines[0], designation: 'Deuxième prestation' }] });
    expect(first.number).toBe(`FAC-${year}-0001`);
    expect(second.number).toBe(`FAC-${year}-0002`);
    const preview = ctx.services.numberPreview('invoice');
    expect(preview.nextNumber).toBe(`FAC-${year}-0003`);
  });

  it('réinitialise la numérotation par année', async () => {
    const line = draftFor(clientId, clientAddress()).lines;
    const draft2025 = ctx.services.saveDraft(
      draftFor(clientId, clientAddress(), {
        issueDate: '2025-12-15',
        dueDate: '2026-01-14',
        serviceDate: '2025-12-15',
      }),
    );
    const inv2025 = (await ctx.services.issueInvoice(draft2025.id)).invoice;
    const draft2026 = ctx.services.saveDraft(
      draftFor(clientId, clientAddress(), {
        issueDate: '2026-01-05',
        dueDate: '2026-02-04',
        serviceDate: '2026-01-05',
        lines: line,
      }),
    );
    const inv2026 = (await ctx.services.issueInvoice(draft2026.id)).invoice;
    expect(inv2025.number).toBe('FAC-2025-0001');
    expect(inv2026.number).toBe('FAC-2026-0001');
  });

  it('marque une facture comme envoyée et la duplique en brouillon', async () => {
    const invoice = await issueOne();
    const sent = ctx.services.markSent(invoice.id);
    expect(sent.status).toBe('sent');
    const copy = ctx.services.duplicate(invoice.id);
    expect(copy.id).not.toBe(invoice.id);
    expect(copy.status).toBe('draft');
    expect(copy.number).toBeNull();
    expect(copy.totals.totalTtcCents).toBe(invoice.totals.totalTtcCents);
  });

  it('supprime un brouillon sans consommer de numéro', async () => {
    const draft = ctx.services.saveDraft(draftFor(clientId, clientAddress()));
    ctx.services.deleteDraft(draft.id);
    expect(() => ctx.services.getInvoice(draft.id)).toThrow();
    const invoice = await issueOne();
    expect(invoice.number).toMatch(/0001$/);
  });
});

describe('paiements', () => {
  it('gère un paiement partiel puis total', async () => {
    const invoice = await issueOne();
    expect(invoice.balanceCents).toBe(120_000);
    const partial = ctx.services.addPayment({
      invoiceId: invoice.id,
      date: todayISO(),
      amountCents: 20_000,
      method: 'virement',
      reference: 'VIR-1',
      note: '',
    });
    expect(partial.amountCents).toBe(20_000);
    let updated = ctx.services.getInvoice(invoice.id);
    expect(updated.paidCents).toBe(20_000);
    expect(updated.balanceCents).toBe(100_000);
    expect(updated.status).toBe('partial');
    expect(updated.effectiveStatus).toBe('partial');
    expect(() =>
      ctx.services.addPayment({
        invoiceId: invoice.id,
        date: todayISO(),
        amountCents: 200_000,
        method: 'carte',
        reference: '',
        note: '',
      }),
    ).toThrow(/solde/i);
    ctx.services.addPayment({
      invoiceId: invoice.id,
      date: todayISO(),
      amountCents: 100_000,
      method: 'carte',
      reference: 'CB-2',
      note: '',
    });
    updated = ctx.services.getInvoice(invoice.id);
    expect(updated.balanceCents).toBe(0);
    expect(updated.status).toBe('paid');
    expect(updated.effectiveStatus).toBe('paid');
    const payments = ctx.services.paymentsForInvoice(invoice.id);
    expect(payments).toHaveLength(2);
    expect(payments[0].invoiceNumber).toBe(invoice.number);
  });

  it('recalcule le statut après suppression d’un paiement', async () => {
    const invoice = await issueOne();
    const payment = ctx.services.addPayment({
      invoiceId: invoice.id,
      date: todayISO(),
      amountCents: 120_000,
      method: 'virement',
      reference: '',
      note: '',
    });
    expect(ctx.services.getInvoice(invoice.id).status).toBe('paid');
    ctx.services.deletePayment(payment.id);
    const updated = ctx.services.getInvoice(invoice.id);
    expect(updated.balanceCents).toBe(120_000);
    expect(updated.status).toBe('issued');
  });

  it('refuse un paiement sur un brouillon', async () => {
    const draft = ctx.services.saveDraft(draftFor(clientId, clientAddress()));
    expect(() =>
      ctx.services.addPayment({
        invoiceId: draft.id,
        date: todayISO(),
        amountCents: 1000,
        method: 'virement',
        reference: '',
        note: '',
      }),
    ).toThrow(/émis/i);
  });

  it('refuse un montant nul ou négatif', () => {
    return issueOne().then((invoice) => {
      expect(() =>
        ctx.services.addPayment({
          invoiceId: invoice.id,
          date: todayISO(),
          amountCents: 0,
          method: 'virement',
          reference: '',
          note: '',
        }),
      ).toThrow(/positif/i);
    });
  });
});

describe('avoirs', () => {
  async function creditNoteFor(invoiceId: string, cents: number, reason = 'Geste commercial') {
    const base = draftFor(clientId, clientAddress(), {
      type: 'credit_note',
      sourceInvoiceId: invoiceId,
      reason,
      lines: [
        {
          ...draftFor(clientId, clientAddress()).lines[0],
          designation: 'Avoir sur prestation',
          quantity: 1,
          unitPriceCents: cents,
          vatRateBp: 0,
        },
      ],
    });
    const draft = ctx.services.saveDraft(base);
    return (await ctx.services.issueInvoice(draft.id)).invoice;
  }

  it('crée un avoir numéroté et réduit le solde de la facture', async () => {
    const invoice = await issueOne();
    const credit = await creditNoteFor(invoice.id, 60_000);
    expect(credit.number).toMatch(/^AV-\d{4}-0001$/);
    expect(credit.type).toBe('credit_note');
    expect(credit.sourceInvoiceId).toBe(invoice.id);
    const source = ctx.services.getInvoice(invoice.id);
    expect(source.creditedCents).toBe(60_000);
    expect(source.balanceCents).toBe(60_000);
    expect(source.status).toBe('issued');
    const notes = ctx.services.invoiceCreditNotes(invoice.id);
    expect(notes).toHaveLength(1);
    expect(notes[0].number).toBe(credit.number);
  });

  it('permet un avoir sur une facture intégralement payée', async () => {
    // Une facture payée peut être annulée/remboursée : la limite légale est le
    // montant facturé, jamais le solde restant dû (sinon aucun remboursement
    // ne serait possible).
    const invoice = await issueOne();
    ctx.services.addPayment({
      invoiceId: invoice.id,
      date: todayISO(),
      amountCents: 120_000,
      method: 'virement',
      reference: 'VIR-SOLDE',
      note: '',
    });
    expect(ctx.services.getInvoice(invoice.id).status).toBe('paid');
    const credit = await creditNoteFor(invoice.id, 120_000);
    expect(credit.type).toBe('credit_note');
    const source = ctx.services.getInvoice(invoice.id);
    expect(source.creditedCents).toBe(120_000);
    expect(source.balanceCents).toBe(0);
    expect(source.status).toBe('paid');
  });

  it('solde la facture par avoir intégral', async () => {
    const invoice = await issueOne();
    await creditNoteFor(invoice.id, 120_000);
    const source = ctx.services.getInvoice(invoice.id);
    expect(source.balanceCents).toBe(0);
    expect(source.status).toBe('cancelled');
    expect(source.effectiveStatus).toBe('cancelled');
  });

  it('refuse un avoir supérieur au total de la facture', async () => {
    const invoice = await issueOne();
    await creditNoteFor(invoice.id, 60_000);
    const base = draftFor(clientId, clientAddress(), {
      type: 'credit_note',
      sourceInvoiceId: invoice.id,
      reason: 'Trop-perçu',
      lines: [
        {
          ...draftFor(clientId, clientAddress()).lines[0],
          quantity: 1,
          unitPriceCents: 100_000,
          vatRateBp: 0,
        },
      ],
    });
    const draft = ctx.services.saveDraft(base);
    await expect(ctx.services.issueInvoice(draft.id)).rejects.toThrow(/avoir/i);
    expect(ctx.services.getInvoice(draft.id).status).toBe('draft');
  });

  it('exige une facture d’origine et un motif', () => {
    expect(() =>
      ctx.services.saveDraft(
        draftFor(clientId, clientAddress(), { type: 'credit_note', reason: 'Test' }),
      ),
    ).toThrow(/origine/i);
    return issueOne().then((invoice) => {
      expect(() =>
        ctx.services.saveDraft(
          draftFor(clientId, clientAddress(), {
            type: 'credit_note',
            sourceInvoiceId: invoice.id,
            reason: '  ',
          }),
        ),
      ).toThrow(/motif/i);
    });
  });
});

describe('clients et persistance', () => {
  it('interdit la suppression d’un client ayant des factures et permet l’archivage', async () => {
    await issueOne();
    expect(() => ctx.services.deleteClient(clientId)).toThrow(/conservation/i);
    const archived = ctx.services.setClientArchived(clientId, true);
    expect(archived.isArchived).toBe(true);
    expect(ctx.services.listClients()).toHaveLength(0);
    expect(ctx.services.listClients({ includeArchived: true })).toHaveLength(1);
  });

  it('supprime un client ne possédant que des brouillons', () => {
    ctx.services.saveDraft(draftFor(clientId, clientAddress()));
    ctx.services.deleteClient(clientId);
    expect(ctx.services.listClients({ includeArchived: true })).toHaveLength(0);
    expect(ctx.services.listInvoices({ status: 'all' }).total).toBe(0);
  });

  it('conserve les données après fermeture et réouverture', async () => {
    const invoice = await issueOne();
    ctx.services.addPayment({
      invoiceId: invoice.id,
      date: todayISO(),
      amountCents: 1000,
      method: 'virement',
      reference: 'X',
      note: '',
    });
    const settings = ctx.services.getSettings();
    settings.business.tradeName = 'Lumen Studio';
    ctx.services.saveSettings(settings);
    const backup = ctx.services.createBackup(false);
    await ctx.services.dispose();
    const reopened = await AppServices.create({
      baseDir: ctx.dir,
      wasmPath: path.resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
      fontsDir: path.resolve(__dirname, '../node_modules/dejavu-fonts-ttf/ttf'),
      appVersion: '0.0.0-test',
      logger: silentLogger,
    });
    try {
      const reloaded = reopened.getInvoice(invoice.id);
      expect(reloaded.number).toBe(invoice.number);
      expect(reloaded.paidCents).toBe(1000);
      expect(reloaded.pdf?.sha256).toBe(invoice.pdf?.sha256);
      expect(reopened.getSettings().business.tradeName).toBe('Lumen Studio');
      expect(reopened.listClients()).toHaveLength(1);
      expect(fs.existsSync(backup.path)).toBe(true);
      expect(reopened.listBackups().length).toBeGreaterThan(0);
    } finally {
      await reopened.dispose();
    }
  });

  it('trie, filtre et pagine les factures', async () => {
    const a = await issueOne();
    const b = await issueOne({ issueDate: addDays(todayISO(), -1), dueDate: addDays(todayISO(), 29), serviceDate: addDays(todayISO(), -1) });
    const all = ctx.services.listInvoices({ status: 'all', page: 1, pageSize: 1 });
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(1);
    expect(all.totalPages).toBe(2);
    const sorted = ctx.services.listInvoices({ status: 'all', sortBy: 'issueDate', sortDir: 'desc' });
    expect(sorted.items[0].id).toBe(a.id);
    const byNumber = ctx.services.listInvoices({ query: a.number!, status: 'all' });
    expect(byNumber.total).toBe(1);
    const filtered = ctx.services.listInvoices({ status: 'paid' });
    expect(filtered.total).toBe(0);
    expect(b.number).toMatch(/0002$/);
  });
});

describe('tableau de bord et statistiques', () => {
  it('calcule les indicateurs depuis la base', async () => {
    const invoice = await issueOne();
    ctx.services.addPayment({
      invoiceId: invoice.id,
      date: todayISO(),
      amountCents: 20_000,
      method: 'virement',
      reference: '',
      note: '',
    });
    const dashboard = ctx.services.dashboard('year');
    expect(dashboard.kpis.revenueHtCents).toBe(100_000);
    expect(dashboard.kpis.revenueTtcCents).toBe(120_000);
    expect(dashboard.kpis.collectedCents).toBe(20_000);
    expect(dashboard.kpis.outstandingCents).toBe(100_000);
    expect(dashboard.kpis.invoicesCount).toBe(1);
    expect(dashboard.kpis.pendingCount).toBe(1);
    expect(dashboard.statusBreakdown.find((s) => s.status === 'partial')?.count).toBe(1);
    expect(dashboard.recentInvoices[0].id).toBe(invoice.id);
    expect(dashboard.recentActivities.length).toBeGreaterThan(0);
    expect(dashboard.revenueSeries).toHaveLength(12);
    expect(dashboard.cashComparison).toHaveLength(6);
    const stats = ctx.services.stats(Number(todayISO().slice(0, 4)));
    expect(stats.totals.revenueHtCents).toBe(100_000);
    expect(stats.totals.invoiceCount).toBe(1);
    expect(stats.vatByRate[0].rateBp).toBe(2000);
    expect(stats.topClients[0].name).toBe('Société Martin');
  });

  it('compte les factures en retard', async () => {
    const draft = ctx.services.saveDraft(
      draftFor(clientId, clientAddress(), {
        issueDate: addDays(todayISO(), -40),
        dueDate: addDays(todayISO(), -10),
        serviceDate: addDays(todayISO(), -40),
      }),
    );
    await ctx.services.issueInvoice(draft.id);
    const overdue = ctx.services.listInvoices({ status: 'overdue' });
    expect(overdue.total).toBe(1);
    const dashboard = ctx.services.dashboard('year');
    expect(dashboard.kpis.overdueCount).toBe(1);
    expect(dashboard.overdueTotalCents).toBe(120_000);
  });
});
