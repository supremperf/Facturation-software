import crypto from 'node:crypto';
import type { SqlValue } from 'sql.js';
import type {
  ActivityItem,
  ActivityType,
  AppSettings,
  Client,
  ClientInput,
  ClientSnapshot,
  DocumentType,
  Invoice,
  InvoiceDraftInput,
  InvoiceLineComputed,
  InvoiceListFilters,
  InvoiceStatus,
  InvoiceSummary,
  Paginated,
  Payment,
  PaymentInput,
  PdfMeta,
  EffectiveStatus,
  Address,
} from '@shared/types';
import type { Database } from './database';
import {
  hasDeliveryAddress,
  lineInsertParams,
  mergeSettings,
  normalizeAddress,
  num,
  rowToActivity,
  rowToClient,
  rowToInvoice,
  rowToLine,
  rowToPayment,
  safeJson,
  str,
  bool,
} from './mappers';
import { computeEffectiveStatus, createDefaultSettings, clientDisplayName, emptyAddress } from '@shared/constants';
import { AppError } from '../infra/errors';
import { buildLegalSnapshot, buildSellerSnapshot } from '@shared/legal';
import { computeInvoiceTotals } from '@shared/money';
import { normalizeAddressKey, sanitizeText, onlyDigits } from '@shared/validators';
import { nowISO, todayISO, isValidISODate } from '@shared/dates';

type Row = Record<string, SqlValue>;

export function newId(): string {
  return crypto.randomUUID();
}

export function normalizeClientInput(input: ClientInput): ClientInput {
  const address = normalizeAddress(input.address);
  const deliveryAddress = input.deliveryAddress && input.deliveryAddress.line1?.trim()
    ? normalizeAddress(input.deliveryAddress)
    : null;
  return {
    type: input.type === 'particulier' ? 'particulier' : 'professionnel',
    civility: sanitizeText(input.civility, 20),
    firstName: sanitizeText(input.firstName, 100),
    lastName: sanitizeText(input.lastName, 100),
    companyName: sanitizeText(input.companyName, 200),
    legalForm: sanitizeText(input.legalForm, 100),
    siren: onlyDigits(input.siren).slice(0, 9),
    siret: onlyDigits(input.siret).slice(0, 14),
    vatNumber: sanitizeText(input.vatNumber, 20).replace(/\s/g, '').toUpperCase(),
    vatSubject: Boolean(input.vatSubject),
    email: sanitizeText(input.email, 254),
    phone: sanitizeText(input.phone, 30),
    address,
    deliveryAddress,
    notes: sanitizeText(input.notes, 2000),
  };
}

export function clientToParams(client: Client): SqlValue[] {
  return [
    client.id,
    client.type,
    client.civility,
    client.firstName,
    client.lastName,
    client.companyName,
    client.legalForm,
    client.siren,
    client.siret,
    client.vatNumber,
    client.vatSubject ? 1 : 0,
    client.email,
    client.phone,
    client.address.line1,
    client.address.line2,
    client.address.postalCode,
    client.address.city,
    client.address.country,
    client.deliveryAddress?.line1 ?? '',
    client.deliveryAddress?.line2 ?? '',
    client.deliveryAddress?.postalCode ?? '',
    client.deliveryAddress?.city ?? '',
    client.deliveryAddress?.country ?? '',
    client.notes,
    client.isArchived ? 1 : 0,
    client.createdAt,
    client.updatedAt,
  ];
}

/* ------------------------------------------------------------------ */
/* Réglages                                                            */
/* ------------------------------------------------------------------ */

export class SettingsRepository {
  constructor(private readonly db: Database) {}

  get(): AppSettings {
    const row = this.db.get<Row>('SELECT data, updated_at FROM settings WHERE id = 1;');
    const defaults = createDefaultSettings();
    if (!row) return defaults;
    const stored = safeJson<Record<string, unknown>>(row.data, {});
    const merged = mergeSettings(defaults, stored);
    merged.updatedAt = str(row, 'updated_at') || null;
    return merged;
  }

