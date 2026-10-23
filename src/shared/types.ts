/**
 * Types du domaine FacturePro.
 * Tous les montants monétaires sont exprimés en CENTIMES (entiers) afin d'éviter
 * toute erreur d'arrondi liée aux nombres flottants.
 * Les taux de TVA et remises en pourcentage sont exprimés en POINTS DE BASE
 * (2000 = 20,00 %, 550 = 5,50 %).
 */

export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // ISO 8601
export type UUID = string;

export type ClientType = 'particulier' | 'professionnel';
export type DocumentType = 'invoice' | 'credit_note';
export type InvoiceStatus = 'draft' | 'issued' | 'sent' | 'partial' | 'paid' | 'cancelled';
export type EffectiveStatus = InvoiceStatus | 'overdue';
export type OperationNature = 'goods' | 'services' | 'mixed';
export type DiscountType = 'none' | 'percent' | 'amount';
export type VatRegime = 'normal' | 'franchise' | 'exemption';
export type PaymentMethod = 'virement' | 'carte' | 'especes' | 'cheque' | 'autre';
export type EInvoicingPhase = 'unspecified' | 'ge_eti' | 'pme' | 'not_concerned';
export type PdfTemplate = 'classic' | 'modern' | 'minimal';

export interface Address {
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
}

export interface Client {
  id: UUID;
  type: ClientType;
  civility: string;
  firstName: string;
  lastName: string;
  companyName: string;
  legalForm: string;
  siren: string;
  siret: string;
  vatNumber: string;
  vatSubject: boolean;
  email: string;
  phone: string;
  address: Address;
  deliveryAddress: Address | null;
  notes: string;
  isArchived: boolean;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  invoiceCount?: number;
  totalBilledCents?: number;
  outstandingCents?: number;
}

export type ClientInput = Omit<
  Client,
  'id' | 'createdAt' | 'updatedAt' | 'isArchived' | 'invoiceCount' | 'totalBilledCents' | 'outstandingCents'
>;

export interface InvoiceLineInput {
  id?: UUID;
  designation: string;
  description: string;
  reference: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  discountType: DiscountType;
  discountValue: number;
  vatRateBp: number;
  isExtraFee: boolean;
  operationNature: 'goods' | 'services' | '';
}

export interface InvoiceLineComputed extends InvoiceLineInput {
  id: UUID;
  position: number;
  grossCents: number;
  discountCents: number;
  netCents: number;
  allocatedDiscountCents: number;
  taxableBaseCents: number;
  vatCents: number;
  ttcCents: number;
}

export interface VatBreakdownEntry {
  rateBp: number;
  baseCents: number;
  vatCents: number;
}

export interface InvoiceTotals {
  subtotalCents: number;
  lineDiscountCents: number;
  globalDiscountCents: number;
  totalHtCents: number;
  totalVatCents: number;
  totalTtcCents: number;
  vatBreakdown: VatBreakdownEntry[];
}

export interface ClientSnapshot {
  id: UUID | null;
  displayName: string;
  type: ClientType;
  civility: string;
  firstName: string;
  lastName: string;
  companyName: string;
  legalForm: string;
  siren: string;
  siret: string;
  vatNumber: string;
  vatSubject: boolean;
  email: string;
  phone: string;
  address: Address;
  deliveryAddress: Address | null;
}

export interface SellerSnapshot {
  displayName: string;
  tradeName: string;
  legalName: string;
  legalForm: string;
  legalStatus: string;
  capitalCents: number | null;
  siren: string;
  siret: string;
  rcs: string;
  rm: string;
  ape: string;
  vatNumber: string;
  address: Address;
  phone: string;
  email: string;
  website: string;
  bank: {
    bankName: string;
    accountHolder: string;
    iban: string;
    bic: string;
    paymentInstructions: string;
  };
  logoPath: string | null;
  primaryColor: string;
  secondaryColor: string;
}

export interface LegalSnapshot {
  vatRegime: VatRegime | null;
  franchiseMention: string;
  exemptionReason: string;
  debitsOption: boolean;
  latePenaltyRateBp: number | null;
  recoveryIndemnity: boolean;
  escompte: string;
  mediatorName: string;
  mediatorUrl: string;
  consumerGoodsMention: string;
  invoiceFooter: string;
  eInvoicingPhase: EInvoicingPhase;
  rulesVersion: string;
}

export interface PdfMeta {
  path: string;
  sha256: string;
  generatedAt: ISODateTime;
  size: number;
}

