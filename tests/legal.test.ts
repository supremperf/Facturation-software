import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { buildLegalMentions, buildLegalSnapshot, validateCompliance, type ComplianceDocument } from '@shared/legal';
import { completeSettings, consumerClient, createTestServices, draftFor, proClient, type TestContext } from './fixtures';
import { buildSellerSnapshot } from '@shared/legal';
import { computeInvoiceTotals } from '@shared/money';
import { todayISO, addDays } from '@shared/dates';
import { defaultBillingAddress } from '../src/main/db/repositories';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestServices();
});

afterEach(async () => {
  await ctx.cleanup();
});

function buildDocument(settings = ctx.services.getSettings(), clientOverride = proClient(), lineVat = 2000, nature: 'services' | 'goods' | 'mixed' = 'services'): ComplianceDocument {
  const lines = [
    {
      designation: 'Prestation de conseil',
      description: '',
      reference: 'CONS-1',
      quantity: 1,
      unit: 'jour',
      unitPriceCents: 100_000,
      discountType: 'none' as const,
      discountValue: 0,
      vatRateBp: lineVat,
      isExtraFee: false,
      operationNature: 'services' as const,
    },
  ];
  const computed = computeInvoiceTotals(lines, 'none', 0);
  return {
    type: 'invoice',
    number: null,
    issueDate: todayISO(),
    dueDate: addDays(todayISO(), 30),
    serviceDate: todayISO(),
    clientSnapshot: {
      id: null,
      displayName: clientOverride.companyName || `${clientOverride.firstName} ${clientOverride.lastName}`,
      type: clientOverride.type,
      civility: clientOverride.civility,
      firstName: clientOverride.firstName,
      lastName: clientOverride.lastName,
      companyName: clientOverride.companyName,
      legalForm: clientOverride.legalForm,
      siren: clientOverride.siren,
      siret: clientOverride.siret,
      vatNumber: clientOverride.vatNumber,
      vatSubject: clientOverride.vatSubject,
      email: clientOverride.email,
      phone: clientOverride.phone,
      address: clientOverride.address,
      deliveryAddress: clientOverride.deliveryAddress,
    },
    billingAddress: clientOverride.address,
    deliveryAddress: clientOverride.deliveryAddress,
    purchaseOrder: '',
    operationNature: nature,
    description: 'Prestation',
    paymentTerms: 'Paiement à 30 jours',
    paymentMethod: 'virement',
    notes: '',
    lines,
    globalDiscountType: 'none',
    globalDiscountValue: 0,
    totals: computed.totals,
  };
}

