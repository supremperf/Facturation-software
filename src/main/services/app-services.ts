import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import type {
  ActivityItem,
  AppInfo,
  EffectiveStatus,
  AppSettings,
  BackupInfo,
  Client,
  ClientInput,
  ClientSnapshot,
  ComplianceReport,
  DashboardData,
  Diagnostics,
  DocumentType,
  ExportFilters,
  ExportResult,
  GlobalSearchResults,
  Invoice,
  InvoiceDraftInput,
  InvoiceListFilters,
  InvoiceSummary,
  LogoUploadPayload,
  NumberPreview,
  Paginated,
  Payment,
  PaymentInput,
  PeriodPreset,
  StatsData,
  EInvoicingPhase,
} from '@shared/types';
import type { LegalSnapshot } from '@shared/types';
import {
  ActivityRepository,
  ClientRepository,
  InvoiceRepository,
  PaymentRepository,
  SettingsRepository,
} from '../db/repositories';
import { Database } from '../db/database';
import { createPaths, type AppPaths, safeDocumentPath, humanFileSize } from '../infra/paths';
import { AppError } from '../infra/errors';
import { createLogger, type Logger, silentLogger } from '../infra/logger';
import {
  buildSellerSnapshot,
  buildLegalSnapshot,
  validateCompliance,
  type ComplianceDocument,
  type ComplianceLine,
} from '@shared/legal';
import { clientDisplayName, computeEffectiveStatus, STATUS_META } from '@shared/constants';
import { computeInvoiceTotals, formatEuros } from '@shared/money';
import { formatDateFR, getPeriodRange, lastMonths, previousPeriod, todayISO } from '@shared/dates';
import { sanitizeFileName } from '@shared/validators';
import { generateInvoicePdf } from '../pdf/invoice-pdf';

export interface AppServicesOptions {
  baseDir: string;
  wasmPath: string;
  fontsDir: string;
  appVersion: string;
  logger?: Logger;
}

export { AppError };

const AUTO_BACKUP_RETENTION = 30;

export class AppServices {
  readonly paths: AppPaths;
  readonly db: Database;
  readonly settingsRepo: SettingsRepository;
  readonly clientsRepo: ClientRepository;
  readonly invoicesRepo: InvoiceRepository;
  readonly paymentsRepo: PaymentRepository;
  readonly activitiesRepo: ActivityRepository;
  readonly logger: Logger;
  readonly appVersion: string;
  readonly fontsDir: string;
  readonly startedAt = new Date().toISOString();

  private constructor(options: AppServicesOptions, db: Database) {
    this.paths = createPaths(options.baseDir);
    this.logger = options.logger ?? silentLogger;
    this.appVersion = options.appVersion;
    this.fontsDir = options.fontsDir;
    this.db = db;
    this.settingsRepo = new SettingsRepository(db);
    this.clientsRepo = new ClientRepository(db);
    this.invoicesRepo = new InvoiceRepository(db, this.clientsRepo, this.settingsRepo);
    this.paymentsRepo = new PaymentRepository(db, this.invoicesRepo);
    this.activitiesRepo = new ActivityRepository(db);
  }

  static async create(options: AppServicesOptions): Promise<AppServices> {
    const logger = options.logger ?? createLogger(createPaths(options.baseDir).logs);
    const db = await Database.open({
      filePath: createPaths(options.baseDir).database,
      wasmPath: options.wasmPath,
      logger,
    });
    logger.info(`Base de données ouverte (schéma v${db.schemaVersion}).`);
    return new AppServices({ ...options, logger }, db);
  }

  async dispose(): Promise<void> {
    this.db.close();
  }

  /* ------------------------------------------------------------------ */
  /* Application / système                                               */
  /* ------------------------------------------------------------------ */

  appInfo(): AppInfo {
    const stats = this.storageStats();
    return {
      name: 'FacturePro',
      version: this.appVersion,
      electron: process.versions.electron ?? '—',
      chrome: process.versions.chrome ?? '—',
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      userDataPath: this.paths.base,
      documentsPath: this.paths.documents,
      databasePath: this.paths.database,
      backupsPath: this.paths.backups,
      databaseSize: this.db.fileSize(),
      documentsSize: stats.documentsBytes,
      documentCount: stats.documentCount,
      rulesVersion: 'FR-2026.10',
      startedAt: this.startedAt,
      dbSchemaVersion: this.db.schemaVersion,
    };
  }

  diagnostics(): Diagnostics {
    const stats = this.storageStats();
    const integrity = this.db.integrityCheck();
    const duplicateNumbers = Number(
      this.db.scalar<number>(
        'SELECT COUNT(*) FROM (SELECT number FROM invoices WHERE number IS NOT NULL GROUP BY number HAVING COUNT(*) > 1);',
      ) ?? 0,
    );
    const missingPdf = this.db
      .all<Record<string, string>>(
        "SELECT id, pdf_path FROM invoices WHERE pdf_path IS NOT NULL AND status <> 'draft';",
      )
      .filter((row) => {
        try {
          return !fs.existsSync(safeDocumentPath(this.paths.base, String(row.pdf_path)));
        } catch {
          return true;
        }
      }).length;
    const issuedWithoutNumber = Number(
      this.db.scalar<number>("SELECT COUNT(*) FROM invoices WHERE status <> 'draft' AND number IS NULL;") ?? 0,
    );
    const lastBackup = this.listBackups()[0] ?? null;
    return {
      integrity,
      tables: this.db.tableCounts(),
      orphanFiles: stats.orphanFiles,
      missingPdfs: missingPdf,
      duplicateNumbers,
      invoicesWithoutNumber: issuedWithoutNumber,
      lastBackupAt: lastBackup?.createdAt ?? null,
    };
  }