export interface Invoice {
  id: UUID;
  type: DocumentType;
  number: string | null;
  status: InvoiceStatus;
  effectiveStatus?: EffectiveStatus;
  issueDate: ISODate;
  dueDate: ISODate;
  serviceDate: ISODate;
  clientId: UUID | null;
  clientSnapshot: ClientSnapshot;
  sellerSnapshot: SellerSnapshot;
  legalSnapshot: LegalSnapshot;
  billingAddress: Address;
  deliveryAddress: Address | null;
  purchaseOrder: string;
  operationNature: OperationNature;
  description: string;
  paymentTerms: string;
  paymentMethod: PaymentMethod;
  notes: string;
  lines: InvoiceLineComputed[];
  globalDiscountType: DiscountType;
  globalDiscountValue: number;
  totals: InvoiceTotals;
  vatBreakdown: VatBreakdownEntry[];
  paidCents: number;
  creditedCents: number;
  balanceCents: number;
  sourceInvoiceId: UUID | null;
  sourceInvoiceNumber: string | null;
  reason: string;
  pdf: PdfMeta | null;
  issuedAt: ISODateTime | null;
  sentAt: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface InvoiceSummary {
  id: UUID;
  type: DocumentType;
  number: string | null;
  clientName: string;
  status: InvoiceStatus;
  effectiveStatus: EffectiveStatus;
  issueDate: ISODate;
  dueDate: ISODate;
  totalHtCents: number;
  totalTtcCents: number;
  paidCents: number;
  balanceCents: number;
  hasPdf: boolean;
  sourceInvoiceNumber?: string | null;
  reason?: string;
}

export type InvoiceSortField =
  | 'number'
  | 'clientName'
  | 'issueDate'
  | 'dueDate'
  | 'totalTtcCents'
  | 'balanceCents'
  | 'status';
export type SortDirection = 'asc' | 'desc';

export interface InvoiceListFilters {
  query?: string;
  status?: EffectiveStatus | 'all';
  type?: DocumentType | 'all';
  clientId?: UUID;
  dateFrom?: ISODate;
  dateTo?: ISODate;
  sortBy?: InvoiceSortField;
  sortDir?: SortDirection;
  page?: number;
  pageSize?: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface InvoiceDraftInput {
  id?: UUID;
  type?: DocumentType;
  clientId: UUID | null;
  issueDate: ISODate;
  dueDate: ISODate;
  serviceDate: ISODate;
  billingAddress: Address;
  deliveryAddress: Address | null;
  purchaseOrder: string;
  operationNature: OperationNature;
  description: string;
  paymentTerms: string;
  paymentMethod: PaymentMethod;
  notes: string;
  lines: InvoiceLineInput[];
  globalDiscountType: DiscountType;
  globalDiscountValue: number;
  sourceInvoiceId?: UUID | null;
  reason?: string;
}

export interface Payment {
  id: UUID;
  invoiceId: UUID;
  invoiceNumber: string | null;
  invoiceType: DocumentType;
  clientName: string;
  date: ISODate;
  amountCents: number;
  method: PaymentMethod;
  reference: string;
  note: string;
  createdAt: ISODateTime;
}

export interface PaymentInput {
  invoiceId: UUID;
  date: ISODate;
  amountCents: number;
  method: PaymentMethod;
  reference: string;
  note: string;
}

export type ActivityType =
  | 'invoice_created'
  | 'invoice_updated'
  | 'invoice_issued'
  | 'invoice_sent'
  | 'invoice_deleted'
  | 'payment_received'
  | 'payment_deleted'
  | 'credit_note_created'
  | 'credit_note_issued'
  | 'client_created'
  | 'client_updated'
  | 'client_archived'
  | 'client_deleted'
  | 'settings_updated'
  | 'backup_created'
  | 'backup_restored'
  | 'export_completed'
  | 'pdf_generated'
  | 'system';

export interface ActivityItem {
  id: UUID;
  type: ActivityType;
  title: string;
  detail: string;
  entityType: 'invoice' | 'client' | 'payment' | 'settings' | 'backup' | 'system';
  entityId: string | null;
  createdAt: ISODateTime;
}

/* ------------------------------------------------------------------ */
/* Réglages                                                            */
/* ------------------------------------------------------------------ */

export interface CompanyIdentity {
  civility: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  website: string;
}

export interface CompanyBusiness {
  tradeName: string;
  legalName: string;
  legalForm: string;
  legalStatus: string;
  siren: string;
  siret: string;
  rcs: string;
  rcsApplicable: boolean;
  rm: string;
  rmApplicable: boolean;
  capitalCents: number | null;
  ape: string;
  activity: string;
  address: Address;
  vatNumber: string;
}

export interface CompanyBank {
  bankName: string;
  accountHolder: string;
  iban: string;
  bic: string;
  paymentInstructions: string;
}

export interface CompanyFiscal {
  regime: VatRegime | null;
  vatRates: number[];
  franchiseMention: string;
  exemptionReason: string;
  debitsOption: boolean;
  fiscalRegime: string;
}

export interface CompanyBranding {
  logo: { path: string; mime: string; updatedAt: ISODateTime } | null;
  primaryColor: string;
  secondaryColor: string;
  showLogo: boolean;
}

export interface DocumentSettings {
  invoicePrefix: string;
  creditPrefix: string;
  padding: number;
  resetYearly: boolean;
  startNumber: number | null;
  pdfTemplate: PdfTemplate;
  defaultTermsDays: number | null;
  defaultPaymentMethod: PaymentMethod;
  defaultVatRateBp: number | null;
  defaultUnit: string;
}

export interface LegalSettings {
  latePenaltyRateBp: number | null;
  recoveryIndemnity: boolean;
  escompte: string;
  mediatorName: string;
  mediatorAddress: string;
  mediatorUrl: string;
  consumerGoodsMention: string;
  enforceSirenForProClients: boolean;
  eInvoicingPhase: EInvoicingPhase;
  eInvoicingPartner: string;
}

export interface AppSettings {
  identity: CompanyIdentity;
  business: CompanyBusiness;
  bank: CompanyBank;
  fiscal: CompanyFiscal;
  branding: CompanyBranding;
  documents: DocumentSettings;
  legal: LegalSettings;
  setupCompleted: boolean;
  updatedAt: ISODateTime | null;
}

/* ------------------------------------------------------------------ */
/* Conformité                                                          */
/* ------------------------------------------------------------------ */

export type CheckStatus = 'ok' | 'missing' | 'incoherent' | 'not_applicable';
export type CheckSeverity = 'blocking' | 'warning' | 'info';

export interface ComplianceCheck {
  id: string;
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  message: string;
  reference?: string;
  category: 'company' | 'client' | 'invoice' | 'lines' | 'vat' | 'payment' | 'e_invoicing';
}

export interface ComplianceReport {
  checkedAt: ISODateTime;
  rulesVersion: string;
  checks: ComplianceCheck[];
  canIssue: boolean;
  blockingCount: number;
  warningCount: number;
  okCount: number;
  notApplicableCount: number;
}

/* ------------------------------------------------------------------ */
/* Tableau de bord / statistiques                                      */
/* ------------------------------------------------------------------ */

export type PeriodPreset = 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom' | 'all';

export interface PeriodRange {
  preset: PeriodPreset;
  from: ISODate;
  to: ISODate;
  label: string;
}

export interface DashboardKpis {
  revenueHtCents: number;
  revenueTtcCents: number;
  collectedCents: number;
  outstandingCents: number;
  invoicesCount: number;
  paidCount: number;
  pendingCount: number;
  overdueCount: number;
  draftCount: number;
  clientCount: number;
}

export interface DashboardData {
  period: PeriodRange;
  kpis: DashboardKpis;
  previous: DashboardKpis;
  revenueSeries: { label: string; htCents: number; ttcCents: number; count: number }[];
  statusBreakdown: { status: EffectiveStatus; count: number; amountCents: number }[];
  statusTotal: number;
  cashComparison: { label: string; collectedCents: number; outstandingCents: number }[];
  recentInvoices: InvoiceSummary[];
  recentActivities: ActivityItem[];
  yearlyRevenueCents: number;
  storageBytes: number;
  lastBackupAt: ISODateTime | null;
  overdueTotalCents: number;
}

export interface StatsData {
  year: number;
  availableYears: number[];
  monthly: { month: number; label: string; htCents: number; ttcCents: number; paidCents: number; count: number }[];
  vatByRate: { rateBp: number; baseCents: number; vatCents: number }[];
  topClients: { clientId: UUID | null; name: string; totalCents: number; count: number }[];
  totals: {
    revenueHtCents: number;
    revenueTtcCents: number;
    vatCents: number;
    collectedCents: number;
    outstandingCents: number;
    invoiceCount: number;
    averageInvoiceCents: number;
    creditNotesCents: number;
  };
  monthlyPayments: { label: string; amountCents: number }[];
}

/* ------------------------------------------------------------------ */
/* Sauvegardes / exports / système                                     */
/* ------------------------------------------------------------------ */

export interface BackupInfo {
  name: string;
  path: string;
  createdAt: ISODateTime;
  size: number;
  automatic: boolean;
}

export interface BackupManifest {
  app: string;
  version: string;
  createdAt: ISODateTime;
  databaseVersion: number;
  files: number;
}

export interface ExportFilters {
  dateFrom?: ISODate;
  dateTo?: ISODate;
  clientId?: UUID;
  status?: EffectiveStatus | 'all';
  type?: DocumentType | 'all';
}

export interface ExportResult {
  canceled: boolean;
  path?: string;
  count?: number;
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
  userDataPath: string;
  documentsPath: string;
  databasePath: string;
  backupsPath: string;
  databaseSize: number;
  documentsSize: number;
  documentCount: number;
  rulesVersion: string;
  startedAt: ISODateTime;
  dbSchemaVersion: number;
}

export interface Diagnostics {
  integrity: string;
  tables: { name: string; rows: number }[];
  orphanFiles: number;
  missingPdfs: number;
  duplicateNumbers: number;
  invoicesWithoutNumber: number;
  lastBackupAt: ISODateTime | null;
}

export interface GlobalSearchResults {
  clients: { id: UUID; name: string; detail: string }[];
  invoices: { id: UUID; number: string | null; clientName: string; detail: string }[];
}

export interface NumberPreview {
  nextNumber: string;
  year: number;
  lastNumber: string | null;
  sequence: number;
}

export interface LogoUploadPayload {
  fileName: string;
  mime: string;
  base64: string;
}

export interface UiPrefs {
  sidebarCollapsed: boolean;
}
