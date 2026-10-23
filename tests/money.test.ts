import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  computeInvoiceTotals,
  computeLine,
  formatEuros,
  formatEurosPdf,
  mulDivRound,
  parseEuroToCents,
  parsePercentToBp,
  quantityTimesPriceCents,
} from '@shared/money';
import type { InvoiceLineInput } from '@shared/types';

function line(partial: Partial<InvoiceLineInput> = {}): InvoiceLineInput {
  return {
    designation: 'Prestation',
    description: '',
    reference: '',
    quantity: 1,
    unit: 'unité',
    unitPriceCents: 10_000,
    discountType: 'none',
    discountValue: 0,
    vatRateBp: 2000,
    isExtraFee: false,
    operationNature: 'services',
    ...partial,
  };
}

const normalize = (value: string) => value.replace(/\u202f|\u00a0/g, ' ');

describe('arithmétique monétaire', () => {
  it('arrondit au centime le plus proche', () => {
    expect(mulDivRound(1000, 2000, 10_000)).toBe(200);
    expect(mulDivRound(999, 2000, 10_000)).toBe(200);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(2, 1, 3)).toBe(1);
  });

  it('convertit quantité × prix sans dérive flottante', () => {
    expect(quantityTimesPriceCents(1.5, 10_000)).toBe(15_000);
    expect(quantityTimesPriceCents(0.1 + 0.2, 100)).toBe(30);
    expect(quantityTimesPriceCents(3, 3333)).toBe(9_999);
  });

  it('répartit un montant sans perdre un centime', () => {
    const parts = allocateProportionally(100, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
    expect(allocateProportionally(0, [5, 0])).toEqual([0, 0]);
  });

  it('formate les euros en français', () => {
    expect(normalize(formatEuros(2_485_000))).toBe('24 850,00 €');
    expect(normalize(formatEuros(0))).toBe('0,00 €');
    expect(normalize(formatEuros(-1234))).toBe('−12,34 €');
    expect(normalize(formatEurosPdf(123_456))).toBe('1 234,56 €');
  });

  it('analyse les saisies utilisateur françaises et internationales', () => {
    expect(parseEuroToCents('1 234,56 €')).toBe(123_456);
    expect(parseEuroToCents('1234.56')).toBe(123_456);
    expect(parseEuroToCents('1.234,56')).toBe(123_456);
    expect(parseEuroToCents('0,5')).toBe(50);
    expect(parseEuroToCents('abc')).toBeNull();
    expect(parseEuroToCents('-12,34')).toBe(-1234);
    expect(parsePercentToBp('5,5 %')).toBe(550);
    expect(parsePercentToBp('20')).toBe(2000);
    expect(parsePercentToBp('nope')).toBeNull();
  });
});

describe('calcul des factures', () => {
  it('calcule une ligne simple avec TVA', () => {
    const computed = computeLine(line({ quantity: 2, unitPriceCents: 50_000 }));
    expect(computed.grossCents).toBe(100_000);
    expect(computed.netCents).toBe(100_000);
  });

  it('applique une remise en pourcentage', () => {
    const computed = computeLine(line({ quantity: 2, unitPriceCents: 50_000, discountType: 'percent', discountValue: 1000 }));
    expect(computed.grossCents).toBe(100_000);
    expect(computed.discountCents).toBe(10_000);
    expect(computed.netCents).toBe(90_000);
  });

  it('applique une remise en montant sans dépasser le total', () => {
    const computed = computeLine(line({ unitPriceCents: 10_000, discountType: 'amount', discountValue: 50_000 }));
    expect(computed.discountCents).toBe(10_000);
    expect(computed.netCents).toBe(0);
  });

  it('ventile la TVA par taux et totalise exactement', () => {
    const result = computeInvoiceTotals(
      [
        line({ designation: 'Service', quantity: 1, unitPriceCents: 100_000, vatRateBp: 2000 }),
        line({ designation: 'Produit', quantity: 2, unitPriceCents: 25_000, vatRateBp: 1000 }),
      ],
      'none',
      0,
    );
    expect(result.totals.totalHtCents).toBe(150_000);
    expect(result.totals.vatBreakdown).toEqual([
      { rateBp: 1000, baseCents: 50_000, vatCents: 5_000 },
      { rateBp: 2000, baseCents: 100_000, vatCents: 20_000 },
    ]);
    expect(result.totals.totalVatCents).toBe(25_000);
    expect(result.totals.totalTtcCents).toBe(175_000);
    expect(result.lines.reduce((acc, l) => acc + l.vatCents, 0)).toBe(25_000);
    expect(result.lines.reduce((acc, l) => acc + l.ttcCents, 0)).toBe(175_000);
  });

  it('répartit une remise globale sur plusieurs taux sans écart', () => {
    const result = computeInvoiceTotals(
      [
        line({ designation: 'A', quantity: 1, unitPriceCents: 100_000, vatRateBp: 2000 }),
        line({ designation: 'B', quantity: 1, unitPriceCents: 50_000, vatRateBp: 1000 }),
        line({ designation: 'C', quantity: 3, unitPriceCents: 9_999, vatRateBp: 2000 }),
      ],
      'percent',
      1000,
    );
    const sumLines = result.lines.reduce((acc, l) => acc + l.netCents, 0);
    expect(result.totals.subtotalCents).toBe(sumLines);
    expect(result.totals.globalDiscountCents).toBe(Math.round(result.totals.subtotalCents * 0.1));
    const totalHt = result.lines.reduce((acc, l) => acc + l.taxableBaseCents, 0);
    expect(result.totals.totalHtCents).toBe(totalHt);
    const totalVat = result.lines.reduce((acc, l) => acc + l.vatCents, 0);
    expect(result.totals.totalVatCents).toBe(totalVat);
    expect(result.totals.totalTtcCents).toBe(totalHt + totalVat);
    expect(result.totals.vatBreakdown.reduce((acc, v) => acc + v.vatCents, 0)).toBe(totalVat);
  });

  it('gère des montants avec arrondis difficiles', () => {
    const result = computeInvoiceTotals(
      [
        line({ quantity: 3, unitPriceCents: 3333, vatRateBp: 2000 }),
        line({ quantity: 1, unitPriceCents: 1, vatRateBp: 550 }),
      ],
      'percent',
      333,
    );
    const totalHt = result.lines.reduce((acc, l) => acc + l.taxableBaseCents, 0);
    expect(result.totals.totalHtCents).toBe(totalHt);
    expect(result.totals.totalTtcCents).toBe(
      result.totals.totalHtCents + result.totals.totalVatCents,
    );
  });

  it('gère la franchise en base (TVA nulle)', () => {
    const result = computeInvoiceTotals(
      [line({ quantity: 1, unitPriceCents: 100_000, vatRateBp: 0 })],
      'none',
      0,
    );
    expect(result.totals.totalVatCents).toBe(0);
    expect(result.totals.totalTtcCents).toBe(100_000);
  });
});
