import path from 'node:path';
import { z, ZodError } from 'zod';
import { IPC, type IpcChannel, type IpcEnvelope } from '@shared/ipc';
import type { AppSettings, InvoiceDraftInput } from '@shared/types';
import { todayISO } from '@shared/dates';
import { AppError, type AppServices } from '../services/app-services';
import {
  BackupPathSchema,
  ClientListSchema,
  ClientSchema,
  DashboardSchema,
  DraftSchema,
  ExportFiltersSchema,
  ExternalUrlSchema,
  IdBooleanSchema,
  IdSchema,
  InvoiceFiltersSchema,
  LogoUploadSchema,
  PaymentCreateSchema,
  PaymentListSchema,
  PeriodTypeSchema,
  PreviewSchema,
  SavePreviewSchema,
  SettingsSchema,
  StatsSchema,
  UpdateDraftSchema,
  VatExportSchema,
  ZipExportSchema,
} from './schemas';

export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Dépendances natives (Electron) injectées dans la couche métier IPC.
 * Cette séparation permet de tester les canaux hors d'Electron (tests
 * d'intégration, serveur d'aperçu) sans dupliquer le mapping des canaux.
 */
export interface IpcHost {
  /** Ouvre une boîte « Enregistrer sous ». Retourne null si annulé. */
  saveFile(defaultFileName: string, filters: FileFilter[]): Promise<string | null>;
  /** Sélectionne un fichier de sauvegarde à importer. */
  pickBackupFile(): Promise<string | null>;
  /** Ouvre un chemin dans le gestionnaire de fichiers. Retourne un message d'erreur ou ''. */
  openPath(target: string): Promise<string>;
  openUrl(url: string): Promise<void>;
  printPdf(filePath: string): Promise<{ printed: boolean; opened: boolean }>;
  /** Notifie les fenêtres qu'une sauvegarde a été restaurée. */
  notifyDataRestored(): void;
}

export type IpcHandler = (raw: unknown) => Promise<unknown>;

export interface HandlerLogger {
  warn(message: string, error?: unknown): void;
  error(message: string, error?: unknown): void;
}

type HandlerMap = Record<IpcChannel, IpcHandler>;

/**
 * Construit le mapping complet des canaux IPC vers les services métier.
 * Toutes les entrées de `IPC` doivent être couvertes (le typage l'impose).
 */
