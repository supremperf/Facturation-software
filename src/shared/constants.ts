import type {
  AppSettings,
  Client,
  ClientSnapshot,
  EffectiveStatus,
  EInvoicingPhase,
  Invoice,
  InvoiceStatus,
  OperationNature,
  PaymentMethod,
  VatRegime,
} from './types';
import { daysBetween } from './dates';

export const APP_NAME = 'FacturePro';
export const APP_ID = 'fr.facturepro.app';
export const RULES_VERSION = 'FR-2026.10';

export const STATUS_META: Record<
  EffectiveStatus,
  { label: string; color: string; background: string; description: string }
> = {
  draft: {
    label: 'Brouillon',
    color: '#94a3b8',
    background: 'rgba(148, 163, 184, 0.14)',
    description: 'Document non émis, modifiable librement.',
  },
  issued: {
    label: 'Émise',
    color: '#60a5fa',
    background: 'rgba(59, 130, 246, 0.14)',
    description: 'Facture émise, en attente de règlement.',
  },
  sent: {
    label: 'Envoyée',
    color: '#a78bfa',
    background: 'rgba(139, 92, 246, 0.14)',
    description: 'Facture transmise au client.',
  },
  partial: {
    label: 'Partiellement payée',
    color: '#fbbf24',
    background: 'rgba(245, 158, 11, 0.14)',
    description: 'Un règlement partiel a été enregistré.',
  },
  paid: {
    label: 'Payée',
    color: '#34d399',
    background: 'rgba(16, 185, 129, 0.14)',
    description: 'Solde intégralement réglé.',
  },
  overdue: {
    label: 'En retard',
    color: '#f87171',
    background: 'rgba(239, 68, 68, 0.14)',
    description: "Échéance dépassée, solde restant dû.",
  },
  cancelled: {
    label: 'Annulée',
    color: '#64748b',
    background: 'rgba(100, 116, 139, 0.14)',
    description: 'Document annulé, conservé pour la traçabilité.',
  },
};

export const INVOICE_STATUS_ORDER: InvoiceStatus[] = [
  'draft',
  'issued',
  'sent',
  'partial',
  'paid',
  'cancelled',
];

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'virement', label: 'Virement bancaire' },
  { value: 'carte', label: 'Carte bancaire' },
  { value: 'especes', label: 'Espèces' },
  { value: 'cheque', label: 'Chèque' },
  { value: 'autre', label: 'Autre' },
];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label]),
) as Record<PaymentMethod, string>;

export const VAT_REGIME_LABEL: Record<Exclude<VatRegime, null>, string> = {
  normal: 'Assujetti à la TVA',
  franchise: 'Franchise en base de TVA',
  exemption: "Exonération de TVA",
};

export const OPERATION_NATURE_LABEL: Record<OperationNature, string> = {
  goods: 'Livraison de biens',
  services: 'Prestation de services',
  mixed: 'Biens et services',
};

export const E_INVOICING_PHASE_LABEL: Record<EInvoicingPhase, string> = {
  unspecified: 'Non renseigné',
  ge_eti: 'Grande entreprise / ETI',
  pme: 'PME / TPE / micro-entreprise',
  not_concerned: 'Non concerné (non assujetti ou hors champ)',
};

export const E_INVOICING_PHASE_START: Record<EInvoicingPhase, string | null> = {
  unspecified: null,
  ge_eti: '2026-09-01',
  pme: '2027-09-01',
  not_concerned: null,
};

export const UNITS = [
  'unité',
  'heure',
  'jour',
  'demi-journée',
  'forfait',
  'prestation',
  'lot',
  'mois',
  'kg',
  'litre',
  'mètre',
  'm²',
  'm³',
  'km',
];

export const LEGAL_FORMS = [
  'Entreprise individuelle (EI)',
  'Micro-entreprise',
  'EURL',
  'SARL',
  'SASU',
  'SAS',
  'SA',
  'SNC',
  'SCI',
  'SELARL',
  'SELAS',
  'SCP',
  'Association',
  'Autre',
];

