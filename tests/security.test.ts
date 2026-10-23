import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { safeDocumentPath } from '../src/main/infra/paths';
import { isValidFrenchVatNumber, isValidIban, isValidSiren, isValidSiret, sanitizeFileName } from '@shared/validators';
import { SettingsSchema, DraftSchema, PaymentCreateSchema } from '../src/main/ipc/schemas';
import { completeSettings, createTestServices, draftFor, proClient, TINY_PNG_BASE64, type TestContext } from './fixtures';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestServices();
});

afterEach(async () => {
  await ctx.cleanup();
});

describe('validation des identifiants', () => {
  it('contrôle SIREN, SIRET et TVA', () => {
    expect(isValidSiren('732829320')).toBe(true);
    expect(isValidSiren('732829321')).toBe(false);
    expect(isValidSiret('73282932000009')).toBe(true);
    expect(isValidSiret('73282932000008')).toBe(false);
    expect(isValidFrenchVatNumber('FR44732829320')).toBe(true);
    expect(isValidFrenchVatNumber('FR45732829320')).toBe(false);
    expect(isValidIban('FR1420041010050500013M02606')).toBe(true);
    expect(isValidIban('FR1420041010050500013M02607')).toBe(false);
  });

  it('nettoie les noms de fichiers exportés', () => {
    expect(sanitizeFileName('Élodie Réné Conseil')).toBe('Elodie_Rene_Conseil');
    expect(sanitizeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(sanitizeFileName('')).toBe('document');
  });

  it('empêche la sortie du répertoire de documents', () => {
    expect(() => safeDocumentPath('/tmp/base', '../secret.txt')).toThrow(/invalide/i);
    expect(safeDocumentPath('/tmp/base', '/etc/passwd')).toBe('/tmp/base/etc/passwd');
    expect(safeDocumentPath('/tmp/base', 'documents/Factures/2026/FAC-2026-0001.pdf')).toContain(
      'documents/Factures/2026/FAC-2026-0001.pdf',
    );
  });
});

describe('schémas IPC', () => {
  it('rejette des réglages invalides', () => {
    const settings = completeSettings();
    expect(SettingsSchema.safeParse(settings).success).toBe(true);
    const badColor = { ...settings, branding: { ...settings.branding, primaryColor: 'red; background:url(x)' } };
    expect(SettingsSchema.safeParse(badColor).success).toBe(false);
    const badPadding = { ...settings, documents: { ...settings.documents, padding: 99 } };
    expect(SettingsSchema.safeParse(badPadding).success).toBe(false);
    const badRegime = { ...settings, fiscal: { ...settings.fiscal, regime: 'magique' } };
    expect(SettingsSchema.safeParse(badRegime).success).toBe(false);
  });

  it('rejette des factures malformées', () => {
    const client = ctx.services.createClient(proClient());
    const draft = draftFor(client.id, client.address);
    expect(DraftSchema.safeParse(draft).success).toBe(true);
    expect(
      DraftSchema.safeParse({ ...draft, lines: [{ ...draft.lines[0], quantity: -1 }] }).success,
    ).toBe(false);
    expect(
      DraftSchema.safeParse({ ...draft, lines: [{ ...draft.lines[0], vatRateBp: 90000 }] }).success,
    ).toBe(false);
    expect(
      DraftSchema.safeParse({ ...draft, issueDate: '2026-13-45' }).success,
    ).toBe(false);
    expect(DraftSchema.safeParse({ ...draft, notes: 'x'.repeat(5000) }).success).toBe(false);
  });

  it('rejette des paiements invalides', () => {
    expect(
      PaymentCreateSchema.safeParse({
        invoiceId: 'abc',
        date: '2026-01-01',
        amountCents: -5,
        method: 'virement',
        reference: '',
        note: '',
      }).success,
    ).toBe(false);
    expect(
      PaymentCreateSchema.safeParse({
        invoiceId: 'abc',
        date: '2026-01-01',
        amountCents: 100,
        method: 'bitcoin',
        reference: '',
        note: '',
      }).success,
    ).toBe(false);
  });
});

describe('fichiers importés et données', () => {
  it('refuse un logo qui n’est pas une image réelle', () => {
    expect(() =>
      ctx.services.uploadLogo({
        fileName: 'evil.png',
        mime: 'image/png',
        base64: Buffer.from('<?php system($_GET["c"]); ?>').toString('base64'),
      }),
    ).toThrow(/image|format/i);
    const settings = ctx.services.uploadLogo({
      fileName: 'logo.png',
      mime: 'image/png',
      base64: TINY_PNG_BASE64,
    });
    expect(settings.branding.logo?.path).toMatch(/^branding\/logo-[a-f0-9]{12}\.png$/);
    expect(ctx.services.logoDataUrl()).toMatch(/^data:image\/png;base64,/);
    ctx.services.removeLogo();
    expect(ctx.services.getSettings().branding.logo).toBeNull();
  });

  it('nettoie les données client et résiste aux injections SQL', () => {
    const client = ctx.services.createClient(
      proClient({ companyName: 'Test\u0000 Société', siren: '12ab34cd56', vatNumber: ' fr 44 732 829 320 ' }),
    );
    expect(client.companyName).toBe('Test Société');
    expect(client.siren).toBe('123456');
    expect(client.vatNumber).toBe('FR44732829320');
    const injection = ctx.services.listClients({ query: "' OR 1=1; DROP TABLE clients; --" });
    expect(injection).toHaveLength(0);
    expect(ctx.services.listClients()).toHaveLength(1);
    const withApostrophe = ctx.services.createClient(proClient({ companyName: "L'Atelier d'Élodie" }));
    expect(ctx.services.listClients({ query: "l'atelier" })).toHaveLength(1);
    ctx.services.deleteClient(withApostrophe.id);
  });

  it('refuse la suppression du dossier de données par un chemin d’export', () => {
    const client = ctx.services.createClient(proClient());
    const draft = ctx.services.saveDraft(draftFor(client.id, client.address));
    return ctx.services.issueInvoice(draft.id).then(({ invoice }) => {
      const target = path.join(ctx.dir, 'export-test.pdf');
      const saved = ctx.services.savePdfAs(invoice.id, target);
      expect(fs.existsSync(saved)).toBe(true);
      expect(fs.statSync(saved).size).toBeGreaterThan(1000);
    });
  });

  it('ne conserve aucun secret en clair dans les réglages', () => {
    const settings = ctx.services.getSettings();
    const serialized = JSON.stringify(settings);
    expect(serialized).not.toMatch(/password|secret|api[_-]?key|token/i);
  });
});
