import fs from 'node:fs';
import path from 'node:path';
import type { IpcChannel, IpcEnvelope } from '@shared/ipc';
import type { Invoice } from '@shared/types';
import { addDays, todayISO } from '@shared/dates';
import { createLogger, silentLogger } from '../src/main/infra/logger';
import { createIpcHandlers, dispatchIpc, type IpcHost } from '../src/main/ipc/handlers';
import { createTestServices, completeSettings, proClient, consumerClient, draftFor, type TestContext } from './fixtures';

export interface UiHarness {
  ctx: TestContext;
  issuedInvoice: Invoice;
  draftInvoice: Invoice;
  outDir: string;
  invoke<T = unknown>(channel: string, payload?: unknown): Promise<IpcEnvelope<T>>;
  teardown(): Promise<void>;
}

/**
 * Prépare un vrai backend (SQLite sur disque, PDF DejaVu) branché sur la
 * couche IPC réelle, puis expose `window.facturepro` comme le fait le preload.
 * Aucune donnée n'est simulée : seuls les dialogues natifs sont remplacés.
 */
export async function setupUiHarness(): Promise<UiHarness> {
  const ctx = await createTestServices({ logger: createLogger(null, 'ui-test') });
  const services = ctx.services;
  services.saveSettings(completeSettings());

  const outDir = path.join(ctx.dir, 'exports');
  fs.mkdirSync(outDir, { recursive: true });

  const host: IpcHost = {
    saveFile: async (fileName) => path.join(outDir, fileName),
    pickBackupFile: async () => null,
    openPath: async () => '',
    openUrl: async () => undefined,
    printPdf: async () => ({ printed: false, opened: true }),
    notifyDataRestored: () => undefined,
  };
  const handlers = createIpcHandlers(services, host, silentLogger);

  const invoke = async <T = unknown>(channel: string, payload?: unknown): Promise<IpcEnvelope<T>> =>
    (await dispatchIpc(handlers, channel as IpcChannel, payload, silentLogger)) as IpcEnvelope<T>;

  const today = todayISO();
  const pro = services.createClient(proClient());
  const consumer = services.createClient(consumerClient());

  const first = services.saveDraft(
    draftFor(pro.id, pro.address, {
      issueDate: addDays(today, -150),
      dueDate: addDays(today, -120),
    }),
  );
  const issuedInvoice = (await services.issueInvoice(first.id)).invoice;

  const second = services.saveDraft(
    draftFor(consumer.id, consumer.address, {
      issueDate: addDays(today, -45),
      dueDate: addDays(today, -15),
      lines: [
        {
          designation: 'Audit de facturation',
          description: 'Analyse du processus et recommandations',
          reference: '',
          quantity: 1,
          unit: 'forfait',
          unitPriceCents: 120_000,
          discountType: 'percent',
          discountValue: 500,
          vatRateBp: 2000,
          isExtraFee: false,
          operationNature: 'services',
        },
      ],
    }),
  );
  const secondInvoice = (await services.issueInvoice(second.id)).invoice;
  services.addPayment({
    invoiceId: secondInvoice.id,
    date: addDays(today, -10),
    amountCents: 60_000,
    method: 'virement',
    reference: 'VIR-2026-001',
    note: '',
  });

  const third = services.saveDraft(
    draftFor(pro.id, pro.address, {
      issueDate: addDays(today, -5),
      dueDate: addDays(today, 25),
    }),
  );
  await services.issueInvoice(third.id);

  const draftInvoice = services.saveDraft(draftFor(consumer.id, consumer.address));

  return {
    ctx,
    issuedInvoice: services.getInvoice(issuedInvoice.id)!,
    draftInvoice,
    outDir,
    invoke,
    teardown: ctx.cleanup,
  };
}

export function installBrowserBridge(invoke: UiHarness['invoke']): void {
  window.facturepro = {
    invoke: (channel: string, payload?: unknown) => invoke(channel, payload),
    on: () => () => undefined,
    platform: 'test',
    versions: { electron: 'test', chrome: 'test', node: 'test' },
  };
}

export function installDomStubs(): void {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
  Object.defineProperty(window, 'scrollTo', { writable: true, value: () => undefined });
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }
}
