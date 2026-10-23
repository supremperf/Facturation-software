/** Canaux IPC autorisés (liste blanche partagée main <-> preload). */
export const IPC = {
  appInfo: 'app:info',
  appDiagnostics: 'app:diagnostics',
  appOpenDataFolder: 'app:open-data-folder',
  appOpenLogsFolder: 'app:open-logs-folder',
  appOpenExternal: 'app:open-external',
  appSavePreviewPdf: 'app:save-preview-pdf',

  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsUploadLogo: 'settings:upload-logo',
  settingsRemoveLogo: 'settings:remove-logo',
  settingsLogoData: 'settings:logo-data',

  clientsList: 'clients:list',
  clientsGet: 'clients:get',
  clientsCreate: 'clients:create',
  clientsUpdate: 'clients:update',
  clientsArchive: 'clients:archive',
  clientsDelete: 'clients:delete',

  invoicesList: 'invoices:list',
  invoicesGet: 'invoices:get',
  invoicesSaveDraft: 'invoices:save-draft',
  invoicesUpdateDraft: 'invoices:update-draft',
  invoicesDeleteDraft: 'invoices:delete-draft',
  invoicesIssue: 'invoices:issue',
  invoicesPreview: 'invoices:preview',
  invoicesReadPdf: 'invoices:read-pdf',
  invoicesSaveAs: 'invoices:save-as',
  invoicesPrint: 'invoices:print',
  invoicesOpen: 'invoices:open',
  invoicesMarkSent: 'invoices:mark-sent',
  invoicesDuplicate: 'invoices:duplicate',
  invoicesValidate: 'invoices:validate',
  invoicesValidateDraft: 'invoices:validate-draft',
  invoicesRegeneratePdf: 'invoices:regenerate-pdf',
  invoicesCreditNotes: 'invoices:credit-notes',
  invoicesNumberPreview: 'invoices:number-preview',

  paymentsList: 'payments:list',
  paymentsByInvoice: 'payments:by-invoice',
  paymentsCreate: 'payments:create',
  paymentsDelete: 'payments:delete',

  dashboardGet: 'dashboard:get',
  statsGet: 'stats:get',
  activitiesList: 'activities:list',
  searchGlobal: 'search:global',

  exportsCsv: 'exports:csv',
  exportsVatCsv: 'exports:vat-csv',
  exportsJson: 'exports:json',
  exportsZip: 'exports:zip',

  backupsList: 'backups:list',
  backupsCreate: 'backups:create',
  backupsRestore: 'backups:restore',
  backupsDelete: 'backups:delete',
  backupsExport: 'backups:export',
  backupsImport: 'backups:import',
  backupsReveal: 'backups:reveal',

  printPdf: 'print:pdf',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
export const INVOKE_CHANNELS: IpcChannel[] = Object.values(IPC);

export const APP_EVENTS = {
  navigate: 'app:navigate',
  dataRestored: 'app:data-restored',
  menuNewInvoice: 'app:menu-new-invoice',
  menuOpenSettings: 'app:menu-open-settings',
} as const;

export type AppEventName = (typeof APP_EVENTS)[keyof typeof APP_EVENTS];

export interface IpcSuccess<T> {
  ok: true;
  data: T;
}

export interface IpcFailure {
  ok: false;
  error: {
    message: string;
    code: string;
    details?: unknown;
  };
}

export type IpcEnvelope<T> = IpcSuccess<T> | IpcFailure;