describe('moteur de conformité', () => {
  it('accepte une facture complète et signale la nature du PDF', () => {
    const settings = ctx.services.getSettings();
    const report = validateCompliance({
      settings,
      document: buildDocument(settings),
      numberAssigned: false,
    });
    expect(report.canIssue).toBe(true);
    expect(report.checks.find((c) => c.id === 'seller.registration')?.status).toBe('ok');
    expect(report.checks.find((c) => c.id === 'client.siren')?.status).toBe('ok');
    expect(report.checks.find((c) => c.id === 'einv.pdf')?.message).toContain('ne remplace pas');
    expect(report.checks.find((c) => c.id === 'totals.consistency')?.status).toBe('ok');
  });

  it('bloque une facture sans SIREN vendeur', () => {
    const settings = completeSettings();
    settings.business.siren = '';
    settings.business.siret = '';
    const report = validateCompliance({ settings, document: buildDocument(settings), numberAssigned: false });
    expect(report.canIssue).toBe(false);
    expect(report.checks.find((c) => c.id === 'seller.registration')?.status).toBe('missing');
  });

  it('bloque un régime de TVA non configuré', () => {
    const settings = completeSettings();
    settings.fiscal.regime = null;
    const report = validateCompliance({ settings, document: buildDocument(settings), numberAssigned: false });
    expect(report.canIssue).toBe(false);
    expect(report.checks.find((c) => c.id === 'vat.regime')?.severity).toBe('blocking');
  });

  it('bloque une TVA facturée en franchise en base', () => {
    const settings = completeSettings();
    settings.fiscal.regime = 'franchise';
    const report = validateCompliance({ settings, document: buildDocument(settings), numberAssigned: false });
    expect(report.canIssue).toBe(false);
    const check = report.checks.find((c) => c.id === 'vat.lines');
    expect(check?.status).toBe('incoherent');
    expect(check?.message).toContain('franchise');
  });

  it('accepte une facture en franchise sans TVA', () => {
    const settings = completeSettings();
    settings.fiscal.regime = 'franchise';
    const report = validateCompliance({ settings, document: buildDocument(settings, proClient(), 0), numberAssigned: false });
    expect(report.canIssue).toBe(true);
    expect(report.checks.find((c) => c.id === 'vat.lines')?.status).toBe('ok');
  });

  it('exige les pénalités et l’escompte entre professionnels', () => {
    const settings = completeSettings();
    settings.legal.latePenaltyRateBp = null;
    settings.legal.escompte = '';
    const report = validateCompliance({ settings, document: buildDocument(settings), numberAssigned: false });
    expect(report.checks.find((c) => c.id === 'legal.penalties')?.status).toBe('missing');
    expect(report.checks.find((c) => c.id === 'legal.escompte')?.status).toBe('missing');
    expect(report.canIssue).toBe(false);
  });

  it('n’exige pas l’indemnité de 40 € pour un particulier', () => {
    const settings = completeSettings();
    settings.legal.latePenaltyRateBp = null;
    settings.legal.escompte = '';
    const report = validateCompliance({
      settings,
      document: buildDocument(settings, consumerClient(), 0),
      numberAssigned: false,
    });
    expect(report.checks.find((c) => c.id === 'legal.penalties')?.status).toBe('not_applicable');
    expect(report.canIssue).toBe(true);
  });

  it('exige le SIREN d’un client professionnel français', () => {
    const settings = ctx.services.getSettings();
    const report = validateCompliance({
      settings,
      document: buildDocument(settings, proClient({ siren: '' })),
      numberAssigned: false,
    });
    expect(report.checks.find((c) => c.id === 'client.siren')?.status).toBe('missing');
    expect(report.canIssue).toBe(false);
  });

  it('n’exige pas le SIREN pour un client professionnel étranger', () => {
    const settings = ctx.services.getSettings();
    const report = validateCompliance({
      settings,
      document: buildDocument(settings, proClient({ siren: '', vatNumber: 'BE0123456789', address: { ...proClient().address, country: 'Belgique' } })),
      numberAssigned: false,
    });
    expect(report.checks.find((c) => c.id === 'client.siren')?.status).toBe('not_applicable');
  });

  it('exige la garantie légale de conformité pour un bien vendu à un particulier', () => {
    const settings = completeSettings();
    settings.legal.consumerGoodsMention = '';
    const report = validateCompliance({
      settings,
      document: buildDocument(settings, consumerClient(), 2000, 'goods'),
      numberAssigned: false,
    });
    expect(report.checks.find((c) => c.id === 'consumer.guarantee')?.status).toBe('missing');
  });

  it('signale l’adresse de livraison incomplète', () => {
    const settings = ctx.services.getSettings();
    const doc = buildDocument(settings);
    doc.deliveryAddress = { line1: '3 rue du Port', line2: '', postalCode: '', city: 'Bordeaux', country: 'France' };
    const report = validateCompliance({ settings, document: doc, numberAssigned: false });
    expect(report.checks.find((c) => c.id === 'invoice.deliveryAddress')?.status).toBe('incoherent');
  });

  it('bloque un brouillon dont les totaux ont été altérés', () => {
    const settings = ctx.services.getSettings();
    const doc = buildDocument(settings);
    doc.totals.totalTtcCents += 100;
    const report = validateCompliance({ settings, document: doc, numberAssigned: false });
    expect(report.checks.find((c) => c.id === 'totals.consistency')?.status).toBe('incoherent');
  });

  it('bloque une date d’émission future', () => {
    const settings = ctx.services.getSettings();
    const doc = buildDocument(settings);
    doc.issueDate = addDays(todayISO(), 5);
    const report = validateCompliance({ settings, document: doc, numberAssigned: false });
    expect(report.checks.find((c) => c.id === 'invoice.issueDate')?.status).toBe('incoherent');
  });

  it('exige un numéro unique à l’émission', () => {
    const settings = ctx.services.getSettings();
    const doc = buildDocument(settings);
    doc.number = 'FAC-2026-0001';
    const report = validateCompliance({
      settings,
      document: doc,
      numberAssigned: true,
      numberUnique: false,
    });
    expect(report.checks.find((c) => c.id === 'invoice.number')?.status).toBe('incoherent');
  });
});

describe('mentions légales imprimées', () => {
  it('affiche la mention de franchise en base', () => {
    const settings = completeSettings();
    settings.fiscal.regime = 'franchise';
    const mentions = buildLegalMentions({
      legal: buildLegalSnapshot(settings),
      clientType: 'professionnel',
      operationNature: 'services',
      hasVat: false,
    });
    expect(mentions.map((m) => m.text).join(' ')).toContain('TVA non applicable');
    expect(mentions.map((m) => m.text).join(' ')).toContain('CIBS');
  });

  it('affiche les pénalités, l’escompte et l’indemnité de 40 €', () => {
    const settings = completeSettings();
    const mentions = buildLegalMentions({
      legal: buildLegalSnapshot(settings),
      clientType: 'professionnel',
      operationNature: 'services',
      hasVat: true,
    });
    const text = mentions.map((m) => m.text).join(' ');
    expect(text).toContain('Pénalités de retard');
    expect(text).toContain('40 €');
    expect(text).toContain('Aucun escompte');
  });

  it('ajoute la garantie légale pour un particulier', () => {
    const settings = completeSettings();
    const mentions = buildLegalMentions({
      legal: buildLegalSnapshot(settings),
      clientType: 'particulier',
      operationNature: 'goods',
      hasVat: true,
    });
    const text = mentions.map((m) => m.text).join(' ');
    expect(text).toContain('garantie légale de conformité');
    expect(text).not.toContain('Pénalités de retard');
  });
});

describe('instantanés vendeur', () => {
  it('capture les informations sans les inventer', () => {
    const settings = completeSettings();
    const snapshot = buildSellerSnapshot(settings);
    expect(snapshot.legalName).toBe('Atelier Lumen SAS');
    expect(snapshot.siren).toBe('732829320');
    expect(snapshot.bank.iban).toBe('FR1420041010050500013M02606');
    expect(snapshot.capitalCents).toBe(500_000);
  });
});
