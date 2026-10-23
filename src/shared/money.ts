import type { DiscountType, InvoiceLineInput, InvoiceTotals, VatBreakdownEntry } from './types';

/* ------------------------------------------------------------------ */
/* Arithmétique monétaire exacte (entiers de centimes)                 */
/* ------------------------------------------------------------------ */

const MAX_SAFE = 9_007_199_254_740_991;

function assertSafeInt(value: number, label: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > MAX_SAFE) {
    throw new Error(`${label} hors limites (${String(value)}).`);
  }
}

/** Division entière arrondie au plus proche, à l'écart de zéro (half-up). */
export function divRound(numerator: bigint, denominator: bigint): number {
  if (denominator === 0n) throw new Error('Division par zéro.');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n + d / 2n) / d;
  const result = negative ? -q : q;
  if (result > BigInt(MAX_SAFE) || result < BigInt(-MAX_SAFE)) {
    throw new Error('Résultat monétaire hors limites.');
  }
  return Number(result);
}

/** a × b / d, arrondi half-up, sans dépassement de capacité. */
export function mulDivRound(a: number, b: number, d: number): number {
  assertSafeInt(a, 'Montant');
  assertSafeInt(b, 'Montant');
  assertSafeInt(d, 'Diviseur');
  return divRound(BigInt(Math.trunc(a)) * BigInt(Math.trunc(b)), BigInt(Math.trunc(d)));
}

/** Quantité (réelle) × prix unitaire en centimes -> centimes, arrondi half-up. */
export function quantityTimesPriceCents(quantity: number, unitPriceCents: number): number {
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Quantité invalide.');
  }
  // La quantité est convertie en millièmes pour rester en arithmétique entière.
  const milli = Math.round(quantity * 1000);
  assertSafeInt(milli, 'Quantité');
  return mulDivRound(milli, unitPriceCents, 1000);
}

