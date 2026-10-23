import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayISO } from '@shared/dates';
import { TINY_PNG_BASE64, createTestServices, draftFor, proClient, type TestContext } from './fixtures';
import { extractPdf } from './pdf-utils';

let ctx: TestContext;
let clientId: string;

beforeEach(async () => {
  ctx = await createTestServices();
  clientId = ctx.services.createClient(
    proClient({
      companyName: 'Élodie Réné Conseil',
      firstName: 'Élodie',
      lastName: 'Réné',
      address: {
        line1: '3 rue de l’Église',
        line2: '',
        postalCode: '67000',
        city: 'Strasbourg',
        country: 'France',
      },
    }),
  ).id;
  ctx.services.uploadLogo({ fileName: 'logo.png', mime: 'image/png', base64: TINY_PNG_BASE64 });
});

afterEach(async () => {
  await ctx.cleanup();
});

function address() {
  return ctx.services.getClient(clientId).address;
}

async function issue(overrides: Parameters<typeof draftFor>[2] = {}) {
  const draft = ctx.services.saveDraft(draftFor(clientId, address(), overrides));
  return (await ctx.services.issueInvoice(draft.id)).invoice;
}

const normalize = (value: string) => value.replace(/[\u202f\u00a0]/g, ' ').replace(/\s+/g, ' ');