export const LEGAL_STATUSES = [
  'Artisan',
  'Commerçant',
  'Profession libérale',
  'Auto-entrepreneur / micro-entrepreneur',
  'Société commerciale',
  'Société civile',
  'Association',
  'Autre',
];

const COMPANY_FORMS_REQUIRING_CAPITAL = new Set([
  'EURL',
  'SARL',
  'SASU',
  'SAS',
  'SA',
  'SNC',
  'SCI',
  'SELARL',
  'SELAS',
  'SCP',
]);

export function requiresCapital(legalForm: string): boolean {
  return COMPANY_FORMS_REQUIRING_CAPITAL.has((legalForm || '').trim());
}

export function requiresRcs(legalForm: string): boolean {
  return COMPANY_FORMS_REQUIRING_CAPITAL.has((legalForm || '').trim());
}

export const VAT_RATE_PRESETS = [2000, 1000, 550, 210, 0];

export const FRANCHISE_MENTION_PRESETS = [
  {
    id: 'cibs-223-3',
    label: 'CIBS, art. L. 223-3 (recommandation impots.gouv.fr)',
    text: 'TVA non applicable, art. L. 223-3 du code des impositions sur les biens et services (CIBS).',
  },
  {
    id: 'cibs-223',
    label: 'CIBS, art. L. 223 et suivants',
    text: 'TVA non applicable, art. L. 223 et s. du code des impositions sur les biens et services (CIBS).',
  },
  {
    id: 'cgi-293b',
    label: 'CGI, art. 293 B (mention admise jusqu’au 31/12/2027)',
    text: 'TVA non applicable, art. 293 B du code général des impôts.',
  },
];

export const DEFAULT_CONSUMER_MENTION =
  "Le consommateur bénéficie de la garantie légale de conformité dans les conditions prévues aux articles L. 217-3 et suivants du code de la consommation (durée de deux ans à compter de la délivrance du bien). Cette garantie légale s'applique indépendamment de toute garantie commerciale éventuelle.";

export const DEFAULT_FRANCHISE_MENTION = FRANCHISE_MENTION_PRESETS[0].text;

export const COUNTRIES = [
  'France',
  'Belgique',
  'Luxembourg',
  'Suisse',
  'Allemagne',
  'Espagne',
  'Italie',
  'Pays-Bas',
  'Portugal',
  'Royaume-Uni',
  'Monaco',
  'Andorre',
  'Autre',
];

export function emptyAddress(country = 'France') {
  return { line1: '', line2: '', postalCode: '', city: '', country };
}

export function createDefaultSettings(): AppSettings {
  return {
    identity: {
      civility: '',
      firstName: '',
      lastName: '',
      phone: '',
      email: '',
      website: '',
    },
    business: {
      tradeName: '',
      legalName: '',
      legalForm: '',
      legalStatus: '',
      siren: '',
      siret: '',
      rcs: '',
      rcsApplicable: false,
      rm: '',
      rmApplicable: false,
      capitalCents: null,
      ape: '',
      activity: '',
      address: emptyAddress(),
      vatNumber: '',
    },
    bank: {
      bankName: '',
      accountHolder: '',
      iban: '',
      bic: '',
      paymentInstructions: '',
    },
    fiscal: {
      regime: null,
      vatRates: [2000, 1000, 550, 210],
      franchiseMention: DEFAULT_FRANCHISE_MENTION,
      exemptionReason: '',
      debitsOption: false,
      fiscalRegime: '',
    },
    branding: {
      logo: null,
      primaryColor: '#6D5CF6',
      secondaryColor: '#0F172A',
      showLogo: true,
    },
    documents: {
      invoicePrefix: 'FAC',
      creditPrefix: 'AV',
      padding: 4,
      resetYearly: true,
      startNumber: null,
      pdfTemplate: 'modern',
      defaultTermsDays: null,
      defaultPaymentMethod: 'virement',
      defaultVatRateBp: null,
      defaultUnit: 'unité',
    },
    legal: {
      latePenaltyRateBp: null,
      recoveryIndemnity: true,
      escompte: '',
      mediatorName: '',
      mediatorAddress: '',
      mediatorUrl: '',
      consumerGoodsMention: DEFAULT_CONSUMER_MENTION,
      enforceSirenForProClients: true,
      eInvoicingPhase: 'unspecified',
      eInvoicingPartner: '',
    },
    setupCompleted: false,
    updatedAt: null,
  };
}