  save(settings: AppSettings): AppSettings {
    const normalized = mergeSettings(createDefaultSettings(), settings);
    normalized.updatedAt = nowISO();
    normalized.business.address = normalizeAddress(normalized.business.address);
    normalized.business.siren = onlyDigits(normalized.business.siren);
    normalized.business.siret = onlyDigits(normalized.business.siret);
    normalized.business.vatNumber = normalized.business.vatNumber.replace(/\s/g, '').toUpperCase();
    normalized.documents.padding = Math.min(8, Math.max(2, Math.round(normalized.documents.padding)));
    normalized.fiscal.vatRates = [...new Set(normalized.fiscal.vatRates.map((r) => Math.round(r)))]
      .filter((r) => r >= 0 && r <= 10_000)
      .sort((a, b) => b - a);
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO settings (id, data, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at;`,
        [JSON.stringify(normalized), normalized.updatedAt ?? nowISO()],
      );
    });
    return normalized;
  }
}

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

export class ClientRepository {
  constructor(private readonly db: Database) {}

  private static aggregateSelect(): string {
    return `
      SELECT c.*,
        (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id AND i.status <> 'draft') AS invoice_count,
        (SELECT IFNULL(SUM(i.total_ttc_cents), 0) FROM invoices i
          WHERE i.client_id = c.id AND i.type = 'invoice' AND i.status NOT IN ('draft','cancelled')) AS total_billed_cents,
        (SELECT IFNULL(SUM(MAX(i.total_ttc_cents - i.credited_cents -
            (SELECT IFNULL(SUM(p.amount_cents), 0) FROM payments p WHERE p.invoice_id = i.id), 0)), 0)
          FROM invoices i WHERE i.client_id = c.id AND i.type = 'invoice'
          AND i.status NOT IN ('draft','cancelled')) AS outstanding_cents
      FROM clients c`;
  }

  list(options: {
    query?: string;
    type?: 'particulier' | 'professionnel' | 'all';
    includeArchived?: boolean;
    sort?: 'name' | 'created' | 'revenue';
  } = {}): Client[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (!options.includeArchived) where.push('c.is_archived = 0');
    if (options.type && options.type !== 'all') {
      where.push('c.type = ?');
      params.push(options.type);
    }
    const query = (options.query ?? '').trim();
    if (query) {
      const like = `%${query.toLowerCase()}%`;
      where.push(
        `(lower(c.first_name) LIKE ? OR lower(c.last_name) LIKE ? OR lower(c.company_name) LIKE ?
          OR lower(c.email) LIKE ? OR c.siren LIKE ? OR c.siret LIKE ? OR lower(c.city) LIKE ?)`,
      );
      params.push(like, like, like, like, like, like, like);
    }
    const order =
      options.sort === 'created'
        ? 'c.created_at DESC'
        : options.sort === 'revenue'
          ? 'total_billed_cents DESC'
          : 'COALESCE(NULLIF(c.company_name, ""), c.last_name, c.first_name) COLLATE NOCASE ASC';
    const sql = `${ClientRepository.aggregateSelect()} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order};`;
    return this.db.all<Row>(sql, params).map(rowToClient);
  }

  get(id: string): Client | null {
    const row = this.db.get<Row>(`${ClientRepository.aggregateSelect()} WHERE c.id = ?;`, [id]);
    return row ? rowToClient(row) : null;
  }

  findBySiren(siren: string): Client | null {
    const row = this.db.get<Row>(`${ClientRepository.aggregateSelect()} WHERE c.siren = ?;`, [siren]);
    return row ? rowToClient(row) : null;
  }

  create(input: ClientInput): Client {
    const normalized = normalizeClientInput(input);
    const timestamp = nowISO();
    const client: Client = {
      ...normalized,
      id: newId(),
      isArchived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO clients (id, type, civility, first_name, last_name, company_name, legal_form, siren, siret,
          vat_number, vat_subject, email, phone, address_line1, address_line2, postal_code, city, country,
          delivery_line1, delivery_line2, delivery_postal_code, delivery_city, delivery_country, notes,
          is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        clientToParams(client),
      );
    });
    return this.get(client.id)!;
  }

  update(id: string, input: ClientInput): Client {
    const existing = this.get(id);
    if (!existing) throw new AppError('Client introuvable.', 'NOT_FOUND');
    const normalized = normalizeClientInput(input);
    const timestamp = nowISO();
    this.db.transaction(() => {
      this.db.run(
        `UPDATE clients SET type = ?, civility = ?, first_name = ?, last_name = ?, company_name = ?, legal_form = ?,
           siren = ?, siret = ?, vat_number = ?, vat_subject = ?, email = ?, phone = ?,
           address_line1 = ?, address_line2 = ?, postal_code = ?, city = ?, country = ?,
           delivery_line1 = ?, delivery_line2 = ?, delivery_postal_code = ?, delivery_city = ?, delivery_country = ?,
           notes = ?, updated_at = ?
         WHERE id = ?;`,
        [
          normalized.type,
          normalized.civility,
          normalized.firstName,
          normalized.lastName,
          normalized.companyName,
          normalized.legalForm,
          normalized.siren,
          normalized.siret,
          normalized.vatNumber,
          normalized.vatSubject ? 1 : 0,
          normalized.email,
          normalized.phone,
          normalized.address.line1,
          normalized.address.line2,
          normalized.address.postalCode,
          normalized.address.city,
          normalized.address.country,
          normalized.deliveryAddress?.line1 ?? '',
          normalized.deliveryAddress?.line2 ?? '',
          normalized.deliveryAddress?.postalCode ?? '',
          normalized.deliveryAddress?.city ?? '',
          normalized.deliveryAddress?.country ?? '',
          normalized.notes,
          timestamp,
          id,
        ],
      );
    });
    return this.get(id)!;
  }

  setArchived(id: string, archived: boolean): Client {
    const existing = this.get(id);
    if (!existing) throw new AppError('Client introuvable.', 'NOT_FOUND');
    this.db.transaction(() => {
      this.db.run('UPDATE clients SET is_archived = ?, updated_at = ? WHERE id = ?;', [
        archived ? 1 : 0,
        nowISO(),
        id,
      ]);
    });
    return this.get(id)!;
  }

  /** Suppression définitive possible uniquement sans aucune facture émise. */
  delete(id: string): void {
    const issued = Number(
      this.db.scalar<number>(
        `SELECT COUNT(*) FROM invoices WHERE client_id = ? AND status <> 'draft';`,
        [id],
      ) ?? 0,
    );
    if (issued > 0) {
      throw new Error(
        'Ce client est rattaché à des factures émises : la conservation légale des pièces comptables (10 ans) interdit sa suppression. Archivez-le à la place.',
      );
    }
    this.db.transaction(() => {
      this.db.run('DELETE FROM invoices WHERE client_id = ? AND status = ?;', [id, 'draft']);
      this.db.run('DELETE FROM clients WHERE id = ?;', [id]);
    });
  }

  buildSnapshot(client: Client): ClientSnapshot {
    return {
      id: client.id,
      displayName: clientDisplayName(client),
      type: client.type,
      civility: client.civility,
      firstName: client.firstName,
      lastName: client.lastName,
      companyName: client.companyName,
      legalForm: client.legalForm,
      siren: client.siren,
      siret: client.siret,
      vatNumber: client.vatNumber,
      vatSubject: client.vatSubject,
      email: client.email,
      phone: client.phone,
      address: client.address,
      deliveryAddress: client.deliveryAddress,
    };
  }

  count(): number {
    return Number(this.db.scalar<number>('SELECT COUNT(*) FROM clients WHERE is_archived = 0;') ?? 0);
  }
}

/* ------------------------------------------------------------------ */
/* Factures                                                            */
/* ------------------------------------------------------------------ */

export class InvoiceRepository {
  constructor(
    private readonly db: Database,
    private readonly clients: ClientRepository,
    private readonly settings: SettingsRepository,
  ) {}

  /** Expression SQL du statut effectif (une seule borne de date : aujourd'hui). */
  private caseStatusSql(): string {
    return `CASE
      WHEN i.status IN ('draft','cancelled') THEN i.status
      WHEN i.type = 'credit_note' THEN (CASE WHEN i.status = 'draft' THEN 'draft' ELSE 'issued' END)
      WHEN (i.total_ttc_cents - COALESCE(pay.paid, 0) - i.credited_cents) <= 0 THEN 'paid'
      WHEN i.due_date < ? THEN 'overdue'
      ELSE (CASE WHEN i.status = 'paid' THEN 'issued' ELSE i.status END)
    END`;
  }

  getRaw(id: string): Row | null {
    return this.db.get<Row>(
      `SELECT i.*, COALESCE(pay.paid, 0) AS paid_cents
       FROM invoices i
       LEFT JOIN (SELECT invoice_id, SUM(amount_cents) AS paid FROM payments GROUP BY invoice_id) pay
         ON pay.invoice_id = i.id
       WHERE i.id = ?;`,
      [id],
    );
  }

  get(id: string): Invoice | null {
    const row = this.getRaw(id);
    if (!row) return null;
    const lines = this.db
      .all<Row>('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position ASC;', [id])
      .map(rowToLine);
    const invoice = rowToInvoice(row, lines);
    invoice.effectiveStatus = computeEffectiveStatus(invoice, todayISO());
    return invoice;
  }

  list(filters: InvoiceListFilters): Paginated<InvoiceSummary> {
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(filters.pageSize ?? 20)));
    const where: string[] = [];
    const params: SqlValue[] = [];
    const today = todayISO();

    if (filters.type && filters.type !== 'all') {
      where.push('i.type = ?');
      params.push(filters.type);
    }
    if (filters.clientId) {
      where.push('i.client_id = ?');
      params.push(filters.clientId);
    }
    if (filters.dateFrom) {
      where.push('i.issue_date >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      where.push('i.issue_date <= ?');
      params.push(filters.dateTo);
    }
    if (filters.query?.trim()) {
      const like = `%${filters.query.trim().toLowerCase()}%`;
      where.push('(lower(i.number) LIKE ? OR lower(i.client_name) LIKE ?)');
      params.push(like, like);
    }

    const orderMap: Record<string, string> = {
      number: 's.number',
      clientName: 's.client_name',
      issueDate: 's.issue_date',
      dueDate: 's.due_date',
      totalTtcCents: 's.total_ttc_cents',
      balanceCents: 's.balance_cents',
      status: 's.effective_status',
    };
    const sortColumn = orderMap[filters.sortBy ?? 'issueDate'] ?? 's.issue_date';
    const direction = filters.sortDir === 'asc' ? 'ASC' : 'DESC';
    const inner = `SELECT i.*, COALESCE(pay.paid, 0) AS paid_cents,
        ${this.caseStatusSql()} AS effective_status
      FROM invoices i
      LEFT JOIN (SELECT invoice_id, SUM(amount_cents) AS paid FROM payments GROUP BY invoice_id) pay
        ON pay.invoice_id = i.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const innerParams: SqlValue[] = [today, ...params];
    const statusWhere: string[] = [];
    const statusParams: SqlValue[] = [];
    if (filters.status && filters.status !== 'all') {
      statusWhere.push('s.effective_status = ?');
      statusParams.push(filters.status);
    }
    const outerSelect = `SELECT s.*, (s.total_ttc_cents - s.paid_cents - s.credited_cents) AS balance_cents
      FROM (${inner}) s ${statusWhere.length ? `WHERE ${statusWhere.join(' AND ')}` : ''}`;
    const rows = this.db.all<Row>(
      `${outerSelect} ORDER BY ${sortColumn} ${direction} NULLS LAST, s.created_at DESC LIMIT ? OFFSET ?;`,
      [...innerParams, ...statusParams, pageSize, (page - 1) * pageSize],
    );
    const total = Number(
      this.db.scalar<number>(
        `SELECT COUNT(*) FROM (${inner}) s ${statusWhere.length ? `WHERE ${statusWhere.join(' AND ')}` : ''};`,
        [...innerParams, ...statusParams],
      ) ?? 0,
    );
    return {
      items: rows.map((row) => this.mapSummary(row)),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  listForExport(filters: {
    type?: DocumentType | 'all';
    dateFrom?: string;
    dateTo?: string;
    status?: EffectiveStatus | 'all';
    clientId?: string;
  }): Invoice[] {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (filters.type && filters.type !== 'all') {
      where.push('i.type = ?');
      params.push(filters.type);
    }
    if (filters.clientId) {
      where.push('i.client_id = ?');
      params.push(filters.clientId);
    }
    if (filters.dateFrom) {
      where.push('i.issue_date >= ?');
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      where.push('i.issue_date <= ?');
      params.push(filters.dateTo);
    }
    if (filters.status && filters.status !== 'all' && filters.status !== 'overdue' && filters.status !== 'draft') {
      where.push('i.status = ?');
      params.push(filters.status);
    }
    const rows = this.db.all<Row>(
      `SELECT i.id FROM invoices i ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY i.issue_date ASC, i.number ASC;`,
      params,
    );
    return rows
      .map((row) => this.get(str(row, 'id')))
      .filter((invoice): invoice is Invoice => Boolean(invoice));
  }

  private mapSummary(row: Row): InvoiceSummary {
    const totalTtc = num(row, 'total_ttc_cents');
    const paid = num(row, 'paid_cents');
    const credited = num(row, 'credited_cents');
    const status = str(row, 'status', 'draft') as InvoiceStatus;
    const isCredit = str(row, 'type') === 'credit_note';
    const balance = Math.max(0, totalTtc - paid - credited);
    const effective = (str(row, 'effective_status') ||
      computeEffectiveStatus(
        {
          type: str(row, 'type') === 'credit_note' ? 'credit_note' : 'invoice',
          status,
          dueDate: str(row, 'due_date'),
          balanceCents: balance,
        },
        todayISO(),
      )) as EffectiveStatus;
    return {
      id: str(row, 'id'),
      type: str(row, 'type') === 'credit_note' ? 'credit_note' : 'invoice',
      number: str(row, 'number') || null,
      clientName: str(row, 'client_name'),
      status,
      effectiveStatus: effective,
      issueDate: str(row, 'issue_date'),
      dueDate: str(row, 'due_date'),
      totalHtCents: num(row, 'total_ht_cents'),
      totalTtcCents: totalTtc,
      paidCents: paid,
      // Un avoir n'est pas une créance : il ne porte aucun solde à encaisser.
      // Son montant s'impute sur la facture d'origine (champ creditedCents).
      balanceCents: isCredit ? 0 : balance,
      hasPdf: Boolean(str(row, 'pdf_path')),
      sourceInvoiceNumber: str(row, 'source_invoice_number') || null,
      reason: str(row, 'reason'),
    };
  }

  private buildContent(input: InvoiceDraftInput, settings: AppSettings, existing?: Invoice) {
    if (!input.clientId) throw new AppError('Sélectionnez un client.', 'VALIDATION');
    const client = this.clients.get(input.clientId);
    if (!client) throw new AppError('Client introuvable.', 'NOT_FOUND');
    if (!input.lines.length) throw new AppError('Ajoutez au moins une ligne de facturation.', 'VALIDATION');
    const computed = computeInvoiceTotals(input.lines, input.globalDiscountType, input.globalDiscountValue);
    const timestamp = nowISO();
    const issueDate = isValidISODate(input.issueDate) ? input.issueDate : existing?.issueDate ?? todayISO();
    const dueDate = isValidISODate(input.dueDate) ? input.dueDate : issueDate;
    const serviceDate = isValidISODate(input.serviceDate) ? input.serviceDate : issueDate;
    const billingAddress: Address = normalizeAddress(input.billingAddress);
    const deliveryAddress =
      input.deliveryAddress && input.deliveryAddress.line1?.trim() ? normalizeAddress(input.deliveryAddress) : null;
    const sellerSnapshot = buildSellerSnapshot(settings);
    const legalSnapshot = buildLegalSnapshot(settings);
    const clientSnapshot = this.clients.buildSnapshot(client);
    const computedLines: InvoiceLineComputed[] = computed.lines.map((line, index) => ({
      ...line,
      id: crypto.randomUUID(),
      position: index,
    }));
    let sourceInvoiceNumber: string | null = existing?.sourceInvoiceNumber ?? null;
    if (input.type === 'credit_note' && input.sourceInvoiceId) {
      const sourceRow = this.db.get<Row>('SELECT number FROM invoices WHERE id = ?;', [input.sourceInvoiceId]);
      if (!sourceRow) throw new AppError('Facture d’origine introuvable.', 'NOT_FOUND');
      sourceInvoiceNumber = str(sourceRow, 'number') || null;
    }
    return {
      computed,
      computedLines,
      timestamp,
      issueDate,
      dueDate,
      serviceDate,
      billingAddress,
      deliveryAddress,
      sellerSnapshot,
      legalSnapshot,
      clientSnapshot,
      client,
      sourceInvoiceNumber,
      values: {
        clientId: client.id,
        clientName: clientSnapshot.displayName,
        purchaseOrder: sanitizeText(input.purchaseOrder, 100),
        operationNature: input.operationNature,
        description: sanitizeText(input.description, 4000),
        paymentTerms: sanitizeText(input.paymentTerms, 500),
        paymentMethod: input.paymentMethod,
        notes: sanitizeText(input.notes, 4000),
        globalDiscountType: input.globalDiscountType,
        globalDiscountValue: Math.round(input.globalDiscountValue),
      },
    };
  }

  createDraft(input: InvoiceDraftInput): Invoice {
    const settings = this.settings.get();
    if (input.type === 'credit_note' && !input.sourceInvoiceId) {
      throw new AppError('Un avoir doit référencer une facture d’origine.', 'VALIDATION');
    }
    if (input.type === 'credit_note' && !input.reason?.trim()) {
      throw new AppError('Indiquez le motif de l’avoir.', 'VALIDATION');
    }
    const built = this.buildContent(input, settings);
    const id = input.id ?? newId();
    const type: DocumentType = input.type === 'credit_note' ? 'credit_note' : 'invoice';
    const t = built.computed.totals;
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO invoices (
          id, type, number, status, issue_date, due_date, service_date, client_id, client_name, client_snapshot,
          seller_snapshot, legal_snapshot, billing_address, delivery_address, purchase_order, operation_nature,
          description, payment_terms, payment_method, notes, global_discount_type, global_discount_value,
          subtotal_cents, line_discount_cents, global_discount_cents, total_ht_cents, total_vat_cents, total_ttc_cents,
          vat_breakdown, paid_cents, credited_cents, source_invoice_id, source_invoice_number, reason, created_at, updated_at
        ) VALUES (${Array(36).fill('?').join(', ')});`,
        [
          id,
          type,
          null,
          'draft',
          built.issueDate,
          built.dueDate,
          built.serviceDate,
          built.values.clientId,
          built.values.clientName,
          JSON.stringify(built.clientSnapshot),
          JSON.stringify(built.sellerSnapshot),
          JSON.stringify(built.legalSnapshot),
          JSON.stringify(built.billingAddress),
          built.deliveryAddress ? JSON.stringify(built.deliveryAddress) : null,
          built.values.purchaseOrder,
          built.values.operationNature,
          built.values.description,
          built.values.paymentTerms,
          built.values.paymentMethod,
          built.values.notes,
          built.values.globalDiscountType,
          built.values.globalDiscountValue,
          t.subtotalCents,
          t.lineDiscountCents,
          t.globalDiscountCents,
          t.totalHtCents,
          t.totalVatCents,
          t.totalTtcCents,
          JSON.stringify(t.vatBreakdown),
          0,
          0,
          input.sourceInvoiceId ?? null,
          built.sourceInvoiceNumber,
          sanitizeText(input.reason, 500),
          built.timestamp,
          built.timestamp,
        ],
      );
      this.insertLines(id, built.computedLines);
    });
    return this.get(id)!;
  }

  updateDraft(id: string, input: InvoiceDraftInput): Invoice {
    const existing = this.get(id);
    if (!existing) throw new AppError('Facture introuvable.', 'NOT_FOUND');
    if (existing.status !== 'draft') {
      throw new AppError('Une facture émise ne peut plus être modifiée. Créez un avoir pour la corriger.', 'IMMUTABLE');
    }
    const settings = this.settings.get();
    const built = this.buildContent({ ...input, type: existing.type }, settings, existing);
    const t = built.computed.totals;
    this.db.transaction(() => {
      this.db.run(
        `UPDATE invoices SET
          client_id = ?, client_name = ?, client_snapshot = ?, seller_snapshot = ?, legal_snapshot = ?,
          billing_address = ?, delivery_address = ?, purchase_order = ?, operation_nature = ?, description = ?,
          payment_terms = ?, payment_method = ?, notes = ?, issue_date = ?, due_date = ?, service_date = ?,
          global_discount_type = ?, global_discount_value = ?, subtotal_cents = ?, line_discount_cents = ?,
          global_discount_cents = ?, total_ht_cents = ?, total_vat_cents = ?, total_ttc_cents = ?,
          vat_breakdown = ?, source_invoice_number = ?, reason = ?, updated_at = ?
        WHERE id = ? AND status = 'draft';`,
        [
          built.values.clientId,
          built.values.clientName,
          JSON.stringify(built.clientSnapshot),
          JSON.stringify(built.sellerSnapshot),
          JSON.stringify(built.legalSnapshot),
          JSON.stringify(built.billingAddress),
          built.deliveryAddress ? JSON.stringify(built.deliveryAddress) : null,
          built.values.purchaseOrder,
          built.values.operationNature,
          built.values.description,
          built.values.paymentTerms,
          built.values.paymentMethod,
          built.values.notes,
          built.issueDate,
          built.dueDate,
          built.serviceDate,
          built.values.globalDiscountType,
          built.values.globalDiscountValue,
          t.subtotalCents,
          t.lineDiscountCents,
          t.globalDiscountCents,
          t.totalHtCents,
          t.totalVatCents,
          t.totalTtcCents,
          JSON.stringify(t.vatBreakdown),
          built.sourceInvoiceNumber,
          sanitizeText(input.reason ?? existing.reason, 500),
          built.timestamp,
          id,
        ],
      );
      this.db.run('DELETE FROM invoice_lines WHERE invoice_id = ?;', [id]);
      this.insertLines(id, built.computedLines);
    });
    return this.get(id)!;
  }

  private insertLines(invoiceId: string, lines: InvoiceLineComputed[]): void {
    lines.forEach((line, index) => {
      const lineId = line.id && line.id.length === 36 ? line.id : newId();
      this.db.run(
        `INSERT INTO invoice_lines (id, invoice_id, position, designation, description, reference, quantity, unit,
          unit_price_cents, discount_type, discount_value, vat_rate_bp, is_extra_fee, operation_nature,
          gross_cents, discount_cents, net_cents, allocated_discount_cents, taxable_base_cents, vat_cents, ttc_cents)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        lineInsertParams(invoiceId, line, index, lineId),
      );
    });
  }

  /** Attribue un numéro définitif, fige les instantanés et passe le document en « émis ». */
  issue(id: string, overrideNumber?: string): Invoice {
    const existing = this.get(id);
    if (!existing) throw new AppError('Facture introuvable.', 'NOT_FOUND');
    if (existing.status !== 'draft') throw new AppError('Ce document est déjà émis.', 'IMMUTABLE');
    if (!existing.lines.length) throw new AppError('Un document sans ligne ne peut pas être émis.', 'VALIDATION');
    const settings = this.settings.get();
    const client = existing.clientId ? this.clients.get(existing.clientId) : null;
    if (existing.clientId && !client) throw new AppError('Client introuvable.', 'NOT_FOUND');
    const clientSnapshot = client ? this.clients.buildSnapshot(client) : existing.clientSnapshot;
    const recomputed = computeInvoiceTotals(existing.lines, existing.globalDiscountType, existing.globalDiscountValue);
    const year = Number(existing.issueDate.slice(0, 4));
    const number = overrideNumber ?? this.allocateNumber(existing.type, year, settings);
    const timestamp = nowISO();
    this.db.transaction(() => {
      this.db.run(
        `UPDATE invoices SET number = ?, sequence_year = ?, sequence_value = ?, status = 'issued',
           client_snapshot = ?, seller_snapshot = ?, legal_snapshot = ?, subtotal_cents = ?, line_discount_cents = ?,
           global_discount_cents = ?, total_ht_cents = ?, total_vat_cents = ?, total_ttc_cents = ?, vat_breakdown = ?,
           issued_at = ?, updated_at = ?
         WHERE id = ? AND status = 'draft';`,
        [
          number,
          year,
          Number(number.split('-').pop()),
          JSON.stringify(clientSnapshot),
          JSON.stringify(buildSellerSnapshot(settings)),
          JSON.stringify(buildLegalSnapshot(settings)),
          recomputed.totals.subtotalCents,
          recomputed.totals.lineDiscountCents,
          recomputed.totals.globalDiscountCents,
          recomputed.totals.totalHtCents,
          recomputed.totals.totalVatCents,
          recomputed.totals.totalTtcCents,
          JSON.stringify(recomputed.totals.vatBreakdown),
          timestamp,
          timestamp,
          id,
        ],
      );
    });
    return this.get(id)!;
  }

  allocateNumber(type: DocumentType, year: number, settings: AppSettings): string {
    const prefix = type === 'invoice' ? settings.documents.invoicePrefix : settings.documents.creditPrefix;
    const padding = Math.min(8, Math.max(2, settings.documents.padding));
    const keyYear = settings.documents.resetYearly ? year : 0;
    let sequenceValue = 0;
    this.db.transaction(() => {
      const existing = this.db.get<Row>(
        'SELECT last_value FROM number_sequences WHERE year = ? AND doc_type = ?;',
        [keyYear, type],
      );
      if (!existing) {
        const start = Math.max(1, Math.floor(settings.documents.startNumber ?? 1));
        this.db.run(
          'INSERT INTO number_sequences (year, doc_type, last_value, updated_at) VALUES (?, ?, ?, ?);',
          [keyYear, type, start - 1, nowISO()],
        );
      }
      this.db.run(
        'UPDATE number_sequences SET last_value = last_value + 1, updated_at = ? WHERE year = ? AND doc_type = ?;',
        [nowISO(), keyYear, type],
      );
      sequenceValue = Number(
        this.db.scalar<number>(
          'SELECT last_value FROM number_sequences WHERE year = ? AND doc_type = ?;',
          [keyYear, type],
        ) ?? 0,
      );
    });
    if (sequenceValue <= 0) throw new AppError('Erreur de numérotation.', 'NUMBERING');
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = `${prefix}-${year}-${String(sequenceValue).padStart(padding, '0')}`;
      const exists = this.db.scalar<number>('SELECT COUNT(*) FROM invoices WHERE number = ?;', [candidate]);
      if (!Number(exists)) return candidate;
      sequenceValue += 1;
      this.db.run(
        'UPDATE number_sequences SET last_value = ? WHERE year = ? AND doc_type = ?;',
        [sequenceValue, keyYear, type],
      );
      this.db.persist();
    }
    throw new AppError('Impossible d’attribuer un numéro unique.', 'NUMBERING');
  }

  previewNumber(type: DocumentType, date = todayISO()): { nextNumber: string; year: number; lastNumber: string | null } {
    const settings = this.settings.get();
    const year = Number(date.slice(0, 4));
    const keyYear = settings.documents.resetYearly ? year : 0;
    const prefix = type === 'invoice' ? settings.documents.invoicePrefix : settings.documents.creditPrefix;
    const padding = Math.min(8, Math.max(2, settings.documents.padding));
    const row = this.db.get<Row>(
      'SELECT last_value FROM number_sequences WHERE year = ? AND doc_type = ?;',
      [keyYear, type],
    );
    const nextValue = row ? num(row, 'last_value') + 1 : Math.max(1, Math.floor(settings.documents.startNumber ?? 1));
    const lastRow = this.db.get<Row>(
      `SELECT number FROM invoices WHERE type = ? AND number IS NOT NULL AND number LIKE ?
       ORDER BY issue_date DESC, sequence_value DESC LIMIT 1;`,
      [type, `%${year}%`],
    );
    return {
      nextNumber: `${prefix}-${year}-${String(nextValue).padStart(padding, '0')}`,
      year,
      lastNumber: lastRow ? str(lastRow, 'number') : null,
    };
  }

  setPdf(id: string, meta: PdfMeta): void {
    this.db.transaction(() => {
      this.db.run(
        'UPDATE invoices SET pdf_path = ?, pdf_sha256 = ?, pdf_generated_at = ?, pdf_size = ?, updated_at = ? WHERE id = ?;',
        [meta.path, meta.sha256, meta.generatedAt, meta.size, nowISO(), id],
      );
    });
  }

  saveLegalReport(id: string, report: unknown): void {
    this.db.run('UPDATE invoices SET legal_report = ? WHERE id = ?;', [JSON.stringify(report), id]);
  }

  markSent(id: string): Invoice {
    const invoice = this.get(id);
    if (!invoice) throw new AppError('Facture introuvable.', 'NOT_FOUND');
    if (invoice.status === 'draft') throw new AppError('Émettez la facture avant de la marquer comme envoyée.', 'IMMUTABLE');
    this.db.transaction(() => {
      this.db.run(
        "UPDATE invoices SET sent_at = ?, status = CASE WHEN status = 'issued' THEN 'sent' ELSE status END, updated_at = ? WHERE id = ?;",
        [nowISO(), nowISO(), id],
      );
    });
    return this.get(id)!;
  }

  deleteDraft(id: string): void {
    const invoice = this.get(id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    if (invoice.status !== 'draft') {
      throw new AppError('Seuls les brouillons peuvent être supprimés. Une facture émise doit être corrigée par un avoir.', 'IMMUTABLE');
    }
    this.db.transaction(() => {
      this.db.run('DELETE FROM invoices WHERE id = ?;', [id]);
    });
  }

  recalculateState(invoiceId: string): void {
    const invoice = this.get(invoiceId);
    if (!invoice || invoice.status === 'draft') return;
    const paid = Number(
      this.db.scalar<number>('SELECT IFNULL(SUM(amount_cents), 0) FROM payments WHERE invoice_id = ?;', [invoiceId]) ?? 0,
    );
    const credited =
      invoice.type === 'invoice'
        ? Number(
            this.db.scalar<number>(
              "SELECT IFNULL(SUM(total_ttc_cents), 0) FROM invoices WHERE source_invoice_id = ? AND type = 'credit_note' AND status <> 'draft';",
              [invoiceId],
            ) ?? 0,
          )
        : 0;
    const total = invoice.totals.totalTtcCents;
    const balance = Math.max(0, total - paid - credited);
    let status: InvoiceStatus = invoice.status;
    if (invoice.type === 'invoice') {
      if (balance <= 0) status = paid >= total && total > 0 ? 'paid' : 'cancelled';
      else if (paid > 0) status = 'partial';
      else status = invoice.sentAt ? 'sent' : 'issued';
    } else {
      status = 'issued';
    }
    this.db.transaction(() => {
      this.db.run(
        'UPDATE invoices SET paid_cents = ?, credited_cents = ?, status = ?, updated_at = ? WHERE id = ?;',
        [paid, credited, status, nowISO(), invoiceId],
      );
    });
  }

  markCreditNoteIssued(id: string, sourceInvoiceId: string): void {
    const source = this.get(sourceInvoiceId);
    if (!source) throw new AppError('Facture d’origine introuvable.', 'NOT_FOUND');
    if (source.type !== 'invoice') throw new AppError('Un avoir ne peut référencer qu’une facture.', 'VALIDATION');
    const alreadyCredited = Number(
      this.db.scalar<number>(
        "SELECT IFNULL(SUM(total_ttc_cents), 0) FROM invoices WHERE source_invoice_id = ? AND type = 'credit_note' AND status <> 'draft' AND id <> ?;",
        [sourceInvoiceId, id],
      ) ?? 0,
    );
    const credit = this.get(id);
    if (!credit) throw new AppError('Avoir introuvable.', 'NOT_FOUND');
    if (credit.totals.totalTtcCents + alreadyCredited > source.totals.totalTtcCents) {
      throw new AppError('Le montant cumulé des avoirs dépasse le montant de la facture d’origine.', 'CREDIT_LIMIT');
    }
    this.recalculateState(sourceInvoiceId);
  }

  creditNotesFor(invoiceId: string): InvoiceSummary[] {
    return this.db
      .all<Row>(
        `SELECT i.*, COALESCE(pay.paid, 0) AS paid_cents, 'issued' AS effective_status
         FROM invoices i
         LEFT JOIN (SELECT invoice_id, SUM(amount_cents) AS paid FROM payments GROUP BY invoice_id) pay
           ON pay.invoice_id = i.id
         WHERE i.source_invoice_id = ? AND i.type = 'credit_note' AND i.status <> 'draft'
         ORDER BY i.issue_date DESC;`,
        [invoiceId],
      )
      .map((row) => this.mapSummary(row));
  }

  recent(limit = 6): InvoiceSummary[] {
    const rows = this.db.all<Row>(
      `SELECT i.*, COALESCE(pay.paid, 0) AS paid_cents,
        ${this.caseStatusSql()} AS effective_status
       FROM invoices i
       LEFT JOIN (SELECT invoice_id, SUM(amount_cents) AS paid FROM payments GROUP BY invoice_id) pay
         ON pay.invoice_id = i.id
       WHERE i.status <> 'draft'
       ORDER BY i.created_at DESC
       LIMIT ?;`,
      [todayISO(), limit],
    );
    return rows.map((row) => this.mapSummary(row));
  }

  countByStatus(): Record<EffectiveStatus, number> {
    const result: Record<EffectiveStatus, number> = {
      draft: 0,
      issued: 0,
      sent: 0,
      partial: 0,
      paid: 0,
      overdue: 0,
      cancelled: 0,
    };
    const rows = this.db.all<Row>(
      `SELECT ${this.caseStatusSql()} AS status, COUNT(*) AS n
       FROM invoices i
       LEFT JOIN (SELECT invoice_id, SUM(amount_cents) AS paid FROM payments GROUP BY invoice_id) pay
         ON pay.invoice_id = i.id
       GROUP BY status;`,
      [todayISO()],
    );
    for (const row of rows) {
      const status = str(row, 'status') as EffectiveStatus;
      if (status in result) result[status] = num(row, 'n');
    }
    return result;
  }

  numberExists(number: string, excludeId?: string): boolean {
    const count = this.db.scalar<number>(
      'SELECT COUNT(*) FROM invoices WHERE number = ? AND id <> ?;',
      [number, excludeId ?? ''],
    );
    return Number(count) > 0;
  }

  duplicateAsDraft(sourceId: string): Invoice {
    const source = this.get(sourceId);
    if (!source) throw new AppError('Document introuvable.', 'NOT_FOUND');
    const today = todayISO();
    return this.createDraft({
      type: source.type,
      clientId: source.clientId,
      issueDate: today,
      dueDate: today,
      serviceDate: today,
      billingAddress: source.billingAddress,
      deliveryAddress: source.deliveryAddress,
      purchaseOrder: source.purchaseOrder,
      operationNature: source.operationNature,
      description: source.description,
      paymentTerms: source.paymentTerms,
      paymentMethod: source.paymentMethod,
      notes: source.notes,
      lines: source.lines,
      globalDiscountType: source.globalDiscountType,
      globalDiscountValue: source.globalDiscountValue,
      sourceInvoiceId: source.sourceInvoiceId,
      reason: source.reason,
    });
  }

  lastSequenceYear(): number | null {
    const value = this.db.scalar<number>('SELECT MAX(sequence_year) FROM invoices WHERE sequence_year IS NOT NULL;');
    return value === null || value === undefined ? null : Number(value);
  }
}

