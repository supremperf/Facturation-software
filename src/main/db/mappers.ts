import type { SqlValue } from 'sql.js';
import type {
  ActivityItem,
  Address,
  Client,
  ClientSnapshot,
  Invoice,
  InvoiceLineComputed,
  InvoiceStatus,
  InvoiceTotals,
  LegalSnapshot,
  Payment,
  SellerSnapshot,
  VatBreakdownEntry,
} from '@shared/types';
import { computeEffectiveStatus, createDefaultSettings } from '@shared/constants';

type Row = Record<string, SqlValue>;

export function str(row: Row, key: string, fallback = ''): string {
  const value = row[key];
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);
}

export function num(row: Row, key: string, fallback = 0): number {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value ?? fallback);
}

export function bool(row: Row, key: string, fallback = false): boolean {
  const value = row[key];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

export function safeJson<T>(value: SqlValue | undefined, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function normalizeAddress(input: Partial<Address> | null | undefined): Address {
  return {
    line1: (input?.line1 ?? '').trim(),
    line2: (input?.line2 ?? '').trim(),
    postalCode: (input?.postalCode ?? '').trim(),
    city: (input?.city ?? '').trim(),
    country: (input?.country ?? 'France').trim() || 'France',
  };
}

export function hasDeliveryAddress(row: Row): boolean {
  return Boolean(str(row, 'delivery_line1') || str(row, 'delivery_city') || str(row, 'delivery_postal_code'));
}

export function rowToClient(row: Row): Client {
  return {
    id: str(row, 'id'),
    type: str(row, 'type', 'professionnel') === 'particulier' ? 'particulier' : 'professionnel',
    civility: str(row, 'civility'),
    firstName: str(row, 'first_name'),
    lastName: str(row, 'last_name'),
    companyName: str(row, 'company_name'),
    legalForm: str(row, 'legal_form'),
    siren: str(row, 'siren'),
    siret: str(row, 'siret'),
    vatNumber: str(row, 'vat_number'),
    vatSubject: bool(row, 'vat_subject', true),
    email: str(row, 'email'),
    phone: str(row, 'phone'),
    address: normalizeAddress({
      line1: str(row, 'address_line1'),
      line2: str(row, 'address_line2'),
      postalCode: str(row, 'postal_code'),
      city: str(row, 'city'),
      country: str(row, 'country'),
    }),
    deliveryAddress: hasDeliveryAddress(row)
      ? normalizeAddress({
          line1: str(row, 'delivery_line1'),
          line2: str(row, 'delivery_line2'),
          postalCode: str(row, 'delivery_postal_code'),
          city: str(row, 'delivery_city'),
          country: str(row, 'delivery_country') || 'France',
        })
      : null,
    notes: str(row, 'notes'),
    isArchived: bool(row, 'is_archived'),
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
    invoiceCount: row.invoice_count === undefined ? undefined : num(row, 'invoice_count'),
    totalBilledCents: row.total_billed_cents === undefined ? undefined : num(row, 'total_billed_cents'),
    outstandingCents: row.outstanding_cents === undefined ? undefined : num(row, 'outstanding_cents'),
  };
}

export function rowToLine(row: Row): InvoiceLineComputed {
  return {
    id: str(row, 'id'),
    position: num(row, 'position'),
    designation: str(row, 'designation'),
    description: str(row, 'description'),
    reference: str(row, 'reference'),
    quantity: num(row, 'quantity'),
    unit: str(row, 'unit'),
    unitPriceCents: num(row, 'unit_price_cents'),
    discountType: (str(row, 'discount_type', 'none') as InvoiceLineComputed['discountType']) || 'none',
    discountValue: num(row, 'discount_value'),
    vatRateBp: num(row, 'vat_rate_bp'),
    isExtraFee: bool(row, 'is_extra_fee'),
    operationNature: (str(row, 'operation_nature') as InvoiceLineComputed['operationNature']) || '',
    grossCents: num(row, 'gross_cents'),
    discountCents: num(row, 'discount_cents'),
    netCents: num(row, 'net_cents'),
    allocatedDiscountCents: num(row, 'allocated_discount_cents'),
    taxableBaseCents: num(row, 'taxable_base_cents'),
    vatCents: num(row, 'vat_cents'),
    ttcCents: num(row, 'ttc_cents'),
  };
}

export function lineInsertParams(
  invoiceId: string,
  line: InvoiceLineComputed,
  position: number,
  newId: string,
): SqlValue[] {
  return [
    newId,
    invoiceId,
    position,
    line.designation,
    line.description ?? '',
    line.reference ?? '',
    line.quantity,
    line.unit,
    line.unitPriceCents,
    line.discountType,
    line.discountValue,
    line.vatRateBp,
    line.isExtraFee ? 1 : 0,
    line.operationNature ?? '',
    line.grossCents,
    line.discountCents,
    line.netCents,
    line.allocatedDiscountCents,
    line.taxableBaseCents,
    line.vatCents,
    line.ttcCents,
  ];
}

export function rowToInvoice(row: Row, lines: InvoiceLineComputed[]): Invoice {
  const paidCents = num(row, 'paid_cents');
  const totalTtcCents = num(row, 'total_ttc_cents');
  const creditedCents = num(row, 'credited_cents');
  const balanceCents = Math.max(0, totalTtcCents - paidCents - creditedCents);
  const totals: InvoiceTotals = {
    subtotalCents: num(row, 'subtotal_cents'),
    lineDiscountCents: num(row, 'line_discount_cents'),
    globalDiscountCents: num(row, 'global_discount_cents'),
    totalHtCents: num(row, 'total_ht_cents'),
    totalVatCents: num(row, 'total_vat_cents'),
    totalTtcCents,
    vatBreakdown: safeJson<VatBreakdownEntry[]>(row.vat_breakdown, []),
  };
  const status = str(row, 'status', 'draft') as InvoiceStatus;
  const invoice: Invoice = {
    id: str(row, 'id'),
    type: str(row, 'type', 'invoice') === 'credit_note' ? 'credit_note' : 'invoice',
    number: str(row, 'number') || null,
    status,
    issueDate: str(row, 'issue_date'),
    dueDate: str(row, 'due_date'),
    serviceDate: str(row, 'service_date'),
    clientId: str(row, 'client_id') || null,
    clientSnapshot: safeJson<ClientSnapshot>(row.client_snapshot, {
      id: null,
      displayName: str(row, 'client_name'),
      type: 'professionnel',
      civility: '',
      firstName: '',
      lastName: '',
      companyName: str(row, 'client_name'),
      legalForm: '',
      siren: '',
      siret: '',
      vatNumber: '',
      vatSubject: true,
      email: '',
      phone: '',
      address: normalizeAddress(null),
      deliveryAddress: null,
    }),
    sellerSnapshot: safeJson<SellerSnapshot>(row.seller_snapshot, {} as SellerSnapshot),
    legalSnapshot: safeJson<LegalSnapshot>(row.legal_snapshot, buildFallbackLegalSnapshot()),
    billingAddress: safeJson<Address>(row.billing_address, normalizeAddress(null)),
    deliveryAddress: row.delivery_address ? safeJson<Address | null>(row.delivery_address, null) : null,
    purchaseOrder: str(row, 'purchase_order'),
    operationNature: (str(row, 'operation_nature', 'services') as Invoice['operationNature']) || 'services',
    description: str(row, 'description'),
    paymentTerms: str(row, 'payment_terms'),
    paymentMethod: (str(row, 'payment_method', 'virement') as Invoice['paymentMethod']) || 'virement',
    notes: str(row, 'notes'),
    lines,
    globalDiscountType: (str(row, 'global_discount_type', 'none') as Invoice['globalDiscountType']) || 'none',
    globalDiscountValue: num(row, 'global_discount_value'),
    totals,
    vatBreakdown: totals.vatBreakdown,
    paidCents,
    creditedCents,
    balanceCents,
    sourceInvoiceId: str(row, 'source_invoice_id') || null,
    sourceInvoiceNumber: str(row, 'source_invoice_number') || null,
    reason: str(row, 'reason'),
    pdf: str(row, 'pdf_path')
      ? {
          path: str(row, 'pdf_path'),
          sha256: str(row, 'pdf_sha256'),
          generatedAt: str(row, 'pdf_generated_at'),
          size: num(row, 'pdf_size'),
        }
      : null,
    issuedAt: str(row, 'issued_at') || null,
    sentAt: str(row, 'sent_at') || null,
    createdAt: str(row, 'created_at'),
    updatedAt: str(row, 'updated_at'),
  };
  invoice.effectiveStatus = computeEffectiveStatus(invoice, new Date().toISOString().slice(0, 10));
  return invoice;
}

export function rowToPayment(row: Row): Payment {
  return {
    id: str(row, 'id'),
    invoiceId: str(row, 'invoice_id'),
    invoiceNumber: str(row, 'number') || null,
    invoiceType: str(row, 'type', 'invoice') === 'credit_note' ? 'credit_note' : 'invoice',
    clientName: str(row, 'client_name'),
    date: str(row, 'date'),
    amountCents: num(row, 'amount_cents'),
    method: (str(row, 'method', 'virement') as Payment['method']) || 'virement',
    reference: str(row, 'reference'),
    note: str(row, 'note'),
    createdAt: str(row, 'created_at'),
  };
}

export function rowToActivity(row: Row): ActivityItem {
  return {
    id: str(row, 'id'),
    type: str(row, 'type', 'system') as ActivityItem['type'],
    title: str(row, 'title'),
    detail: str(row, 'detail'),
    entityType: (str(row, 'entity_type', 'system') as ActivityItem['entityType']) || 'system',
    entityId: str(row, 'entity_id') || null,
    createdAt: str(row, 'created_at'),
  };
}

/** Fusion récursive des réglages enregistrés avec les valeurs par défaut. */
export function mergeSettings<T>(defaults: T, stored: unknown): T {
  if (stored === null || stored === undefined) return defaults;
  if (Array.isArray(defaults)) {
    return (Array.isArray(stored) ? stored : defaults) as T;
  }
  if (typeof defaults === 'object' && defaults !== null) {
    if (typeof stored !== 'object' || stored === null) return defaults;
    const result: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
    for (const key of Object.keys(defaults as Record<string, unknown>)) {
      result[key] = mergeSettings(
        (defaults as Record<string, unknown>)[key],
        (stored as Record<string, unknown>)[key],
      );
    }
    return result as T;
  }
  return (stored === undefined ? defaults : stored) as T;
}

export function defaultSettings() {
  return createDefaultSettings();
}

function buildFallbackLegalSnapshot(): LegalSnapshot {
  return {
    vatRegime: null,
    franchiseMention: '',
    exemptionReason: '',
    debitsOption: false,
    latePenaltyRateBp: null,
    recoveryIndemnity: false,
    escompte: '',
    mediatorName: '',
    mediatorUrl: '',
    consumerGoodsMention: '',
    invoiceFooter: '',
    eInvoicingPhase: 'unspecified',
    rulesVersion: '',
  };
}
