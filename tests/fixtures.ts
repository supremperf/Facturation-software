import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { AppSettings, ClientInput, InvoiceDraftInput } from '@shared/types';
import { createDefaultSettings, DEFAULT_FRANCHISE_MENTION, emptyAddress } from '@shared/constants';
import { addDays, todayISO } from '@shared/dates';
import { AppServices } from '../src/main/services/app-services';
import { silentLogger, type Logger } from '../src/main/infra/logger';

const ROOT = path.resolve(__dirname, '..');

export function completeSettings(): AppSettings {
  const settings = createDefaultSettings();
  settings.identity = {
    civility: 'Mme',
    firstName: 'Camille',
    lastName: 'Laurent',
    phone: '+33 6 12 34 56 78',
    email: 'contact@atelier-lumen.fr',
    website: 'https://atelier-lumen.fr',
  };
  settings.business = {
    tradeName: 'Atelier Lumen',
    legalName: 'Atelier Lumen SAS',
    legalForm: 'SAS',
    legalStatus: 'Société commerciale',
    siren: '732829320',
    siret: '73282932000009',
    rcs: 'RCS Paris 732 829 320',
    rcsApplicable: true,
    rm: '',
    rmApplicable: false,
    capitalCents: 500_000,
    ape: '6201Z',
    activity: 'Conception de logiciels',
    address: {
      line1: '12 rue des Lilas',
      line2: 'Bâtiment B',
      postalCode: '75011',
      city: 'Paris',
      country: 'France',
    },
    vatNumber: 'FR44732829320',
  };
  settings.bank = {
    bankName: 'Banque Exemple',
    accountHolder: 'Atelier Lumen SAS',
    iban: 'FR1420041010050500013M02606',
    bic: 'BNPAFRPPXXX',
    paymentInstructions: 'Merci d’indiquer le numéro de facture en référence.',
  };
  settings.fiscal = {
    regime: 'normal',
    vatRates: [2000, 1000, 550],
    franchiseMention: DEFAULT_FRANCHISE_MENTION,
    exemptionReason: '',
    debitsOption: false,
    fiscalRegime: 'BIC — régime réel normal',
  };
  settings.documents = {
    ...settings.documents,
    defaultTermsDays: 30,
    defaultPaymentMethod: 'virement',
    defaultVatRateBp: 2000,
    defaultUnit: 'jour',
    startNumber: 1,
  };
  settings.legal = {
    ...settings.legal,
    latePenaltyRateBp: 1000,
    recoveryIndemnity: true,
    escompte: 'Aucun escompte accordé pour paiement anticipé.',
    eInvoicingPhase: 'pme',
    enforceSirenForProClients: true,
  };
  settings.setupCompleted = true;
  settings.branding.primaryColor = '#6D5CF6';
  return settings;
}

export function proClient(overrides: Partial<ClientInput> = {}): ClientInput {
  return {
    type: 'professionnel',
    civility: '',
    firstName: 'Julien',
    lastName: 'Martin',
    companyName: 'Société Martin',
    legalForm: 'SARL',
    siren: '443061841',
    siret: '44306184100005',
    vatNumber: 'FR64443061841',
    vatSubject: true,
    email: 'compta@societe-martin.fr',
    phone: '01 44 55 66 77',
    address: {
      line1: '25 avenue de la République',
      line2: '',
      postalCode: '69003',
      city: 'Lyon',
      country: 'France',
    },
    deliveryAddress: null,
    notes: '',
    ...overrides,
  };
}

export function consumerClient(overrides: Partial<ClientInput> = {}): ClientInput {
  return {
    type: 'particulier',
    civility: 'M.',
    firstName: 'Paul',
    lastName: 'Durand',
    companyName: '',
    legalForm: '',
    siren: '',
    siret: '',
    vatNumber: '',
    vatSubject: false,
    email: 'paul.durand@example.fr',
    phone: '06 00 00 00 00',
    address: {
      line1: '8 rue du Marché',
      line2: '',
      postalCode: '44000',
      city: 'Nantes',
      country: 'France',
    },
    deliveryAddress: null,
    notes: '',
    ...overrides,
  };
}

export function draftFor(clientId: string, address: ClientInput['address'], overrides: Partial<InvoiceDraftInput> = {}): InvoiceDraftInput {
  const today = todayISO();
  return {
    clientId,
    issueDate: today,
    dueDate: addDays(today, 30),
    serviceDate: today,
    billingAddress: address,
    deliveryAddress: null,
    purchaseOrder: '',
    operationNature: 'services',
    description: 'Prestation réalisée selon devis accepté.',
    paymentTerms: 'Paiement à 30 jours date de facture.',
    paymentMethod: 'virement',
    notes: '',
    lines: [
      {
        designation: 'Développement application web',
        description: 'Réalisation du module de facturation',
        reference: 'DEV-2026',
        quantity: 2,
        unit: 'jour',
        unitPriceCents: 50_000,
        discountType: 'none',
        discountValue: 0,
        vatRateBp: 2000,
        isExtraFee: false,
        operationNature: 'services',
      },
    ],
    globalDiscountType: 'none',
    globalDiscountValue: 0,
    ...overrides,
  };
}

export interface TestContext {
  services: AppServices;
  dir: string;
  cleanup: () => Promise<void>;
}

export async function createTestServices(
  options: { settings?: AppSettings | null; logger?: Logger } = {},
): Promise<TestContext> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'facturepro-test-'));
  const services = await AppServices.create({
    baseDir: dir,
    wasmPath: path.join(ROOT, 'node_modules/sql.js/dist/sql-wasm.wasm'),
    fontsDir: path.join(ROOT, 'node_modules/dejavu-fonts-ttf/ttf'),
    appVersion: '0.0.0-test',
    logger: options.logger ?? silentLogger,
  });
  if (options.settings !== null) {
    services.saveSettings(options.settings ?? completeSettings());
  }
  return {
    services,
    dir,
    cleanup: async () => {
      try {
        await services.dispose();
      } catch {
        /* déjà fermé */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** PNG 1×1 valide (utilisé pour tester l'intégration du logo). */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

export function addressFor(client: ClientInput) {
  return client.address ?? emptyAddress();
}
