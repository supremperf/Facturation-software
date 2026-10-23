import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { silentLogger } from '../src/main/infra/logger';
import { createIpcHandlers, dispatchIpc, type IpcHost } from '../src/main/ipc/handlers';
import { IPC, type IpcChannel } from '@shared/ipc';
import { createTestServices, completeSettings, proClient, draftFor, type TestContext } from './fixtures';

const host: IpcHost = {
  saveFile: async (fileName) => path.join('/tmp', fileName),
  pickBackupFile: async () => null,
  openPath: async () => '',
  openUrl: async () => undefined,
  printPdf: async () => ({ printed: false, opened: true }),
  notifyDataRestored: () => undefined,
};

describe('couche IPC', () => {
  let ctx: TestContext;
  let channels: IpcChannel[];
  let invoke: (channel: IpcChannel, payload?: unknown) => ReturnType<typeof dispatchIpc>;

  beforeEach(async () => {
    ctx = await createTestServices({ settings: completeSettings() });
    const handlers = createIpcHandlers(ctx.services, host, silentLogger);
    channels = Object.values(IPC) as IpcChannel[];
    invoke = (channel, payload) => dispatchIpc(handlers, channel, payload, silentLogger);
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it('couvre tous les canaux déclarés', () => {
    expect(channels.length).toBeGreaterThan(30);
    expect(new Set(channels).size).toBe(channels.length);
  });

  it('refuse un canal inconnu sans lever d’exception', async () => {
    const handlers = createIpcHandlers(ctx.services, host, silentLogger);
    const response = await dispatchIpc(handlers, 'inconnu:canal' as IpcChannel, null, silentLogger);
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.error.code).toBe('UNKNOWN_CHANNEL');
  });

  it('valide les entrées avec zod avant d’atteindre les services', async () => {
    const response = await invoke(IPC.clientsCreate, { type: 'particulier' });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('VALIDATION');
      expect(Array.isArray(response.error.details)).toBe(true);
    }
  });

  it('émet une facture via le canal IPC et archive un PDF lisible', async () => {
    const settings = ctx.services.getSettings();
    const client = ctx.services.createClient(proClient());
    const draft = ctx.services.saveDraft(draftFor(client.id, settings.business.address));
    const issued = await invoke(IPC.invoicesIssue, { id: draft.id });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const { invoice, pdfWarning } = issued.data as { invoice: { pdf: { path: string } | null }; pdfWarning?: string };
    expect(pdfWarning).toBeFalsy();
    expect(invoice.pdf?.path).toBeTruthy();
    expect(fs.existsSync(path.join(ctx.dir, invoice.pdf!.path))).toBe(true);
  });

  it('préserve le code métier des règles de gestion', async () => {
    // Une erreur de règle métier levée par la couche base de données doit
    // remonter avec un code exploitable, pas « INTERNAL ».
    const client = ctx.services.createClient(proClient());
    const draft = ctx.services.saveDraft(draftFor(client.id, client.address));
    const issued = await ctx.services.issueInvoice(draft.id);
    const update = await invoke(IPC.invoicesUpdateDraft, {
      id: issued.invoice.id,
      ...draftFor(client.id, client.address),
    });
    expect(update.ok).toBe(false);
    if (!update.ok) expect(update.error.code).toBe('IMMUTABLE');
    const remove = await invoke(IPC.invoicesDeleteDraft, { id: issued.invoice.id });
    expect(remove.ok).toBe(false);
    if (!remove.ok) expect(remove.error.code).toBe('IMMUTABLE');
  });

  it('renvoie une enveloppe d’erreur métier sans fuite de pile', async () => {
    const response = await invoke(IPC.invoicesGet, { id: 'inexistant' });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.error.code).toBe('NOT_FOUND');
      expect(JSON.stringify(response)).not.toContain('at ');
    }
  });
});
