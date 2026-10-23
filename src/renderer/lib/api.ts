import type {
  IpcChannel,
} from '@shared/ipc';
import { IPC } from '@shared/ipc';
import type {
  ActivityItem,
  AppInfo,
  AppSettings,
  BackupInfo,
  Client,
  ClientInput,
  ComplianceReport,
  DashboardData,
  Diagnostics,
  DocumentType,
  EffectiveStatus,
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
} from '@shared/types';

export interface ApiFailureDetail {
  path?: string;
  message: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(message: string, code = 'APP_ERROR', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

async function invoke<T>(channel: IpcChannel, payload?: unknown): Promise<T> {
  if (!window.facturepro) {
    throw new ApiError(
      "L'interface doit être exécutée dans l'application FacturePro.",
      'NO_BRIDGE',
    );
  }
  const response = await window.facturepro.invoke<T>(channel, payload);
  if (!response.ok) {
    throw new ApiError(response.error.message, response.error.code, response.error.details);
  }
  return response.data;
}

export interface PaymentListFilters {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  invoiceId?: string;
  page?: number;
  pageSize?: number;
}

export interface ClientListFilters {
  query?: string;
  type?: 'particulier' | 'professionnel' | 'all';
  includeArchived?: boolean;
  sort?: 'name' | 'created' | 'revenue';
}

export interface PreviewResult {
  base64: string;
  fileName: string;
  report: ComplianceReport | null;
  draft: boolean;
}

export interface IssueResult {
  invoice: Invoice;
  report: ComplianceReport;
  pdfWarning?: string;
}

export const api = {
  appInfo: () => invoke<AppInfo>(IPC.appInfo),
  diagnostics: () => invoke<Diagnostics>(IPC.appDiagnostics),
  openDataFolder: () => invoke<{ opened: boolean }>(IPC.appOpenDataFolder),
  openLogsFolder: () => invoke<{ opened: boolean }>(IPC.appOpenLogsFolder),
  openExternal: (url: string) => invoke<{ opened: boolean }>(IPC.appOpenExternal, { url }),
  savePreviewPdf: (base64: string, fileName: string) =>
    invoke<{ canceled: boolean; path?: string }>(IPC.appSavePreviewPdf, { base64, fileName }),

  settings: {
    get: () => invoke<AppSettings>(IPC.settingsGet),
    save: (settings: AppSettings) => invoke<AppSettings>(IPC.settingsSave, settings),
    uploadLogo: (payload: LogoUploadPayload) => invoke<AppSettings>(IPC.settingsUploadLogo, payload),
    removeLogo: () => invoke<AppSettings>(IPC.settingsRemoveLogo),
    logoData: () => invoke<{ dataUrl: string | null }>(IPC.settingsLogoData),
  },

  clients: {
    list: (filters?: ClientListFilters) => invoke<Client[]>(IPC.clientsList, filters),
    get: (id: string) => invoke<Client>(IPC.clientsGet, { id }),
    create: (input: ClientInput) => invoke<Client>(IPC.clientsCreate, input),
    update: (id: string, input: ClientInput) => invoke<Client>(IPC.clientsUpdate, { id, data: input }),
    archive: (id: string, value: boolean) => invoke<Client>(IPC.clientsArchive, { id, value }),
    remove: (id: string) => invoke<{ deleted: boolean }>(IPC.clientsDelete, { id }),
  },

  invoices: {
    list: (filters: InvoiceListFilters) => invoke<Paginated<InvoiceSummary>>(IPC.invoicesList, filters),
    get: (id: string) => invoke<Invoice>(IPC.invoicesGet, { id }),
    saveDraft: (input: InvoiceDraftInput) => invoke<Invoice>(IPC.invoicesSaveDraft, input),
    updateDraft: (id: string, input: InvoiceDraftInput) =>
      invoke<Invoice>(IPC.invoicesUpdateDraft, { ...input, id }),
    deleteDraft: (id: string) => invoke<{ deleted: boolean }>(IPC.invoicesDeleteDraft, { id }),
    issue: (id: string) => invoke<IssueResult>(IPC.invoicesIssue, { id }),
    preview: (payload: { id?: string; draft?: InvoiceDraftInput }) =>
      invoke<PreviewResult>(IPC.invoicesPreview, payload),
    readPdf: (id: string) => invoke<{ base64: string; fileName: string; integrity: boolean }>(IPC.invoicesReadPdf, { id }),
    saveAs: (id: string) => invoke<{ canceled: boolean; path?: string }>(IPC.invoicesSaveAs, { id }),
    print: (id: string) => invoke<{ printed: boolean; opened: boolean; invoiceNumber: string | null }>(IPC.invoicesPrint, { id }),
    open: (id: string) => invoke<{ opened: boolean }>(IPC.invoicesOpen, { id }),
    markSent: (id: string) => invoke<Invoice>(IPC.invoicesMarkSent, { id }),
    duplicate: (id: string) => invoke<Invoice>(IPC.invoicesDuplicate, { id }),
    validate: (id: string) => invoke<ComplianceReport>(IPC.invoicesValidate, { id }),
    validateDraft: (input: InvoiceDraftInput) => invoke<ComplianceReport>(IPC.invoicesValidateDraft, input),
    regeneratePdf: (id: string) => invoke<Invoice>(IPC.invoicesRegeneratePdf, { id }),
    creditNotes: (id: string) => invoke<InvoiceSummary[]>(IPC.invoicesCreditNotes, { id }),
    numberPreview: (type: DocumentType = 'invoice') => invoke<NumberPreview>(IPC.invoicesNumberPreview, { type }),
  },

  payments: {
    list: (filters?: PaymentListFilters) => invoke<Paginated<Payment>>(IPC.paymentsList, filters),
    byInvoice: (invoiceId: string) => invoke<Payment[]>(IPC.paymentsByInvoice, { id: invoiceId }),
    create: (input: PaymentInput) => invoke<Payment>(IPC.paymentsCreate, input),
    remove: (id: string) => invoke<{ invoiceId: string }>(IPC.paymentsDelete, { id }),
  },

  dashboard: (preset: PeriodPreset, from?: string, to?: string) =>
    invoke<DashboardData>(IPC.dashboardGet, { preset, from, to }),
  stats: (year: number) => invoke<StatsData>(IPC.statsGet, { year }),
  activities: (limit = 20) => invoke<ActivityItem[]>(IPC.activitiesList, { limit }),
  search: (query: string) => invoke<GlobalSearchResults>(IPC.searchGlobal, { query }),

  exports: {
    csv: (filters: ExportFilters) => invoke<ExportResult>(IPC.exportsCsv, filters),
    vatCsv: (dateFrom: string, dateTo: string) =>
      invoke<ExportResult>(IPC.exportsVatCsv, { dateFrom, dateTo }),
    json: () => invoke<ExportResult>(IPC.exportsJson),
    zip: (ids: string[]) => invoke<ExportResult>(IPC.exportsZip, { ids }),
  },

  backups: {
    list: () => invoke<BackupInfo[]>(IPC.backupsList),
    create: () => invoke<BackupInfo>(IPC.backupsCreate),
    restore: (path: string) => invoke<{ restored: boolean }>(IPC.backupsRestore, { path }),
    remove: (path: string) => invoke<{ deleted: boolean }>(IPC.backupsDelete, { path }),
    export: (path: string) => invoke<{ canceled: boolean; path?: string }>(IPC.backupsExport, { path }),
    import: () => invoke<{ canceled: boolean; backup?: BackupInfo }>(IPC.backupsImport),
    reveal: () => invoke<{ opened: boolean }>(IPC.backupsReveal),
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Une erreur inattendue est survenue.';
}

export function validationDetails(error: unknown): ApiFailureDetail[] {
  if (error instanceof ApiError && Array.isArray(error.details)) {
    return error.details as ApiFailureDetail[];
  }
  return [];
}

export type { EffectiveStatus, Invoice, InvoiceSummary, Paginated };