  private storageStats(): { documentsBytes: number; documentCount: number; orphanFiles: number } {
    let bytes = 0;
    let count = 0;
    const known = new Set(
      this.db
        .all<Record<string, string>>('SELECT pdf_path FROM invoices WHERE pdf_path IS NOT NULL;')
        .map((row) => path.resolve(this.paths.base, String(row.pdf_path))),
    );
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) {
          bytes += fs.statSync(full).size;
          if (entry.name.toLowerCase().endsWith('.pdf')) {
            count += 1;
            known.delete(path.resolve(full));
          }
        }
      }
    };
    walk(this.paths.documents);
    return { documentsBytes: bytes, documentCount: count, orphanFiles: known.size };
  }

  /* ------------------------------------------------------------------ */
  /* Réglages                                                            */
  /* ------------------------------------------------------------------ */

  getSettings(): AppSettings {
    return this.settingsRepo.get();
  }

  saveSettings(settings: AppSettings): AppSettings {
    if (!settings || typeof settings !== 'object') throw new AppError('Réglages invalides.');
    const allowedPhases: EInvoicingPhase[] = ['unspecified', 'ge_eti', 'pme', 'not_concerned'];
    if (!settings.legal || !allowedPhases.includes(settings.legal.eInvoicingPhase)) {
      throw new AppError('Calendrier de facturation électronique invalide.');
    }
    const saved = this.settingsRepo.save(settings);
    const recent = this.activitiesRepo.list(1)[0];
    const lastSettingsActivity = this.db.get<Record<string, string>>(
      "SELECT created_at FROM activities WHERE type = 'settings_updated' ORDER BY created_at DESC LIMIT 1;",
    );
    const recentEnough = lastSettingsActivity
      ? Date.now() - new Date(String(lastSettingsActivity.created_at)).getTime() < 10 * 60 * 1000
      : false;
    if (!recentEnough) {
      this.activitiesRepo.add(
        'settings_updated',
        "Paramètres de l'entreprise mis à jour",
        saved.business.tradeName || saved.business.legalName || 'Identité à compléter',
        'settings',
        null,
      );
    }
    this.activitiesRepo.audit('settings.save', 'settings', null, {
      tradeName: saved.business.tradeName,
      regime: saved.fiscal.regime,
    });
    void recent;
    return saved;
  }

  uploadLogo(payload: LogoUploadPayload): AppSettings {
    const settings = this.settingsRepo.get();
    const base64 = payload.base64.includes(',') ? payload.base64.split(',').pop() ?? '' : payload.base64;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw new AppError('Fichier image invalide.');
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) throw new AppError('Le fichier image est vide.');
    if (buffer.length > 3 * 1024 * 1024) throw new AppError('Le logo ne doit pas dépasser 3 Mo.');
    const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (!isPng && !isJpeg) {
      // L'interface convertit les SVG en PNG avant l'envoi : le service ne
      // reçoit donc que des images matricielles.
      throw new AppError('Format de logo non pris en charge. Utilisez une image PNG ou JPG.');
    }
    const mime = isPng ? 'image/png' : 'image/jpeg';
    const ext = isPng ? 'png' : 'jpg';
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
    const fileName = `logo-${hash}.${ext}`;
    const relative = path.join('branding', fileName).replace(/\\/g, '/');
    const absolute = path.join(this.paths.branding, fileName);
    fs.writeFileSync(absolute, buffer);
    const previous = settings.branding.logo;
    settings.branding.logo = { path: relative, mime, updatedAt: new Date().toISOString() };
    const saved = this.settingsRepo.save(settings);
    if (previous && previous.path !== relative) {
      try {
        fs.unlinkSync(path.join(this.paths.base, previous.path));
      } catch {
        /* fichier déjà absent */
      }
    }
    this.activitiesRepo.add('settings_updated', 'Logo mis à jour', fileName, 'settings', null);
    return saved;
  }

  removeLogo(): AppSettings {
    const settings = this.settingsRepo.get();
    const previous = settings.branding.logo;
    settings.branding.logo = null;
    const saved = this.settingsRepo.save(settings);
    if (previous) {
      try {
        fs.unlinkSync(path.join(this.paths.base, previous.path));
      } catch {
        /* ignore */
      }
    }
    this.activitiesRepo.add('settings_updated', 'Logo supprimé', '', 'settings', null);
    return saved;
  }

  logoDataUrl(): string | null {
    const logo = this.settingsRepo.get().branding.logo;
    if (!logo) return null;
    try {
      const absolute = path.join(this.paths.base, logo.path);
      if (!fs.existsSync(absolute)) return null;
      const buffer = fs.readFileSync(absolute);
      return `data:${logo.mime};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private resolveLogo(seller: Invoice['sellerSnapshot']): { buffer: Buffer; mime: string } | null {
    if (!seller.logoPath) return null;
    try {
      const absolute = path.join(this.paths.base, seller.logoPath);
      if (!fs.existsSync(absolute)) return null;
      const buffer = fs.readFileSync(absolute);
      const mime = absolute.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      return { buffer, mime };
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Clients                                                             */
  /* ------------------------------------------------------------------ */

  listClients(options: Parameters<ClientRepository['list']>[0] = {}): Client[] {
    return this.clientsRepo.list(options);
  }

  getClient(id: string): Client {
    const client = this.clientsRepo.get(id);
    if (!client) throw new AppError('Client introuvable.', 'NOT_FOUND');
    return client;
  }

  createClient(input: ClientInput): Client {
    if (!input.type) throw new AppError('Précisez le type de client.');
    const client = this.clientsRepo.create(input);
    this.activitiesRepo.add(
      'client_created',
      'Nouveau client ajouté',
      clientDisplayName(client),
      'client',
      client.id,
    );
    this.activitiesRepo.audit('client.create', 'client', client.id, { name: clientDisplayName(client) });
    return client;
  }

  updateClient(id: string, input: ClientInput): Client {
    const client = this.clientsRepo.update(id, input);
    this.activitiesRepo.add('client_updated', 'Fiche client modifiée', clientDisplayName(client), 'client', id);
    this.activitiesRepo.audit('client.update', 'client', id, {});
    return client;
  }

  setClientArchived(id: string, archived: boolean): Client {
    const client = this.clientsRepo.setArchived(id, archived);
    this.activitiesRepo.add(
      archived ? 'client_archived' : 'client_updated',
      archived ? 'Client archivé' : 'Client réactivé',
      clientDisplayName(client),
      'client',
      id,
    );
    return client;
  }

  deleteClient(id: string): void {
    const client = this.clientsRepo.get(id);
    if (!client) throw new AppError('Client introuvable.', 'NOT_FOUND');
    this.clientsRepo.delete(id);
    this.activitiesRepo.add('client_deleted', 'Client supprimé', clientDisplayName(client), 'client', id);
    this.activitiesRepo.audit('client.delete', 'client', id, { name: clientDisplayName(client) });
  }

  /* ------------------------------------------------------------------ */
  /* Conformité                                                          */
  /* ------------------------------------------------------------------ */

  private complianceDocument(invoice: Invoice): ComplianceDocument {
    const lines: ComplianceLine[] = invoice.lines.map((line) => ({
      designation: line.designation,
      description: line.description,
      reference: line.reference,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unitPriceCents,
      discountType: line.discountType,
      discountValue: line.discountValue,
      vatRateBp: line.vatRateBp,
      isExtraFee: line.isExtraFee,
    }));
    return {
      type: invoice.type,
      number: invoice.number,
      status: invoice.status,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      serviceDate: invoice.serviceDate,
      clientSnapshot: invoice.clientSnapshot,
      billingAddress: invoice.billingAddress,
      deliveryAddress: invoice.deliveryAddress,
      purchaseOrder: invoice.purchaseOrder,
      operationNature: invoice.operationNature,
      description: invoice.description,
      paymentTerms: invoice.paymentTerms,
      paymentMethod: invoice.paymentMethod,
      notes: invoice.notes,
      lines,
      globalDiscountType: invoice.globalDiscountType,
      globalDiscountValue: invoice.globalDiscountValue,
      totals: invoice.totals,
      sourceInvoiceNumber: invoice.sourceInvoiceNumber,
      reason: invoice.reason,
    };
  }

  private complianceFor(invoice: Invoice, settings: AppSettings, numberAssigned: boolean): ComplianceReport {
    const client = invoice.clientId ? this.clientsRepo.get(invoice.clientId) : null;
    const clientSnapshot: ClientSnapshot = client
      ? this.clientsRepo.buildSnapshot(client)
      : invoice.clientSnapshot;
    const refreshed: Invoice = {
      ...invoice,
      clientSnapshot,
      sellerSnapshot: buildSellerSnapshot(settings),
      legalSnapshot: buildLegalSnapshot(settings),
    };
    let creditNoteContext: { sourceTotalCents: number; alreadyCreditedCents: number } | null = null;
    if (refreshed.type === 'credit_note' && refreshed.sourceInvoiceId) {
      const source = this.invoicesRepo.get(refreshed.sourceInvoiceId);
      const already = Number(
        this.db.scalar<number>(
          "SELECT IFNULL(SUM(total_ttc_cents), 0) FROM invoices WHERE source_invoice_id = ? AND type = 'credit_note' AND status <> 'draft' AND id <> ?;",
          [refreshed.sourceInvoiceId, refreshed.id],
        ) ?? 0,
      );
      creditNoteContext = { sourceTotalCents: source?.totals.totalTtcCents ?? 0, alreadyCreditedCents: already };
    }
    return validateCompliance({
      settings,
      document: this.complianceDocument(refreshed),
      numberAssigned,
      numberUnique: refreshed.number ? !this.invoicesRepo.numberExists(refreshed.number, refreshed.id) : true,
      creditNoteContext,
    });
  }

  validateInvoice(id: string): ComplianceReport {
    const invoice = this.invoicesRepo.get(id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    return this.complianceFor(invoice, this.settingsRepo.get(), Boolean(invoice.number));
  }

  validateDraft(input: InvoiceDraftInput): ComplianceReport {
    const temp = this.buildTempInvoice(input);
    return this.complianceFor(temp, this.settingsRepo.get(), false);
  }

  /* ------------------------------------------------------------------ */
  /* Brouillons                                                          */
  /* ------------------------------------------------------------------ */

  private buildTempInvoice(input: InvoiceDraftInput): Invoice {
    const settings = this.settingsRepo.get();
    if (!input.clientId) throw new AppError('Sélectionnez un client.');
    const client = this.clientsRepo.get(input.clientId);
    if (!client) throw new AppError('Client introuvable.', 'NOT_FOUND');
    const computed = computeInvoiceTotals(input.lines ?? [], input.globalDiscountType ?? 'none', input.globalDiscountValue ?? 0);
    const clientSnapshot = this.clientsRepo.buildSnapshot(client);
    const now = new Date().toISOString();
    let sourceInvoiceNumber: string | null = null;
    if (input.sourceInvoiceId) {
      const source = this.invoicesRepo.get(input.sourceInvoiceId);
      sourceInvoiceNumber = source?.number ?? null;
    }
    return {
      id: input.id ?? 'draft',
      type: input.type === 'credit_note' ? 'credit_note' : 'invoice',
      number: null,
      status: 'draft',
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      serviceDate: input.serviceDate,
      clientId: input.clientId,
      clientSnapshot,
      sellerSnapshot: buildSellerSnapshot(settings),
      legalSnapshot: buildLegalSnapshot(settings),
      billingAddress: input.billingAddress ?? client.address,
      deliveryAddress: input.deliveryAddress ?? null,
      purchaseOrder: input.purchaseOrder ?? '',
      operationNature: input.operationNature,
      description: input.description ?? '',
      paymentTerms: input.paymentTerms ?? '',
      paymentMethod: input.paymentMethod ?? 'virement',
      notes: input.notes ?? '',
      lines: computed.lines.map((line, index) => ({
        ...line,
        id: line.id ?? crypto.randomUUID(),
        position: index,
      })),
      globalDiscountType: input.globalDiscountType ?? 'none',
      globalDiscountValue: input.globalDiscountValue ?? 0,
      totals: computed.totals,
      vatBreakdown: computed.totals.vatBreakdown,
      paidCents: 0,
      creditedCents: 0,
      balanceCents: computed.totals.totalTtcCents,
      sourceInvoiceId: input.sourceInvoiceId ?? null,
      sourceInvoiceNumber,
      reason: input.reason ?? '',
      pdf: null,
      issuedAt: null,
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    };
  }

  saveDraft(input: InvoiceDraftInput): Invoice {
    const invoice = this.invoicesRepo.createDraft(input);
    this.activitiesRepo.add(
      'invoice_created',
      input.type === 'credit_note' ? 'Brouillon d’avoir créé' : 'Brouillon de facture créé',
      `${clientDisplayName(invoice.clientSnapshot)} — ${formatEuros(invoice.totals.totalTtcCents)}`,
      'invoice',
      invoice.id,
    );
    this.activitiesRepo.audit('invoice.draft.create', 'invoice', invoice.id, { total: invoice.totals.totalTtcCents });
    return invoice;
  }

  updateDraft(id: string, input: InvoiceDraftInput): Invoice {
    const invoice = this.invoicesRepo.updateDraft(id, input);
    this.activitiesRepo.add(
      'invoice_updated',
      'Brouillon mis à jour',
      invoice.number ?? clientDisplayName(invoice.clientSnapshot),
      'invoice',
      id,
    );
    return invoice;
  }

  deleteDraft(id: string): void {
    const invoice = this.invoicesRepo.get(id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    this.invoicesRepo.deleteDraft(id);
    this.activitiesRepo.add(
      'invoice_deleted',
      'Brouillon supprimé',
      invoice.number ?? clientDisplayName(invoice.clientSnapshot),
      'invoice',
      id,
    );
    this.activitiesRepo.audit('invoice.draft.delete', 'invoice', id, {});
  }

  /* ------------------------------------------------------------------ */
  /* Émission / PDF                                                      */
  /* ------------------------------------------------------------------ */

  private async writePdfFor(invoice: Invoice, draft = false, provisionalNumber?: string | null): Promise<{ buffer: Buffer; path?: string; meta?: Invoice['pdf'] }> {
    const logo = this.resolveLogo(invoice.sellerSnapshot);
    const buffer = await generateInvoicePdf(invoice, {
      fontsDir: this.fontsDir,
      logo,
      draft,
      provisionalNumber: provisionalNumber ?? null,
    });
    return { buffer };
  }

  private archiveRelativePath(invoice: Invoice): string {
    const year = invoice.issueDate.slice(0, 4);
    const folder = invoice.type === 'credit_note' ? 'Avoirs' : 'Factures';
    const safeNumber = sanitizeFileName(invoice.number ?? `sans-numero-${invoice.id}`, 'document');
    return path.join('documents', folder, year, `${safeNumber}.pdf`).replace(/\\/g, '/');
  }

  async issueInvoice(id: string): Promise<{ invoice: Invoice; report: ComplianceReport; pdfWarning?: string }> {
    const invoice = this.invoicesRepo.get(id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    if (invoice.status !== 'draft') throw new AppError('Ce document est déjà émis.', 'ALREADY_ISSUED');
    const settings = this.settingsRepo.get();
    const report = this.complianceFor(invoice, settings, false);
    if (!report.canIssue) {
      const creditIssue = report.checks.find(
        (check) => check.id === 'credit.amount' && check.status !== 'ok' && check.status !== 'not_applicable',
      );
      if (creditIssue) {
        throw new AppError(creditIssue.message, 'CREDIT_AMOUNT', report);
      }
      throw new AppError('Des informations obligatoires sont manquantes ou incohérentes.', 'COMPLIANCE', report);
    }
    if (invoice.type === 'credit_note' && invoice.sourceInvoiceId) {
      const source = this.invoicesRepo.get(invoice.sourceInvoiceId);
      if (!source) throw new AppError('Facture d’origine introuvable.', 'NOT_FOUND');
      const already = Number(
        this.db.scalar<number>(
          "SELECT IFNULL(SUM(total_ttc_cents), 0) FROM invoices WHERE source_invoice_id = ? AND type = 'credit_note' AND status <> 'draft';",
          [invoice.sourceInvoiceId],
        ) ?? 0,
      );
      if (already + invoice.totals.totalTtcCents > source.totals.totalTtcCents) {
        throw new AppError(
          `Le montant cumulé des avoirs dépasserait le total de la facture ${source.number ?? ''}.`,
          'CREDIT_AMOUNT',
        );
      }
    }

    const issued = this.invoicesRepo.issue(id);
    let pdfWarning: string | undefined;
    try {
      const { buffer } = await this.writePdfFor(issued);
      const relative = this.archiveRelativePath(issued);
      const absolute = safeDocumentPath(this.paths.base, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, buffer);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      this.invoicesRepo.setPdf(issued.id, {
        path: relative,
        sha256,
        generatedAt: new Date().toISOString(),
        size: buffer.length,
      });
      this.invoicesRepo.saveLegalReport(issued.id, report);
    } catch (error) {
      pdfWarning = 'La facture a été émise mais le PDF n’a pas pu être généré. Utilisez « Régénérer le PDF ».';
      this.logger.error('Échec de génération du PDF après émission.', error);
    }

    if (issued.type === 'credit_note' && issued.sourceInvoiceId) {
      this.invoicesRepo.markCreditNoteIssued(issued.id, issued.sourceInvoiceId);
    }

    const finalInvoice = this.invoicesRepo.get(id)!;
    this.activitiesRepo.add(
      issued.type === 'credit_note' ? 'credit_note_issued' : 'invoice_issued',
      issued.type === 'credit_note' ? 'Avoir émis' : 'Facture émise',
      `${finalInvoice.number} — ${clientDisplayName(finalInvoice.clientSnapshot)} — ${formatEuros(finalInvoice.totals.totalTtcCents)}`,
      'invoice',
      id,
    );
    this.activitiesRepo.audit('invoice.issue', 'invoice', id, {
      number: finalInvoice.number,
      totalTtc: finalInvoice.totals.totalTtcCents,
      rulesVersion: report.rulesVersion,
      checks: report.blockingCount,
    });
    return { invoice: finalInvoice, report, pdfWarning };
  }

  async regeneratePdf(id: string): Promise<Invoice> {
    const invoice = this.invoicesRepo.get(id);
    if (!invoice) throw new AppError('Facture introuvable.', 'NOT_FOUND');
    if (invoice.status === 'draft') throw new AppError('Émettez la facture avant de générer son PDF définitif.');
    if (invoice.pdf) {
      const absolute = safeDocumentPath(this.paths.base, invoice.pdf.path);
      if (fs.existsSync(absolute)) {
        throw new AppError('Le PDF original existe déjà : il est conservé sans modification.', 'PDF_EXISTS');
      }
    }
    const { buffer } = await this.writePdfFor(invoice);
    const relative = this.archiveRelativePath(invoice);
    const absolute = safeDocumentPath(this.paths.base, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, buffer);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    this.invoicesRepo.setPdf(id, { path: relative, sha256, generatedAt: new Date().toISOString(), size: buffer.length });
    this.activitiesRepo.add('pdf_generated', 'PDF régénéré', invoice.number ?? '', 'invoice', id);
    return this.invoicesRepo.get(id)!;
  }

  async previewPdf(params: { id?: string; draft?: InvoiceDraftInput }): Promise<{
    base64: string;
    fileName: string;
    report: ComplianceReport | null;
    draft: boolean;
  }> {
    if (params.draft) {
      const temp = this.buildTempInvoice(params.draft);
      const settings = this.settingsRepo.get();
      const report = this.complianceFor(temp, settings, false);
      const preview = this.invoicesRepo.previewNumber(temp.type).nextNumber;
      const { buffer } = await this.writePdfFor(temp, true, preview);
      return {
        base64: buffer.toString('base64'),
        fileName: `APERCU_${temp.type === 'credit_note' ? 'AVOIR' : 'FACTURE'}_${preview}.pdf`,
        report,
        draft: true,
      };
    }
    if (!params.id) throw new AppError('Document introuvable.', 'NOT_FOUND');
    const invoice = this.invoicesRepo.get(params.id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    const report = this.complianceFor(invoice, this.settingsRepo.get(), Boolean(invoice.number));
    if (invoice.pdf) {
      const absolute = safeDocumentPath(this.paths.base, invoice.pdf.path);
      if (fs.existsSync(absolute)) {
        const buffer = fs.readFileSync(absolute);
        return { base64: buffer.toString('base64'), fileName: this.exportFileName(invoice), report, draft: false };
      }
    }
    if (invoice.status === 'draft') {
      const preview = this.invoicesRepo.previewNumber(invoice.type).nextNumber;
      const { buffer } = await this.writePdfFor(invoice, true, preview);
      return { base64: buffer.toString('base64'), fileName: `APERCU_${invoice.type === 'credit_note' ? 'AVOIR' : 'FACTURE'}_${preview}.pdf`, report, draft: true };
    }
    const { buffer } = await this.writePdfFor(invoice);
    return { base64: buffer.toString('base64'), fileName: this.exportFileName(invoice), report, draft: false };
  }

  pdfFilePath(id: string): string {
    const invoice = this.invoicesRepo.get(id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    if (invoice.status === 'draft') throw new AppError('Le PDF définitif est généré à l’émission.', 'DRAFT');
    if (!invoice.pdf) throw new AppError('Aucun PDF archivé pour ce document.', 'NO_PDF');
    const absolute = safeDocumentPath(this.paths.base, invoice.pdf.path);
    if (!fs.existsSync(absolute)) throw new AppError('Le PDF archivé est introuvable.', 'PDF_MISSING');
    return absolute;
  }

  exportFileName(invoice: Invoice): string {
    const prefix = invoice.type === 'credit_note' ? 'AVOIR' : 'FACTURE';
    const client = sanitizeFileName(invoice.clientSnapshot.displayName, 'CLIENT');
    return `${prefix}_${sanitizeFileName(invoice.number ?? 'BROUILLON')}_${client}.pdf`;
  }

  readPdf(id: string): { base64: string; fileName: string; integrity: boolean } {
    const invoice = this.invoicesRepo.get(id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    const filePath = this.pdfFilePath(id);
    const buffer = fs.readFileSync(filePath);
    const sha = crypto.createHash('sha256').update(buffer).digest('hex');
    return {
      base64: buffer.toString('base64'),
      fileName: this.exportFileName(invoice),
      integrity: !invoice.pdf?.sha256 || sha === invoice.pdf.sha256,
    };
  }

  savePdfAs(id: string, targetPath: string): string {
    if (!targetPath) throw new AppError('Aucun emplacement sélectionné.');
    const invoice = this.invoicesRepo.get(id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    const source = this.pdfFilePath(id);
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.copyFileSync(source, resolved);
    this.activitiesRepo.add('export_completed', 'PDF exporté', this.exportFileName(invoice), 'invoice', id);
    return resolved;
  }

  savePreviewPdf(base64: string, targetPath: string): string {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.subarray(0, 4).toString() !== '%PDF') throw new AppError('PDF d’aperçu invalide.');
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, buffer);
    return resolved;
  }

  markSent(id: string): Invoice {
    const invoice = this.invoicesRepo.markSent(id);
    this.activitiesRepo.add('invoice_sent', 'Facture marquée comme envoyée', invoice.number ?? '', 'invoice', id);
    return invoice;
  }

  duplicate(id: string): Invoice {
    const source = this.invoicesRepo.get(id);
    if (!source) throw new AppError('Document introuvable.', 'NOT_FOUND');
    const draft = this.invoicesRepo.duplicateAsDraft(id);
    this.activitiesRepo.add(
      'invoice_created',
      'Document dupliqué en brouillon',
      source.number ? `À partir de ${source.number}` : clientDisplayName(source.clientSnapshot),
      'invoice',
      draft.id,
    );
    return draft;
  }

  /* ------------------------------------------------------------------ */
  /* Paiements                                                           */
  /* ------------------------------------------------------------------ */

  listPayments(options: Parameters<PaymentRepository['list']>[0] = {}): Paginated<Payment> {
    return this.paymentsRepo.list(options);
  }

  paymentsForInvoice(invoiceId: string): Payment[] {
    return this.paymentsRepo.forInvoice(invoiceId);
  }

  addPayment(input: PaymentInput): Payment {
    const payment = this.paymentsRepo.create(input);
    const invoice = this.invoicesRepo.get(input.invoiceId);
    this.activitiesRepo.add(
      'payment_received',
      'Paiement reçu',
      `${formatEuros(payment.amountCents)} — ${invoice?.number ?? ''} ${clientDisplayName(invoice?.clientSnapshot ?? { type: 'professionnel', companyName: payment.clientName, firstName: '', lastName: '' })}`.trim(),
      'payment',
      payment.id,
    );
    this.activitiesRepo.audit('payment.create', 'payment', payment.id, {
      invoiceId: input.invoiceId,
      amount: input.amountCents,
      method: input.method,
    });
    return payment;
  }

  deletePayment(id: string): { invoiceId: string } {
    const invoiceId = this.paymentsRepo.delete(id);
    this.activitiesRepo.add('payment_deleted', 'Paiement supprimé', '', 'payment', id);
    this.activitiesRepo.audit('payment.delete', 'payment', id, { invoiceId });
    return { invoiceId };
  }

  /* ------------------------------------------------------------------ */
  /* Listes                                                              */
  /* ------------------------------------------------------------------ */

  listInvoices(filters: InvoiceListFilters): Paginated<InvoiceSummary> {
    return this.invoicesRepo.list(filters);
  }

  getInvoice(id: string): Invoice {
    const invoice = this.invoicesRepo.get(id);
    if (!invoice) throw new AppError('Document introuvable.', 'NOT_FOUND');
    return invoice;
  }

  invoiceCreditNotes(id: string): InvoiceSummary[] {
    return this.invoicesRepo.creditNotesFor(id);
  }

  recentInvoices(limit = 6): InvoiceSummary[] {
    return this.invoicesRepo.recent(limit);
  }

  listActivities(limit = 20): ActivityItem[] {
    return this.activitiesRepo.list(limit);
  }

  numberPreview(type: DocumentType = 'invoice'): NumberPreview {
    const preview = this.invoicesRepo.previewNumber(type);
    const settings = this.settingsRepo.get();
    const keyYear = settings.documents.resetYearly ? preview.year : 0;
    const row = this.db.get<Record<string, number>>(
      'SELECT last_value FROM number_sequences WHERE year = ? AND doc_type = ?;',
      [keyYear, type],
    );
    return {
      nextNumber: preview.nextNumber,
      year: preview.year,
      lastNumber: preview.lastNumber,
      sequence: row ? Number(row.last_value) : 0,
    };
  }

  globalSearch(query: string): GlobalSearchResults {
    const term = query.trim();
    if (term.length < 2) return { clients: [], invoices: [] };
    const like = `%${term.toLowerCase()}%`;
    const clients = this.db
      .all<Record<string, string>>(
        `SELECT id, company_name, first_name, last_name, city FROM clients
         WHERE is_archived = 0 AND (lower(company_name) LIKE ? OR lower(first_name) LIKE ? OR lower(last_name) LIKE ? OR lower(email) LIKE ? OR siren LIKE ?)
         ORDER BY company_name, last_name LIMIT 6;`,
        [like, like, like, like, `%${term}%`],
      )
      .map((row) => ({
        id: String(row.id),
        name: row.company_name || [row.first_name, row.last_name].filter(Boolean).join(' ') || 'Client',
        detail: row.city || '',
      }));
    const invoices = this.db
      .all<Record<string, string>>(
        `SELECT id, number, client_name, issue_date FROM invoices
         WHERE lower(number) LIKE ? OR lower(client_name) LIKE ?
         ORDER BY issue_date DESC LIMIT 6;`,
        [like, like],
      )
      .map((row) => ({
        id: String(row.id),
        number: row.number || null,
        clientName: row.client_name,
        detail: row.issue_date,
      }));
    return { clients, invoices };
  }

  /* ------------------------------------------------------------------ */
  /* Tableau de bord                                                     */
  /* ------------------------------------------------------------------ */

  dashboard(preset: PeriodPreset = 'year', customFrom?: string, customTo?: string): DashboardData {
    const range = getPeriodRange(preset, customFrom, customTo);
    const prevRange = previousPeriod(range);
    const today = todayISO();
    const current = this.periodMetrics(range.from, range.to);
    const previous = this.periodMetrics(prevRange.from, prevRange.to);
    const months = lastMonths(12);
    const seriesStart = `${months[0].year}-${String(months[0].month + 1).padStart(2, '0')}-01`;
    const seriesRows = this.db.all<Record<string, string | number>>(
      `SELECT type, issue_date, total_ht_cents, total_ttc_cents, credited_cents, status
       FROM invoices WHERE status <> 'draft' AND issue_date >= ? ORDER BY issue_date;`,
      [seriesStart],
    );
    const paymentsRows = this.db.all<Record<string, string | number>>(
      'SELECT date, amount_cents FROM payments WHERE date >= ?;',
      [seriesStart],
    );
    const monthlyMap = new Map<string, { ht: number; ttc: number; count: number }>();
    for (const m of months) monthlyMap.set(m.key, { ht: 0, ttc: 0, count: 0 });
    for (const row of seriesRows) {
      const key = String(row.issue_date).slice(0, 7);
      const bucket = monthlyMap.get(key);
      if (!bucket) continue;
      const isCredit = String(row.type) === 'credit_note';
      const sign = isCredit ? -1 : 1;
      bucket.ht += Number(row.total_ht_cents) * sign;
      bucket.ttc += Number(row.total_ttc_cents) * sign;
      // Le compteur alimente la courbe « factures émises » des cartes KPI :
      // les avoirs ne sont pas des factures, ils ne sont donc pas comptés.
      if (!isCredit) bucket.count += 1;
    }
    const revenueSeries = months.map((m) => ({
      label: m.label,
      htCents: monthlyMap.get(m.key)?.ht ?? 0,
      ttcCents: monthlyMap.get(m.key)?.ttc ?? 0,
      count: monthlyMap.get(m.key)?.count ?? 0,
    }));

    const statusRows = this.db.all<Record<string, string | number>>(
      `SELECT i.id, i.type, i.status, i.due_date, i.total_ttc_cents, i.credited_cents,
        COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
       FROM invoices i WHERE i.status <> 'draft' AND i.issue_date BETWEEN ? AND ?;`,
      [range.from, range.to],
    );
    const statusCounts = new Map<string, { count: number; amount: number }>();
    for (const row of statusRows) {
      const balance = Math.max(
        0,
        Number(row.total_ttc_cents) - Number(row.paid) - Number(row.credited_cents),
      );
      const effective = computeEffectiveStatus(
        {
          type: String(row.type) === 'credit_note' ? 'credit_note' : 'invoice',
          status: String(row.status) as Invoice['status'],
          dueDate: String(row.due_date),
          balanceCents: balance,
        },
        today,
      );
      const entry = statusCounts.get(effective) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += Number(row.total_ttc_cents);
      statusCounts.set(effective, entry);
    }
    const statusOrder: EffectiveStatus[] = ['paid', 'issued', 'sent', 'partial', 'overdue', 'cancelled', 'draft'];
    const statusBreakdown = statusOrder
      .map((status) => ({
        status,
        count: statusCounts.get(status)?.count ?? 0,
        amountCents: statusCounts.get(status)?.amount ?? 0,
      }))
      .filter((entry) => entry.count > 0);

    const cashMonths = lastMonths(6);
    const cashStart = `${cashMonths[0].year}-${String(cashMonths[0].month + 1).padStart(2, '0')}-01`;
    const cashPayments = this.db.all<Record<string, string | number>>(
      'SELECT date, amount_cents FROM payments WHERE date >= ?;',
      [cashStart],
    );
    const cashInvoices = this.db.all<Record<string, string | number>>(
      `SELECT i.issue_date, (i.total_ttc_cents - i.credited_cents -
        COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)) AS balance
       FROM invoices i WHERE i.type = 'invoice' AND i.status <> 'draft' AND i.issue_date >= ?;`,
      [cashStart],
    );
    const cashMap = new Map<string, { collected: number; outstanding: number }>();
    cashMonths.forEach((m) => cashMap.set(m.key, { collected: 0, outstanding: 0 }));
    for (const row of cashPayments) {
      const bucket = cashMap.get(String(row.date).slice(0, 7));
      if (bucket) bucket.collected += Number(row.amount_cents);
    }
    for (const row of cashInvoices) {
      const bucket = cashMap.get(String(row.issue_date).slice(0, 7));
      if (bucket) bucket.outstanding += Math.max(0, Number(row.balance));
    }
    const cashComparison = cashMonths.map((m) => ({
      label: m.label,
      collectedCents: cashMap.get(m.key)?.collected ?? 0,
      outstandingCents: cashMap.get(m.key)?.outstanding ?? 0,
    }));

    const storage = this.storageStats();
    const yearly = this.periodMetrics(`${new Date().getFullYear()}-01-01`, `${new Date().getFullYear()}-12-31`);
    const overdueTotal = this.db.scalar<number>(
      `SELECT IFNULL(SUM(MAX(i.total_ttc_cents - i.credited_cents -
        COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0), 0)), 0)
       FROM invoices i WHERE i.type = 'invoice' AND i.status NOT IN ('draft','cancelled') AND i.due_date < ?;`,
      [today],
    );
    const lastBackup = this.listBackups()[0] ?? null;

    return {
      period: range,
      kpis: {
        ...current,
        draftCount: Number(this.db.scalar<number>("SELECT COUNT(*) FROM invoices WHERE status = 'draft';") ?? 0),
        clientCount: this.clientsRepo.count(),
      },
      previous: {
        ...previous,
        draftCount: Number(this.db.scalar<number>("SELECT COUNT(*) FROM invoices WHERE status = 'draft';") ?? 0),
        clientCount: this.clientsRepo.count(),
      },
      revenueSeries,
      statusBreakdown,
      statusTotal: statusBreakdown.reduce((acc, entry) => acc + entry.count, 0),
      cashComparison,
      recentInvoices: this.invoicesRepo.recent(6),
      recentActivities: this.activitiesRepo.list(8),
      yearlyRevenueCents: yearly.revenueHtCents,
      storageBytes: this.db.fileSize() + storage.documentsBytes,
      lastBackupAt: lastBackup?.createdAt ?? null,
      overdueTotalCents: Number(overdueTotal ?? 0),
    };
  }

  private periodMetrics(from: string, to: string): {
    revenueHtCents: number;
    revenueTtcCents: number;
    collectedCents: number;
    outstandingCents: number;
    invoicesCount: number;
    paidCount: number;
    pendingCount: number;
    overdueCount: number;
  } {
    const today = todayISO();
    const rows = this.db.all<Record<string, string | number>>(
      `SELECT i.id, i.type, i.status, i.due_date, i.issue_date, i.total_ht_cents, i.total_ttc_cents, i.credited_cents,
        COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
       FROM invoices i WHERE i.status <> 'draft' AND i.issue_date BETWEEN ? AND ?;`,
      [from, to],
    );
    let revenueHt = 0;
    let revenueTtc = 0;
    let outstanding = 0;
    let invoicesCount = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;
    for (const row of rows) {
      const isCredit = String(row.type) === 'credit_note';
      const sign = isCredit ? -1 : 1;
      revenueHt += Number(row.total_ht_cents) * sign;
      revenueTtc += Number(row.total_ttc_cents) * sign;
      if (!isCredit) invoicesCount += 1;
      const balance = Math.max(
        0,
        Number(row.total_ttc_cents) - Number(row.paid) - Number(row.credited_cents),
      );
      if (!isCredit) outstanding += balance;
      const effective = computeEffectiveStatus(
        {
          type: isCredit ? 'credit_note' : 'invoice',
          status: String(row.status) as Invoice['status'],
          dueDate: String(row.due_date),
          balanceCents: balance,
        },
        today,
      );
      if (!isCredit) {
        if (effective === 'paid') paidCount += 1;
        else if (effective === 'overdue') overdueCount += 1;
        else if (balance > 0) pendingCount += 1;
      }
    }
    const collected = Number(
      this.db.scalar<number>('SELECT IFNULL(SUM(amount_cents), 0) FROM payments WHERE date BETWEEN ? AND ?;', [
        from,
        to,
      ]) ?? 0,
    );
    return {
      revenueHtCents: revenueHt,
      revenueTtcCents: revenueTtc,
      collectedCents: collected,
      outstandingCents: outstanding,
      invoicesCount,
      paidCount,
      pendingCount,
      overdueCount,
    };
  }

  stats(year: number): StatsData {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: i,
      key: `${year}-${String(i + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('fr-FR', { month: 'short' }).format(new Date(year, i, 1)).replace('.', ''),
    }));
    const rows = this.db.all<Record<string, string | number>>(
      `SELECT type, issue_date, total_ht_cents, total_ttc_cents, total_vat_cents, credited_cents, status,
        COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
       FROM invoices i WHERE status <> 'draft' AND issue_date BETWEEN ? AND ?;`,
      [from, to],
    );
    const map = new Map(months.map((m) => [m.key, { ht: 0, ttc: 0, paid: 0, count: 0 }]));
    let revenueHt = 0;
    let revenueTtc = 0;
    let vat = 0;
    let collected = 0;
    let outstanding = 0;
    let invoiceCount = 0;
    let creditTotal = 0;
    const vatMap = new Map<number, { base: number; vat: number }>();
    const clientMap = new Map<string, { name: string; total: number; count: number }>();
    for (const row of rows) {
      const isCredit = String(row.type) === 'credit_note';
      const sign = isCredit ? -1 : 1;
      const key = String(row.issue_date).slice(0, 7);
      const bucket = map.get(key);
      const balance = Math.max(0, Number(row.total_ttc_cents) - Number(row.paid) - Number(row.credited_cents));
      if (bucket) {
        bucket.ht += Number(row.total_ht_cents) * sign;
        bucket.ttc += Number(row.total_ttc_cents) * sign;
        bucket.paid += Number(row.paid) * (isCredit ? 0 : 1);
        bucket.count += isCredit ? 0 : 1;
      }
      revenueHt += Number(row.total_ht_cents) * sign;
      revenueTtc += Number(row.total_ttc_cents) * sign;
      vat += Number(row.total_vat_cents) * sign;
      if (isCredit) creditTotal += Number(row.total_ttc_cents);
      else {
        invoiceCount += 1;
        outstanding += balance;
      }
    }
    // Répartition TVA exacte, à partir des instantanés de ventilation.
    const vatRows = this.db.all<Record<string, string | number>>(
      `SELECT type, vat_breakdown FROM invoices WHERE status <> 'draft' AND issue_date BETWEEN ? AND ?;`,
      [from, to],
    );
    for (const row of vatRows) {
      const sign = String(row.type) === 'credit_note' ? -1 : 1;
      try {
        const breakdown = JSON.parse(String(row.vat_breakdown)) as { rateBp: number; baseCents: number; vatCents: number }[];
        for (const entry of breakdown) {
          const current = vatMap.get(entry.rateBp) ?? { base: 0, vat: 0 };
          current.base += entry.baseCents * sign;
          current.vat += entry.vatCents * sign;
          vatMap.set(entry.rateBp, current);
        }
      } catch {
        /* ventilation illisible : ignorée */
      }
    }
    const clientRows = this.db.all<Record<string, string | number>>(
      `SELECT client_id, client_name, SUM(total_ttc_cents) AS total, COUNT(*) AS count
       FROM invoices WHERE type = 'invoice' AND status NOT IN ('draft','cancelled') AND issue_date BETWEEN ? AND ?
       GROUP BY client_id, client_name ORDER BY total DESC LIMIT 6;`,
      [from, to],
    );
    for (const row of clientRows) {
      const key = String(row.client_id ?? row.client_name);
      clientMap.set(key, {
        name: String(row.client_name),
        total: Number(row.total),
        count: Number(row.count),
      });
    }
    const paymentRows = this.db.all<Record<string, string | number>>(
      'SELECT date, amount_cents FROM payments WHERE date BETWEEN ? AND ?;',
      [from, to],
    );
    const paymentMap = new Map(months.map((m) => [m.key, 0]));
    for (const row of paymentRows) {
      const key = String(row.date).slice(0, 7);
      if (paymentMap.has(key)) paymentMap.set(key, (paymentMap.get(key) ?? 0) + Number(row.amount_cents));
      collected += Number(row.amount_cents);
    }
    const yearsRows = this.db.all<Record<string, number>>(
      "SELECT DISTINCT CAST(substr(issue_date, 1, 4) AS INTEGER) AS y FROM invoices WHERE status <> 'draft' ORDER BY y DESC;",
    );
    const availableYears = yearsRows.map((r) => Number(r.y)).filter((y) => Number.isFinite(y));
    if (!availableYears.includes(new Date().getFullYear())) availableYears.unshift(new Date().getFullYear());
    return {
      year,
      availableYears,
      monthly: months.map((m) => {
        const bucket = map.get(m.key) ?? { ht: 0, ttc: 0, paid: 0, count: 0 };
        return {
          month: m.month,
          label: m.label,
          htCents: bucket.ht,
          ttcCents: bucket.ttc,
          paidCents: paymentMap.get(m.key) ?? 0,
          count: bucket.count,
        };
      }),
      vatByRate: [...vatMap.entries()].sort((a, b) => b[0] - a[0]).map(([rateBp, entry]) => ({
        rateBp,
        baseCents: entry.base,
        vatCents: entry.vat,
      })),
      topClients: [...clientMap.entries()].map(([clientId, entry]) => ({
        clientId: clientId.length === 36 ? clientId : null,
        name: entry.name,
        totalCents: entry.total,
        count: entry.count,
      })),
      totals: {
        revenueHtCents: revenueHt,
        revenueTtcCents: revenueTtc,
        vatCents: vat,
        collectedCents: collected,
        outstandingCents: outstanding,
        invoiceCount,
        averageInvoiceCents: invoiceCount ? Math.round(revenueTtc / invoiceCount) : 0,
        creditNotesCents: creditTotal,
      },
      monthlyPayments: months.map((m) => ({ label: m.label, amountCents: paymentMap.get(m.key) ?? 0 })),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Exports                                                             */
  /* ------------------------------------------------------------------ */

  exportInvoicesCsv(filters: ExportFilters, targetPath: string): ExportResult {
    const invoices = this.invoicesRepo.listForExport({
      type: filters.type ?? 'invoice',
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      status: filters.status ?? 'all',
      clientId: filters.clientId,
    });
    const header = [
      'Numéro',
      'Type',
      'Date émission',
      'Échéance',
      'Client',
      'SIREN client',
      'Total HT',
      'TVA',
      'Total TTC',
      'Payé',
      'Avoir',
      'Solde dû',
      'Statut',
      'Mode de paiement',
      'Nature',
    ];
    const lines = invoices.map((invoice) => [
      invoice.number ?? '',
      invoice.type === 'credit_note' ? 'Avoir' : 'Facture',
      invoice.issueDate,
      invoice.dueDate,
      invoice.clientSnapshot.displayName,
      invoice.clientSnapshot.siren,
      (invoice.totals.totalHtCents / 100).toFixed(2).replace('.', ','),
      (invoice.totals.totalVatCents / 100).toFixed(2).replace('.', ','),
      (invoice.totals.totalTtcCents / 100).toFixed(2).replace('.', ','),
      (invoice.paidCents / 100).toFixed(2).replace('.', ','),
      (invoice.creditedCents / 100).toFixed(2).replace('.', ','),
      (invoice.balanceCents / 100).toFixed(2).replace('.', ','),
      STATUS_META[invoice.effectiveStatus ?? invoice.status]?.label ?? invoice.status,
      invoice.paymentMethod,
      invoice.operationNature,
    ]);
    const csv = [header, ...lines]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(';'))
      .join('\r\n');
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `\uFEFF${csv}\r\n`, 'utf8');
    this.activitiesRepo.add('export_completed', 'Export CSV des factures', `${invoices.length} document(s)`, 'system', null);
    return { canceled: false, path: resolved, count: invoices.length };
  }

  exportVatCsv(from: string, to: string, targetPath: string): ExportResult {
    const rows = this.db.all<Record<string, string | number>>(
      `SELECT vat_breakdown FROM invoices WHERE type = 'invoice' AND status <> 'draft'
        AND issue_date BETWEEN ? AND ?;`,
      [from, to],
    );
    const vatRows = this.db.all<Record<string, string | number>>(
      `SELECT vat_breakdown FROM invoices WHERE type = 'credit_note' AND status <> 'draft'
        AND issue_date BETWEEN ? AND ?;`,
      [from, to],
    );
    const map = new Map<number, { base: number; vat: number }>();
    const add = (payload: string, sign: number) => {
      try {
        for (const entry of JSON.parse(payload) as { rateBp: number; baseCents: number; vatCents: number }[]) {
          const current = map.get(entry.rateBp) ?? { base: 0, vat: 0 };
          current.base += entry.baseCents * sign;
          current.vat += entry.vatCents * sign;
          map.set(entry.rateBp, current);
        }
      } catch {
        /* ignore */
      }
    };
    rows.forEach((row) => add(String(row.vat_breakdown), 1));
    vatRows.forEach((row) => add(String(row.vat_breakdown), -1));
    const header = ['Taux de TVA', 'Base HT', 'TVA collectée'];
    const lines = [...map.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([rate, entry]) => [
        `${(rate / 100).toFixed(2).replace('.', ',')} %`,
        (entry.base / 100).toFixed(2).replace('.', ','),
        (entry.vat / 100).toFixed(2).replace('.', ','),
      ]);
    const csv = [header, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `\uFEFF${csv}\r\n`, 'utf8');
    this.activitiesRepo.add('export_completed', 'Export TVA', `${formatDateFR(from)} → ${formatDateFR(to)}`, 'system', null);
    return { canceled: false, path: resolved };
  }

  exportJson(targetPath: string): ExportResult {
    const settings = this.settingsRepo.get();
    const clients = this.clientsRepo.list({ includeArchived: true });
    const invoices = this.invoicesRepo.listForExport({ type: 'all' });
    const payments = this.db.all<Record<string, string | number | null>>('SELECT * FROM payments ORDER BY date ASC;');
    const payload = {
      app: 'FacturePro',
      version: this.appVersion,
      exportedAt: new Date().toISOString(),
      rulesVersion: 'FR-2026.10',
      settings,
      clients,
      invoices,
      payments,
    };
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(payload, null, 2), 'utf8');
    this.activitiesRepo.add('export_completed', 'Export JSON des données', '', 'system', null);
    return { canceled: false, path: resolved, count: invoices.length };
  }

  exportPdfZip(invoiceIds: string[], targetPath: string): ExportResult {
    const zip = new AdmZip();
    let count = 0;
    for (const id of invoiceIds) {
      try {
        const invoice = this.invoicesRepo.get(id);
        if (!invoice || !invoice.pdf) continue;
        const absolute = safeDocumentPath(this.paths.base, invoice.pdf.path);
        if (!fs.existsSync(absolute)) continue;
        zip.addLocalFile(absolute, '', this.exportFileName(invoice));
        count += 1;
      } catch (error) {
        this.logger.warn(`PDF ignoré lors de l'export ZIP (${id}).`, error);
      }
    }
    if (count === 0) throw new AppError('Aucun PDF disponible pour les documents sélectionnés.', 'NO_PDF');
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    zip.writeZip(resolved);
    this.activitiesRepo.add('export_completed', 'Archive ZIP des PDF', `${count} document(s)`, 'system', null);
    return { canceled: false, path: resolved, count };
  }

  /* ------------------------------------------------------------------ */
  /* Sauvegardes                                                         */
  /* ------------------------------------------------------------------ */

  listBackups(): BackupInfo[] {
    if (!fs.existsSync(this.paths.backups)) return [];
    return fs
      .readdirSync(this.paths.backups)
      .filter((name) => name.toLowerCase().endsWith('.zip'))
      .map((name) => {
        const full = path.join(this.paths.backups, name);
        const stat = fs.statSync(full);
        return {
          name,
          path: full,
          createdAt: stat.mtime.toISOString(),
          size: stat.size,
          automatic: /-auto\.zip$/i.test(name),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  createBackup(automatic = false): BackupInfo {
    this.db.persist();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `Sauvegarde-FacturePro-${stamp}-${automatic ? 'auto' : 'manuelle'}.zip`;
    const target = path.join(this.paths.backups, name);
    const zip = new AdmZip();
    const manifest = {
      app: 'FacturePro',
      version: this.appVersion,
      createdAt: new Date().toISOString(),
      databaseVersion: this.db.schemaVersion,
      rulesVersion: 'FR-2026.10',
      invoices: Number(this.db.scalar<number>('SELECT COUNT(*) FROM invoices;') ?? 0),
      clients: Number(this.db.scalar<number>('SELECT COUNT(*) FROM clients;') ?? 0),
    };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
    zip.addFile('data/facturepro.db', fs.readFileSync(this.paths.database));
    if (fs.existsSync(this.paths.documents)) zip.addLocalFolder(this.paths.documents, 'documents');
    if (fs.existsSync(this.paths.branding)) zip.addLocalFolder(this.paths.branding, 'branding');
    zip.writeZip(target);
    const stat = fs.statSync(target);
    this.activitiesRepo.add(
      'backup_created',
      automatic ? 'Sauvegarde automatique' : 'Sauvegarde manuelle',
      `${name} — ${humanFileSize(stat.size)}`,
      'backup',
      null,
    );
    this.activitiesRepo.audit('backup.create', 'backup', null, { name, automatic, size: stat.size });
    this.pruneAutomaticBackups();
    return {
      name,
      path: target,
      createdAt: stat.mtime.toISOString(),
      size: stat.size,
      automatic,
    };
  }

  private pruneAutomaticBackups(): void {
    const autos = this.listBackups().filter((b) => b.automatic);
    for (const backup of autos.slice(AUTO_BACKUP_RETENTION)) {
      try {
        fs.unlinkSync(backup.path);
      } catch {
        /* ignore */
      }
    }
  }

  maybeAutoBackup(): void {
    const backups = this.listBackups();
    const last = backups[0];
    if (last && Date.now() - new Date(last.createdAt).getTime() < 24 * 60 * 60 * 1000) return;
    try {
      this.createBackup(true);
    } catch (error) {
      this.logger.error('Sauvegarde automatique impossible.', error);
    }
  }

  deleteBackup(backupPath: string): void {
    const resolved = path.resolve(backupPath);
    if (!resolved.startsWith(path.resolve(this.paths.backups) + path.sep)) {
      throw new AppError('Sauvegarde hors du répertoire autorisé.');
    }
    if (!fs.existsSync(resolved)) throw new AppError('Sauvegarde introuvable.', 'NOT_FOUND');
    fs.unlinkSync(resolved);
    this.activitiesRepo.audit('backup.delete', 'backup', null, { file: path.basename(resolved) });
  }

  exportBackup(backupPath: string, targetPath: string): string {
    const resolvedSource = path.resolve(backupPath);
    if (!resolvedSource.startsWith(path.resolve(this.paths.backups) + path.sep)) {
      throw new AppError('Sauvegarde hors du répertoire autorisé.');
    }
    if (!fs.existsSync(resolvedSource)) throw new AppError('Sauvegarde introuvable.', 'NOT_FOUND');
    const resolved = path.resolve(targetPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.copyFileSync(resolvedSource, resolved);
    return resolved;
  }

  importBackup(sourcePath: string): BackupInfo {
    const resolved = path.resolve(sourcePath);
    if (!fs.existsSync(resolved)) throw new AppError('Fichier de sauvegarde introuvable.', 'NOT_FOUND');
    this.validateBackup(resolved);
    const name = `Import-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.zip`;
    const target = path.join(this.paths.backups, name);
    fs.copyFileSync(resolved, target);
    const stat = fs.statSync(target);
    this.activitiesRepo.add('backup_created', 'Sauvegarde importée', name, 'backup', null);
    return { name, path: target, createdAt: stat.mtime.toISOString(), size: stat.size, automatic: false };
  }

  private validateBackup(backupPath: string): { manifest: Record<string, unknown>; dbBytes: Buffer } {
    const zip = new AdmZip(backupPath);
    const manifestEntry = zip.getEntry('manifest.json');
    const dbEntry = zip.getEntry('data/facturepro.db');
    if (!manifestEntry || !dbEntry) throw new AppError('Sauvegarde invalide : fichiers requis manquants.', 'INVALID_BACKUP');
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new AppError('Sauvegarde invalide : manifeste illisible.', 'INVALID_BACKUP');
    }
    if (manifest.app !== 'FacturePro') throw new AppError('Ce fichier n’est pas une sauvegarde FacturePro.', 'INVALID_BACKUP');
    if (Number(manifest.databaseVersion) > this.db.schemaVersion) {
      throw new AppError('Cette sauvegarde provient d’une version plus récente de l’application.', 'INVALID_BACKUP');
    }
    return { manifest, dbBytes: dbEntry.getData() };
  }

  async restoreBackup(backupPath: string): Promise<void> {
    const resolved = path.resolve(backupPath);
    if (!fs.existsSync(resolved)) throw new AppError('Sauvegarde introuvable.', 'NOT_FOUND');
    const { dbBytes } = this.validateBackup(resolved);
    // Sauvegarde de sécurité avant toute restauration.
    this.createBackup(false);
    const zip = new AdmZip(resolved);
    const tempDir = path.join(this.paths.temp, `restore-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    try {
      zip.extractAllTo(tempDir, true);
      this.db.replaceWith(dbBytes);
      // Remplacement des documents et du branding.
      const swap = (name: string) => {
        const target = name === 'documents' ? this.paths.documents : this.paths.branding;
        const incoming = path.join(tempDir, name);
        if (!fs.existsSync(incoming)) return;
        const previous = path.join(this.paths.temp, `${name}-previous-${Date.now()}`);
        if (fs.existsSync(target)) fs.renameSync(target, previous);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.cpSync(incoming, target, { recursive: true });
        try {
          fs.rmSync(previous, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      };
      swap('documents');
      swap('branding');
      this.activitiesRepo.add('backup_restored', 'Sauvegarde restaurée', path.basename(resolved), 'backup', null);
      this.activitiesRepo.audit('backup.restore', 'backup', null, {
        file: path.basename(resolved),
      });
    } catch (error) {
      this.logger.error('Restauration impossible.', error);
      throw error instanceof AppError
        ? error
        : new AppError('La restauration a échoué. La sauvegarde de sécurité créée avant l’opération peut être restaurée.');
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Divers                                                              */
  /* ------------------------------------------------------------------ */

  /** Import d'adresse client utilitaire (tests). */
  ensureClientSnapshot(clientId: string): ClientSnapshot {
    const client = this.getClient(clientId);
    return this.clientsRepo.buildSnapshot(client);
  }
}