describe('génération PDF', () => {
  it('génère un PDF complet, lisible et dans les marges', async () => {
    const invoice = await issue({
      notes: 'Merci de votre confiance.',
      purchaseOrder: 'PO-2026-042',
      description: 'Étude et développement du module de facturation.',
    });
    const read = ctx.services.readPdf(invoice.id);
    const buffer = Buffer.from(read.base64, 'base64');
    expect(read.fileName).toBe('FACTURE_FAC-2026-0001_Elodie_Rene_Conseil.pdf');
    expect(buffer.includes(Buffer.from('/Subtype /Image'))).toBe(true);
    const extracted = await extractPdf(buffer);
    const text = normalize(extracted.text);
    expect(extracted.pages).toBe(1);
    expect(extracted.outOfBounds).toEqual([]);
    expect(text).toContain('FACTURE');
    expect(text).toContain(invoice.number!);
    expect(text).toContain('Atelier Lumen SAS');
    expect(text).toContain('Élodie Réné Conseil');
    expect(text).toContain('3 rue de l’Église');
    expect(text).toContain('Étude et développement du module de facturation.');
    expect(text).toContain('TOTAL TTC');
    expect(text).toContain('1 200,00 €');
    expect(text).toContain('1 000,00 €');
    expect(text).toContain('TVA 20 %');
    expect(text).toContain('Pénalités de retard');
    expect(text).toContain('40 €');
    expect(text).toContain('FR1420041010050500013M02606');
    expect(text).toContain('PO-2026-042');
    expect(text).toContain('Prestation de services');
    expect(text).toContain('page 1/1');
    expect(text).toContain('RCS Paris 732 829 320');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('NaN');
  });

  it('pagine automatiquement les factures longues en répétant le numéro', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => ({
      designation: `Prestation détaillée n° ${index + 1} avec un intitulé suffisamment long pour tester le retour à la ligne`,
      description:
        'Description détaillée de la prestation réalisée, comprenant les livrables, les modalités et les conditions particulières applicables à cette ligne de facturation.',
      reference: `REF-${index + 1}`,
      quantity: 1,
      unit: 'forfait',
      unitPriceCents: 12_500,
      discountType: 'none' as const,
      discountValue: 0,
      vatRateBp: 2000,
      isExtraFee: false,
      operationNature: 'services' as const,
    }));
    const invoice = await issue({ lines });
    const buffer = Buffer.from(ctx.services.readPdf(invoice.id).base64, 'base64');
    const extracted = await extractPdf(buffer);
    expect(extracted.pages).toBeGreaterThan(1);
    expect(extracted.outOfBounds).toEqual([]);
    extracted.pageTexts.forEach((pageText, index) => {
      const text = normalize(pageText);
      expect(text).toContain(invoice.number!);
      expect(text).toContain(`page ${index + 1}/${extracted.pages}`);
      if (text.includes('DÉSIGNATION')) expect(text).toContain('TOTAL HT');
    });
    const all = normalize(extracted.text);
    expect(all).toContain('DÉSIGNATION');
    const totalTtc = (invoice.totals.totalTtcCents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
    expect(all).toContain(totalTtc.replace(/\u202f/g, ' '));
    // Aucune page orpheline : les mentions légales restent groupées et ne
    // provoquent pas une page ne contenant qu'une seule ligne.
    const lastPage = normalize(extracted.pageTexts[extracted.pageTexts.length - 1]);
    if (lastPage.includes('MENTIONS LÉGALES')) {
      expect(lastPage).toContain('Pénalités de retard');
      expect(lastPage).toContain('escompte');
    }
  });

  it('affiche les avoirs avec leur facture d’origine', async () => {
    const source = await issue();
    const draft = ctx.services.saveDraft(
      draftFor(clientId, address(), {
        type: 'credit_note',
        sourceInvoiceId: source.id,
        reason: 'Remise commerciale exceptionnelle',
        dueDate: todayISO(),
        lines: [
          {
            ...draftFor(clientId, address()).lines[0],
            designation: 'Avoir sur prestation',
            quantity: 1,
            unitPriceCents: 50_000,
            vatRateBp: 2000,
          },
        ],
      }),
    );
    const credit = (await ctx.services.issueInvoice(draft.id)).invoice;
    expect(credit.number).toBe('AV-2026-0001');
    const buffer = Buffer.from(ctx.services.readPdf(credit.id).base64, 'base64');
    const extracted = await extractPdf(buffer);
    expect(extracted.outOfBounds).toEqual([]);
    const text = normalize(extracted.text);
    expect(text).toContain('AVOIR');
    expect(text).toContain(source.number!);
    expect(text).toContain('600,00 €');
    expect(text).toContain('page 1/1');
  });

  it('produit un aperçu de brouillon filigrané sans l’archiver', async () => {
    const draft = ctx.services.saveDraft(draftFor(clientId, address()));
    const preview = await ctx.services.previewPdf({ draft: draftFor(clientId, address()) });
    expect(preview.draft).toBe(true);
    expect(preview.fileName).toContain('APERCU_FACTURE');
    expect(preview.report?.canIssue).toBe(true);
    const buffer = Buffer.from(preview.base64, 'base64');
    const extracted = await extractPdf(buffer);
    const text = normalize(extracted.text);
    expect(text).toContain('APERÇU');
    expect(text).toContain('BROUILLON');
    expect(ctx.services.getInvoice(draft.id).pdf).toBeNull();
    const saved = path.join(ctx.dir, 'apercu.pdf');
    ctx.services.savePreviewPdf(preview.base64, saved);
    expect(fs.existsSync(saved)).toBe(true);
  });

  it('garde le PDF original intact après enregistrement des paiements', async () => {
    const invoice = await issue();
    const before = ctx.services.readPdf(invoice.id);
    ctx.services.addPayment({
      invoiceId: invoice.id,
      date: todayISO(),
      amountCents: 20_000,
      method: 'virement',
      reference: '',
      note: '',
    });
    const after = ctx.services.readPdf(invoice.id);
    expect(after.base64).toBe(before.base64);
    await expect(ctx.services.regeneratePdf(invoice.id)).rejects.toThrow(/conserv/i);
  });

  it('génère un PDF sans logo si aucun logo n’est configuré', async () => {
    ctx.services.removeLogo();
    const invoice = await issue();
    const buffer = Buffer.from(ctx.services.readPdf(invoice.id).base64, 'base64');
    const extracted = await extractPdf(buffer);
    expect(extracted.outOfBounds).toEqual([]);
    expect(normalize(extracted.text)).toContain('FACTURE');
  });

  it('respecte les montants de remise globale sur le PDF', async () => {
    const invoice = await issue({
      globalDiscountType: 'percent',
      globalDiscountValue: 1000,
      lines: [
        {
          ...draftFor(clientId, address()).lines[0],
          quantity: 3,
          unitPriceCents: 33_333,
          vatRateBp: 2000,
        },
        {
          ...draftFor(clientId, address()).lines[0],
          designation: 'Frais de déplacement',
          quantity: 1,
          unitPriceCents: 5_000,
          vatRateBp: 1000,
          isExtraFee: true,
        },
      ],
    });
    const buffer = Buffer.from(ctx.services.readPdf(invoice.id).base64, 'base64');
    const extracted = await extractPdf(buffer);
    const text = normalize(extracted.text);
    const fmt = (cents: number) => (cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    expect(text).toContain('Remise globale');
    expect(text).toContain(fmt(invoice.totals.globalDiscountCents));
    expect(text).toContain(fmt(invoice.totals.totalHtCents));
    expect(text).toContain(fmt(invoice.totals.totalTtcCents));
    expect(extracted.outOfBounds).toEqual([]);
  });
});