export function companyDisplayName(settings: AppSettings): string {
  const { tradeName, legalName } = settings.business;
  const person = [settings.identity.firstName, settings.identity.lastName].filter(Boolean).join(' ');
  return tradeName || legalName || person || '';
}

export function clientDisplayName(client: Pick<Client, 'type' | 'companyName' | 'firstName' | 'lastName'> | ClientSnapshot): string {
  if (client.type === 'professionnel') {
    if (client.companyName) return client.companyName;
  }
  const person = [client.firstName, client.lastName].filter(Boolean).join(' ').trim();
  if (person) return client.companyName ? `${client.companyName} — ${person}` : person;
  return client.companyName || 'Client sans nom';
}

export function clientSnapshotFromClient(client: Client): ClientSnapshot {
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

/** Statut effectif : une facture émise non soldée et échue est « en retard ». */
export function computeEffectiveStatus(
  invoice: Pick<Invoice, 'type' | 'status' | 'dueDate' | 'balanceCents'>,
  today: string,
): EffectiveStatus {
  if (invoice.status === 'draft' || invoice.status === 'cancelled') return invoice.status;
  if (invoice.type === 'credit_note') return invoice.status === 'paid' ? 'paid' : 'issued';
  if (invoice.balanceCents <= 0) return 'paid';
  if (invoice.status === 'paid') return 'paid';
  if (invoice.dueDate < today) return 'overdue';
  if (invoice.status === 'partial') return 'partial';
  if (invoice.status === 'sent') return 'sent';
  return 'issued';
}

export function invoiceDelayDays(dueDate: string, today: string): number {
  return daysBetween(dueDate, today);
}

export function formatAddressLines(address: {
  line1?: string;
  line2?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}): string[] {
  const cityLine = [address.postalCode, address.city].filter(Boolean).join(' ');
  return [address.line1, address.line2, cityLine, address.country]
    .map((line) => (line ?? '').trim())
    .filter(Boolean);
}

export const SIDEBAR_SECTIONS = [
  {
    id: 'general',
    label: 'Général',
    items: [{ to: '/', label: 'Tableau de bord', icon: 'dashboard' }],
  },
  {
    id: 'gestion',
    label: 'Gestion',
    items: [
      { to: '/factures', label: 'Factures', icon: 'invoices' },
      { to: '/factures/nouvelle', label: 'Créer une facture', icon: 'create' },
      { to: '/avoirs', label: 'Avoirs', icon: 'credit' },
      { to: '/clients', label: 'Clients', icon: 'clients' },
      { to: '/paiements', label: 'Paiements', icon: 'payments' },
    ],
  },
  {
    id: 'analyse',
    label: 'Analyse',
    items: [
      { to: '/statistiques', label: 'Statistiques', icon: 'stats' },
      { to: '/rapports', label: 'Rapports', icon: 'reports' },
    ],
  },
  {
    id: 'configuration',
    label: 'Configuration',
    items: [
      { to: '/parametres', label: 'Paramètres', icon: 'settings' },
      { to: '/parametres/entreprise', label: "Identité de l'entreprise", icon: 'company' },
      { to: '/sauvegardes', label: 'Sauvegardes', icon: 'backup' },
    ],
  },
] as const;

export type NavItem = (typeof SIDEBAR_SECTIONS)[number]['items'][number];