/* ------------------------------------------------------------------ */
/* Paiements                                                           */
/* ------------------------------------------------------------------ */

export class PaymentRepository {
  constructor(
    private readonly db: Database,
    private readonly invoices: InvoiceRepository,
  ) {}

  list(options: { query?: string; dateFrom?: string; dateTo?: string; invoiceId?: string; page?: number; pageSize?: number } = {}): Paginated<Payment> {
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Math.floor(options.pageSize ?? 20)));
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (options.invoiceId) {
      where.push('p.invoice_id = ?');
      params.push(options.invoiceId);
    }
    if (options.dateFrom) {
      where.push('p.date >= ?');
      params.push(options.dateFrom);
    }
    if (options.dateTo) {
      where.push('p.date <= ?');
      params.push(options.dateTo);
    }
    if (options.query?.trim()) {
      const like = `%${options.query.trim().toLowerCase()}%`;
      where.push('(lower(i.client_name) LIKE ? OR lower(i.number) LIKE ? OR lower(p.reference) LIKE ?)');
      params.push(like, like, like);
    }
    const from = `FROM payments p JOIN invoices i ON i.id = p.invoice_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
    const rows = this.db.all<Row>(
      `SELECT p.*, i.number, i.type, i.client_name ${from} ORDER BY p.date DESC, p.created_at DESC LIMIT ? OFFSET ?;`,
      [...params, pageSize, (page - 1) * pageSize],
    );
    const total = Number(this.db.scalar<number>(`SELECT COUNT(*) ${from};`, params) ?? 0);
    return {
      items: rows.map(rowToPayment),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  forInvoice(invoiceId: string): Payment[] {
    return this.db
      .all<Row>(
        `SELECT p.*, i.number, i.type, i.client_name FROM payments p JOIN invoices i ON i.id = p.invoice_id
         WHERE p.invoice_id = ? ORDER BY p.date ASC, p.created_at ASC;`,
        [invoiceId],
      )
      .map(rowToPayment);
  }

  create(input: PaymentInput): Payment {
    const invoice = this.invoices.get(input.invoiceId);
    if (!invoice) throw new AppError('Facture introuvable.', 'NOT_FOUND');
    if (invoice.status === 'draft') throw new AppError('Enregistrez d’abord l’émission de la facture.', 'IMMUTABLE');
    if (invoice.type !== 'invoice') throw new AppError('Un avoir ne peut pas recevoir de paiement.', 'VALIDATION');
    if (invoice.status === 'cancelled') throw new AppError('Cette facture est soldée par avoir : aucun paiement supplémentaire n’est possible.', 'PAYMENT_LIMIT');
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new AppError('Le montant du paiement doit être positif.', 'VALIDATION');
    if (input.amountCents > invoice.balanceCents) {
      throw new Error(`Le montant dépasse le solde restant dû (${(invoice.balanceCents / 100).toFixed(2)} €).`);
    }
    if (!isValidISODate(input.date)) throw new AppError('La date du paiement est invalide.', 'VALIDATION');
    const id = newId();
    const timestamp = nowISO();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO payments (id, invoice_id, date, amount_cents, method, reference, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          id,
          input.invoiceId,
          input.date,
          Math.round(input.amountCents),
          input.method,
          sanitizeText(input.reference, 100),
          sanitizeText(input.note, 500),
          timestamp,
        ],
      );
      this.invoices.recalculateState(input.invoiceId);
    });
    const row = this.db.get<Row>(
      `SELECT p.*, i.number, i.type, i.client_name FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = ?;`,
      [id],
    );
    if (!row) throw new AppError('Paiement introuvable après enregistrement.', 'NOT_FOUND');
    return rowToPayment(row);
  }

  delete(id: string): string {
    const row = this.db.get<Row>('SELECT invoice_id FROM payments WHERE id = ?;', [id]);
    if (!row) throw new AppError('Paiement introuvable.', 'NOT_FOUND');
    const invoiceId = str(row, 'invoice_id');
    this.db.transaction(() => {
      this.db.run('DELETE FROM payments WHERE id = ?;', [id]);
      this.invoices.recalculateState(invoiceId);
    });
    return invoiceId;
  }
}

/* ------------------------------------------------------------------ */
/* Activités / journal d'audit                                         */
/* ------------------------------------------------------------------ */

export class ActivityRepository {
  constructor(private readonly db: Database) {}

  add(
    type: ActivityType,
    title: string,
    detail: string,
    entityType: ActivityItem['entityType'],
    entityId: string | null,
  ): ActivityItem {
    const item: ActivityItem = {
      id: newId(),
      type,
      title: sanitizeText(title, 200),
      detail: sanitizeText(detail, 500),
      entityType,
      entityId,
      createdAt: nowISO(),
    };
    this.db.run(
      `INSERT INTO activities (id, type, title, detail, entity_type, entity_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [item.id, item.type, item.title, item.detail, item.entityType, item.entityId, item.createdAt],
    );
    return item;
  }

  list(limit = 20): ActivityItem[] {
    return this.db
      .all<Row>('SELECT * FROM activities ORDER BY created_at DESC LIMIT ?;', [limit])
      .map(rowToActivity);
  }

  audit(action: string, entity: string, entityId: string | null, details: unknown): void {
    this.db.run(
      'INSERT INTO audit_log (timestamp, action, entity, entity_id, details, actor) VALUES (?, ?, ?, ?, ?, ?);',
      [nowISO(), action, entity, entityId, JSON.stringify(details ?? {}), 'local'],
    );
  }
}

/** Petit utilitaire : adresse de livraison identique ? */
export function addressesEqual(a: Address | null, b: Address | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    normalizeAddressKey([a.line1, a.line2, a.postalCode, a.city, a.country]) ===
    normalizeAddressKey([b.line1, b.line2, b.postalCode, b.city, b.country])
  );
}

export function defaultBillingAddress(): Address {
  return emptyAddress();
}