export function createIpcHandlers(
  services: AppServices,
  host: IpcHost,
  logger: HandlerLogger = services.logger,
): HandlerMap {
  const define = <S extends z.ZodTypeAny>(
    schema: S | null,
    fn: (payload: z.infer<S>) => Promise<unknown> | unknown,
  ): IpcHandler => {
    return async (raw: unknown) => {
      const payload = schema ? schema.parse(raw) : (undefined as z.infer<S>);
      return fn(payload);
    };
  };

  const openDataFolder = async (target: string) => {
    const error = await host.openPath(target);
    if (error) throw new AppError(`Impossible d’ouvrir le dossier : ${error}`, 'OPEN_FAILED');
    return { opened: true };
  };

  const handlers: HandlerMap = {
    /* ------------------------------ Application ------------------------------ */
    [IPC.appInfo]: define(null, () => services.appInfo()),
    [IPC.appDiagnostics]: define(null, () => services.diagnostics()),
    [IPC.appOpenDataFolder]: define(null, () => openDataFolder(services.paths.base)),
    [IPC.appOpenLogsFolder]: define(null, () => openDataFolder(services.paths.logs)),
    [IPC.appOpenExternal]: define(ExternalUrlSchema, async ({ url }) => {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        throw new AppError('Seules les adresses web http(s) peuvent être ouvertes.', 'INVALID_URL');
      }
      await host.openUrl(parsed.toString());
      return { opened: true };
    }),
    [IPC.appSavePreviewPdf]: define(SavePreviewSchema, async ({ base64, fileName }) => {
      const target = await host.saveFile(fileName, [{ name: 'Document PDF', extensions: ['pdf'] }]);
      if (!target) return { canceled: true };
      const saved = services.savePreviewPdf(base64, target);
      return { canceled: false, path: saved };
    }),

    /* -------------------------------- Réglages ------------------------------- */
    [IPC.settingsGet]: define(null, () => services.getSettings()),
    [IPC.settingsSave]: define(SettingsSchema, (payload) => services.saveSettings(payload as AppSettings)),
    [IPC.settingsUploadLogo]: define(LogoUploadSchema, (payload) => services.uploadLogo(payload)),
    [IPC.settingsRemoveLogo]: define(null, () => services.removeLogo()),
    [IPC.settingsLogoData]: define(null, () => ({ dataUrl: services.logoDataUrl() })),

    /* --------------------------------- Clients ------------------------------- */
    [IPC.clientsList]: define(ClientListSchema, (payload) => services.listClients(payload ?? {})),
    [IPC.clientsGet]: define(IdSchema, ({ id }) => services.getClient(id)),
    [IPC.clientsCreate]: define(ClientSchema, (payload) => services.createClient(payload)),
    [IPC.clientsUpdate]: define(
      z.object({ id: z.string().min(1).max(100), data: ClientSchema }),
      ({ id, data }) => services.updateClient(id, data),
    ),
    [IPC.clientsArchive]: define(IdBooleanSchema, ({ id, value }) => services.setClientArchived(id, value)),
    [IPC.clientsDelete]: define(IdSchema, ({ id }) => {
      services.deleteClient(id);
      return { deleted: true };
    }),

    /* -------------------------------- Factures ------------------------------- */
    [IPC.invoicesList]: define(InvoiceFiltersSchema, (payload) => services.listInvoices(payload)),
    [IPC.invoicesGet]: define(IdSchema, ({ id }) => services.getInvoice(id)),
    [IPC.invoicesSaveDraft]: define(DraftSchema, (payload) => services.saveDraft(payload as InvoiceDraftInput)),
    [IPC.invoicesUpdateDraft]: define(UpdateDraftSchema, ({ id, ...payload }) =>
      services.updateDraft(id, payload as InvoiceDraftInput),
    ),
    [IPC.invoicesDeleteDraft]: define(IdSchema, ({ id }) => {
      services.deleteDraft(id);
      return { deleted: true };
    }),
    [IPC.invoicesIssue]: define(IdSchema, ({ id }) => services.issueInvoice(id)),
    [IPC.invoicesPreview]: define(PreviewSchema, (payload) => services.previewPdf(payload)),
    [IPC.invoicesReadPdf]: define(IdSchema, ({ id }) => services.readPdf(id)),
    [IPC.invoicesSaveAs]: define(IdSchema, async ({ id }) => {
      const invoice = services.getInvoice(id);
      const target = await host.saveFile(services.exportFileName(invoice), [
        { name: 'Document PDF', extensions: ['pdf'] },
      ]);
      if (!target) return { canceled: true };
      return { canceled: false, path: services.savePdfAs(id, target) };
    }),
    [IPC.invoicesPrint]: define(IdSchema, async ({ id }) => {
      const invoice = services.getInvoice(id);
      const filePath = services.pdfFilePath(id);
      const result = await host.printPdf(filePath);
      return { ...result, invoiceNumber: invoice.number };
    }),
    [IPC.invoicesOpen]: define(IdSchema, async ({ id }) => {
      const filePath = services.pdfFilePath(id);
      const error = await host.openPath(filePath);
      if (error) throw new AppError(`Impossible d’ouvrir le PDF : ${error}`, 'OPEN_FAILED');
      return { opened: true };
    }),
    [IPC.invoicesMarkSent]: define(IdSchema, ({ id }) => services.markSent(id)),
    [IPC.invoicesDuplicate]: define(IdSchema, ({ id }) => services.duplicate(id)),
    [IPC.invoicesValidate]: define(IdSchema, ({ id }) => services.validateInvoice(id)),
    [IPC.invoicesValidateDraft]: define(DraftSchema, (payload) =>
      services.validateDraft(payload as InvoiceDraftInput),
    ),
    [IPC.invoicesRegeneratePdf]: define(IdSchema, ({ id }) => services.regeneratePdf(id)),
    [IPC.invoicesCreditNotes]: define(IdSchema, ({ id }) => services.invoiceCreditNotes(id)),
    [IPC.invoicesNumberPreview]: define(PeriodTypeSchema, (payload) =>
      services.numberPreview(payload?.type ?? 'invoice'),
    ),

    /* -------------------------------- Paiements ------------------------------ */
    [IPC.paymentsList]: define(PaymentListSchema, (payload) => services.listPayments(payload ?? {})),
    [IPC.paymentsByInvoice]: define(IdSchema, ({ id }) => services.paymentsForInvoice(id)),
    [IPC.paymentsCreate]: define(PaymentCreateSchema, (payload) => services.addPayment(payload)),
    [IPC.paymentsDelete]: define(IdSchema, ({ id }) => services.deletePayment(id)),

    /* --------------------------------- Analyse ------------------------------- */
    [IPC.dashboardGet]: define(DashboardSchema, ({ preset, from, to }) => services.dashboard(preset, from, to)),
    [IPC.statsGet]: define(StatsSchema, ({ year }) => services.stats(year)),
    [IPC.activitiesList]: define(
      z.object({ limit: z.number().int().min(1).max(100).optional() }).optional(),
      (payload) => services.listActivities(payload?.limit ?? 20),
    ),
    [IPC.searchGlobal]: define(z.object({ query: z.string().max(200) }), ({ query }) =>
      services.globalSearch(query),
    ),

    /* --------------------------------- Exports ------------------------------- */
    [IPC.exportsCsv]: define(ExportFiltersSchema, async (payload) => {
      const suffix = payload.dateFrom
        ? `${payload.dateFrom}_${payload.dateTo ?? todayISO()}`
        : todayISO();
      const target = await host.saveFile(`Factures_${suffix}.csv`, [
        { name: 'Fichier CSV', extensions: ['csv'] },
      ]);
      if (!target) return { canceled: true };
      return services.exportInvoicesCsv(payload, target);
    }),
    [IPC.exportsVatCsv]: define(VatExportSchema, async (payload) => {
      const target = await host.saveFile(`TVA_${payload.dateFrom}_${payload.dateTo}.csv`, [
        { name: 'Fichier CSV', extensions: ['csv'] },
      ]);
      if (!target) return { canceled: true };
      return services.exportVatCsv(payload.dateFrom, payload.dateTo, target);
    }),
    [IPC.exportsJson]: define(null, async () => {
      const target = await host.saveFile(`FacturePro_donnees_${todayISO()}.json`, [
        { name: 'Fichier JSON', extensions: ['json'] },
      ]);
      if (!target) return { canceled: true };
      return services.exportJson(target);
    }),
    [IPC.exportsZip]: define(ZipExportSchema, async (payload) => {
      const target = await host.saveFile(`Factures_${todayISO()}.zip`, [
        { name: 'Archive ZIP', extensions: ['zip'] },
      ]);
      if (!target) return { canceled: true };
      return services.exportPdfZip(payload.ids, target);
    }),

    /* ------------------------------- Sauvegardes ----------------------------- */
    [IPC.backupsList]: define(null, () => services.listBackups()),
    [IPC.backupsCreate]: define(null, () => services.createBackup(false)),
    [IPC.backupsRestore]: define(BackupPathSchema, async ({ path: backupPath }) => {
      await services.restoreBackup(backupPath);
      services.maybeAutoBackup();
      host.notifyDataRestored();
      return { restored: true };
    }),
    [IPC.backupsDelete]: define(BackupPathSchema, ({ path: backupPath }) => {
      services.deleteBackup(backupPath);
      return { deleted: true };
    }),
    [IPC.backupsExport]: define(BackupPathSchema, async ({ path: backupPath }) => {
      const target = await host.saveFile(path.basename(backupPath), [
        { name: 'Sauvegarde FacturePro', extensions: ['zip'] },
      ]);
      if (!target) return { canceled: true };
      return { canceled: false, path: services.exportBackup(backupPath, target) };
    }),
    [IPC.backupsImport]: define(null, async () => {
      const selected = await host.pickBackupFile();
      if (!selected) return { canceled: true };
      const backup = services.importBackup(selected);
      return { canceled: false, backup };
    }),
    [IPC.backupsReveal]: define(null, () => openDataFolder(services.paths.backups)),

    /* ---------------------------------- Divers ------------------------------- */
    [IPC.printPdf]: define(IdSchema, async ({ id }) => {
      const invoice = services.getInvoice(id);
      const filePath = services.pdfFilePath(id);
      const result = await host.printPdf(filePath);
      return { ...result, invoiceNumber: invoice.number };
    }),
  };

  return handlers;
}

/** Exécute un canal et renvoie une enveloppe IPC sérialisable. */
export async function dispatchIpc(
  handlers: HandlerMap,
  channel: IpcChannel,
  raw: unknown,
  logger: HandlerLogger,
): Promise<IpcEnvelope<unknown>> {
  const handler = handlers[channel];
  if (!handler) {
    logger.warn(`Canal IPC inconnu : ${channel}`);
    return { ok: false, error: { message: 'Canal inconnu.', code: 'UNKNOWN_CHANNEL' } };
  }
  try {
    const data = await handler(raw);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        error: {
          message: 'Certaines données sont invalides. Vérifiez le formulaire.',
          code: 'VALIDATION',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      };
    }
    if (error instanceof AppError) {
      return { ok: false, error: { message: error.message, code: error.code, details: error.details } };
    }
    const message = error instanceof Error ? error.message : 'Erreur inconnue.';
    logger.error(`Erreur IPC sur ${channel}`, error);
    // On ne masque jamais l'erreur réelle : le message est remonté tel quel.
    return { ok: false, error: { message, code: 'INTERNAL' } };
  }
}