/** Répartit un montant entier proportionnellement à des poids entiers (plus forts restes). */
export function allocateProportionally(total: number, weights: number[]): number[] {
  if (!Number.isInteger(total) || total < 0) throw new Error('Montant à répartir invalide.');
  const sum = weights.reduce((acc, w) => acc + w, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, index) => ({ index, fraction: v - Math.floor(v) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  const result = [...floors];
  let i = 0;
  while (remainder > 0 && order.length > 0) {
    result[order[i % order.length].index] += 1;
    remainder -= 1;
    i += 1;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Calcul des lignes                                                   */
/* ------------------------------------------------------------------ */

export interface ComputedLine extends InvoiceLineInput {
  grossCents: number;
  discountCents: number;
  netCents: number;
  allocatedDiscountCents: number;
  taxableBaseCents: number;
  vatCents: number;
  ttcCents: number;
}

export function computeLineDiscount(grossCents: number, type: DiscountType, value: number): number {
  if (grossCents <= 0) return 0;
  if (type === 'percent') {
    const bp = Math.round(value);
    if (bp <= 0) return 0;
    return Math.min(grossCents, mulDivRound(grossCents, bp, 10_000));
  }
  if (type === 'amount') {
    const cents = Math.round(value);
    if (cents <= 0) return 0;
    return Math.min(grossCents, cents);
  }
  return 0;
}

export function computeLine(line: InvoiceLineInput): ComputedLine {
  const grossCents = quantityTimesPriceCents(line.quantity, line.unitPriceCents);
  const discountCents = computeLineDiscount(grossCents, line.discountType, line.discountValue);
  const netCents = grossCents - discountCents;
  return {
    ...line,
    grossCents,
    discountCents,
    netCents,
    allocatedDiscountCents: 0,
    taxableBaseCents: netCents,
    vatCents: 0,
    ttcCents: netCents,
  };
}

export function computeGlobalDiscount(
  baseCents: number,
  type: DiscountType,
  value: number,
): number {
  if (type === 'percent') {
    const bp = Math.round(value);
    if (bp <= 0) return 0;
    return Math.min(baseCents, mulDivRound(baseCents, Math.min(bp, 10_000), 10_000));
  }
  if (type === 'amount') {
    return Math.min(baseCents, Math.max(0, Math.round(value)));
  }
  return 0;
}

/**
 * Calcule les totaux d'un document.
 *
 * Règles :
 *  - remise de ligne arrondie au centime ;
 *  - remise globale répartie au prorata des lignes (méthode des plus forts restes) ;
 *  - TVA calculée PAR TAUX sur l'assiette après remise globale, arrondie au centime ;
 *  - la TVA de chaque ligne est répartie depuis la TVA du taux afin que la somme
 *    des lignes soit EXACTEMENT égale au total affiché (aucun écart d'arrondi).
 */
export function computeInvoiceTotals(
  rawLines: InvoiceLineInput[],
  globalDiscountType: DiscountType,
  globalDiscountValue: number,
): { lines: ComputedLine[]; totals: InvoiceTotals } {
  const lines = rawLines.map(computeLine);
  const subtotalCents = lines.reduce((acc, l) => acc + l.grossCents, 0);
  const lineDiscountCents = lines.reduce((acc, l) => acc + l.discountCents, 0);
  const netTotal = lines.reduce((acc, l) => acc + l.netCents, 0);
  const globalDiscountCents = computeGlobalDiscount(netTotal, globalDiscountType, globalDiscountValue);

  // Répartition de la remise globale sur les lignes, au prorata du net.
  const shares = allocateProportionally(globalDiscountCents, lines.map((l) => l.netCents));
  lines.forEach((line, index) => {
    line.allocatedDiscountCents = shares[index] ?? 0;
    line.taxableBaseCents = line.netCents - line.allocatedDiscountCents;
  });

  // Regroupement par taux de TVA.
  const rateMap = new Map<number, { base: number; indices: number[] }>();
  lines.forEach((line, index) => {
    const rate = Math.round(line.vatRateBp);
    const entry = rateMap.get(rate) ?? { base: 0, indices: [] };
    entry.base += line.taxableBaseCents;
    entry.indices.push(index);
    rateMap.set(rate, entry);
  });

  const vatBreakdown: VatBreakdownEntry[] = [];
  const sortedRates = [...rateMap.keys()].sort((a, b) => a - b);
  for (const rate of sortedRates) {
    const entry = rateMap.get(rate)!;
    const vatCents = mulDivRound(entry.base, rate, 10_000);
    vatBreakdown.push({ rateBp: rate, baseCents: entry.base, vatCents });
    // Répartition exacte de la TVA du taux sur ses lignes.
    const vatShares = allocateProportionally(
      vatCents,
      entry.indices.map((i) => lines[i].taxableBaseCents),
    );
    entry.indices.forEach((lineIndex, i) => {
      lines[lineIndex].vatCents = vatShares[i] ?? 0;
    });
  }

  lines.forEach((line) => {
    line.ttcCents = line.taxableBaseCents + line.vatCents;
  });

  const totalHtCents = lines.reduce((acc, l) => acc + l.taxableBaseCents, 0);
  const totalVatCents = vatBreakdown.reduce((acc, v) => acc + v.vatCents, 0);
  const totalTtcCents = totalHtCents + totalVatCents;

  return {
    lines,
    totals: {
      subtotalCents,
      lineDiscountCents,
      globalDiscountCents,
      totalHtCents,
      totalVatCents,
      totalTtcCents,
      vatBreakdown,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Formatage / analyse                                                 */
/* ------------------------------------------------------------------ */

const euroFormatter = new Intl.NumberFormat('fr-FR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

export function formatEuros(cents: number, options?: { withSymbol?: boolean; signed?: boolean }): string {
  const withSymbol = options?.withSymbol ?? true;
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const sign = options?.signed && safe > 0 ? '+' : '';
  const formatted = euroFormatter.format(Math.abs(safe) / 100);
  const negative = safe < 0 ? '−' : '';
  // Espace insécable avant le symbole € pour éviter une coupure de ligne.
  return `${sign}${negative}${formatted}${withSymbol ? '\u00a0€' : ''}`;
}

export function formatEurosPdf(cents: number): string {
  return formatEuros(cents).replace(/\u202f/g, '\u00a0');
}

export function formatNumber(value: number, decimals = 2): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatQuantity(quantity: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(quantity);
}

export function formatPercentFromBp(bp: number, decimals = 2): string {
  return `${new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  }).format(bp / 100)}\u00a0%`;
}

export function formatPercentValueFromBp(bp: number): string {
  return formatPercentFromBp(bp);
}

/** Analyse une saisie utilisateur en euros : « 1 234,56 », « 1234.56 », « 1.234,56 € ». */
export function parseEuroToCents(input: string | number): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  let value = input.trim();
  if (!value) return null;
  const negative = /^-/.test(value) || /^−/.test(value);
  value = value.replace(/[€\s\u00a0\u202f]/g, '').replace(/[−-]/g, '');
  if (!/^[\d.,]+$/.test(value)) return null;
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Le séparateur décimal est le dernier des deux.
    if (lastComma > lastDot) {
      value = value.replace(/\./g, '').replace(',', '.');
    } else {
      value = value.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    value = value.replace(/,/g, '.');
  }
  if (!/^\d+(\.\d+)?$/.test(value)) return null;
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || Math.abs(cents) > MAX_SAFE) return null;
  return negative ? -cents : cents;
}

/** Analyse un pourcentage saisi ("20", "5,5", "5.5 %") -> points de base. */
export function parsePercentToBp(input: string | number): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null;
  }
  const cleaned = input.replace(/[%\s\u00a0\u202f]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function centsToEuroInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function bpToPercentInput(bp: number | null | undefined): string {
  if (bp === null || bp === undefined || !Number.isFinite(bp)) return '';
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(bp / 100);
}

/** Somme sûre de centimes. */
export function sumCents(values: number[]): number {
  return values.reduce((acc, v) => acc + (Number.isFinite(v) ? Math.round(v) : 0), 0);
}
