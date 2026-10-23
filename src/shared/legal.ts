import type {
  Address,
  AppSettings,
  ClientSnapshot,
  ClientType,
  ComplianceCheck,
  ComplianceReport,
  DocumentType,
  EInvoicingPhase,
  InvoiceLineInput,
  InvoiceTotals,
  LegalSnapshot,
  OperationNature,
  SellerSnapshot,
} from './types';
import {
  DEFAULT_CONSUMER_MENTION,
  E_INVOICING_PHASE_LABEL,
  E_INVOICING_PHASE_START,
  RULES_VERSION,
  STATUS_META,
  companyDisplayName,
  requiresCapital,
  requiresRcs,
} from './constants';
import { computeInvoiceTotals, formatEuros } from './money';
import { formatDateFR, nowISO, todayISO } from './dates';
import { isValidEmail, isValidFrenchVatNumber, isValidIban, isValidSiren, isValidSiret, isValidVatNumber } from './validators';

/* ------------------------------------------------------------------ */
/* Instantanés                                                         */
/* ------------------------------------------------------------------ */

export function buildSellerSnapshot(settings: AppSettings): SellerSnapshot {
  const { identity, business, bank, branding } = settings;
  return {
    displayName: companyDisplayName(settings),
    tradeName: business.tradeName,
    legalName: business.legalName,
    legalForm: business.legalForm,
    legalStatus: business.legalStatus,
    capitalCents: business.capitalCents,
    siren: business.siren,
    siret: business.siret,
    rcs: business.rcs,
    rm: business.rm,
    ape: business.ape,
    vatNumber: business.vatNumber,
    address: business.address,
    phone: identity.phone,
    email: identity.email,
    website: identity.website,
    bank: {
      bankName: bank.bankName,
      accountHolder: bank.accountHolder,
      iban: bank.iban,
      bic: bank.bic,
      paymentInstructions: bank.paymentInstructions,
    },
    logoPath: branding.logo?.path ?? null,
    primaryColor: branding.primaryColor,
    secondaryColor: branding.secondaryColor,
  };
}

export function buildLegalSnapshot(settings: AppSettings): LegalSnapshot {
  const { fiscal, legal } = settings;
  return {
    vatRegime: fiscal.regime,
    franchiseMention: fiscal.franchiseMention,
    exemptionReason: fiscal.exemptionReason,
    debitsOption: fiscal.debitsOption,
    latePenaltyRateBp: legal.latePenaltyRateBp,
    recoveryIndemnity: legal.recoveryIndemnity,
    escompte: legal.escompte,
    mediatorName: legal.mediatorName,
    mediatorUrl: legal.mediatorUrl,
    consumerGoodsMention: legal.consumerGoodsMention,
    invoiceFooter: '',
    eInvoicingPhase: legal.eInvoicingPhase,
    rulesVersion: RULES_VERSION,
  };
}

/* ------------------------------------------------------------------ */
/* Document soumis au contrôle                                         */
/* ------------------------------------------------------------------ */

export interface ComplianceLine {
  designation: string;
  description?: string;
  reference?: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  discountType: 'none' | 'percent' | 'amount';
  discountValue: number;
  vatRateBp: number;
  isExtraFee?: boolean;
}

export interface ComplianceDocument {
  type: DocumentType;
  number: string | null;
  status?: string;
  issueDate: string;
  dueDate: string;
  serviceDate: string;
  clientSnapshot: ClientSnapshot;
  billingAddress: Address;
  deliveryAddress: Address | null;
  purchaseOrder: string;
  operationNature: OperationNature;
  description: string;
  paymentTerms: string;
  paymentMethod: string;
  notes: string;
  lines: ComplianceLine[];
  globalDiscountType: 'none' | 'percent' | 'amount';
  globalDiscountValue: number;
  totals: InvoiceTotals;
  sourceInvoiceNumber?: string | null;
  reason?: string;
}

export interface ComplianceInput {
  settings: AppSettings;
  document: ComplianceDocument;
  today?: string;
  /** Le numéro est-il déjà attribué ? (faux lors de la pré-vérification d'un brouillon) */
  numberAssigned?: boolean;
  numberUnique?: boolean;
  /** Avoir : total déjà crédité sur la facture d'origine. */
  creditNoteContext?: { sourceTotalCents: number; alreadyCreditedCents: number } | null;
}

const EU_COUNTRIES = new Set([
  'france',
  'fr',
  'belgique',
  'belgium',
  'be',
  'luxembourg',
  'lu',
  'allemagne',
  'germany',
  'de',
  'espagne',
  'spain',
  'es',
  'italie',
  'italy',
  'it',
  'pays-bas',
  'netherlands',
  'nl',
  'portugal',
  'pt',
  'irlande',
  'ie',
  'autriche',
  'at',
  'suède',
  'se',
  'danemark',
  'dk',
  'finlande',
  'fi',
  'pologne',
  'pl',
  'grèce',
  'el',
  'gr',
  'tchéquie',
  'cz',
  'roumanie',
  'ro',
  'hongrie',
  'hu',
  'bulgarie',
  'bg',
  'croatie',
  'hr',
  'slovaquie',
  'sk',
  'slovénie',
  'si',
  'estonie',
  'ee',
  'lettonie',
  'lv',
  'lituanie',
  'lt',
  'malte',
  'mt',
  'chypre',
  'cy',
]);

export function isFrance(country: string | null | undefined): boolean {
  const value = (country ?? '').trim().toLowerCase();
  return value === 'france' || value === 'fr' || value === 'france métropolitaine';
}

export function isEuropeanUnion(country: string | null | undefined): boolean {
  return EU_COUNTRIES.has((country ?? '').trim().toLowerCase());
}

export function isAddressComplete(address: Address | null | undefined): boolean {
  if (!address) return false;
  return Boolean(
    address.line1?.trim() &&
      address.postalCode?.trim() &&
      address.city?.trim() &&
      address.country?.trim(),
  );
}

export function hasGoods(nature: OperationNature): boolean {
  return nature === 'goods' || nature === 'mixed';
}

export function getEInvoicingStart(phase: EInvoicingPhase): string | null {
  return E_INVOICING_PHASE_START[phase] ?? null;
}

/* ------------------------------------------------------------------ */
/* Moteur de contrôle de conformité                                    */
/* ------------------------------------------------------------------ */

class CheckBuilder {
  readonly checks: ComplianceCheck[] = [];

  add(
    id: string,
    category: ComplianceCheck['category'],
    label: string,
    status: ComplianceCheck['status'],
    severity: ComplianceCheck['severity'],
    message: string,
    reference?: string,
  ): void {
    this.checks.push({ id, category, label, status, severity, message, reference });
  }

  ok(
    id: string,
    category: ComplianceCheck['category'],
    label: string,
    message: string,
    reference?: string,
  ): void {
    this.add(id, category, label, 'ok', 'info', message, reference);
  }

  blocking(
    id: string,
    category: ComplianceCheck['category'],
    label: string,
    message: string,
    reference?: string,
  ): void {
    this.add(id, category, label, 'missing', 'blocking', message, reference);
  }

  incoherent(
    id: string,
    category: ComplianceCheck['category'],
    label: string,
    message: string,
    reference?: string,
  ): void {
    this.add(id, category, label, 'incoherent', 'blocking', message, reference);
  }

  warning(
    id: string,
    category: ComplianceCheck['category'],
    label: string,
    message: string,
    reference?: string,
  ): void {
    this.add(id, category, label, 'missing', 'warning', message, reference);
  }

  notApplicable(
    id: string,
    category: ComplianceCheck['category'],
    label: string,
    message: string,
    reference?: string,
  ): void {
    this.add(id, category, label, 'not_applicable', 'info', message, reference);
  }
}

export function validateCompliance(input: ComplianceInput): ComplianceReport {
  const { settings, document: doc } = input;
  const today = input.today ?? todayISO();
  const b = new CheckBuilder();
  const { business, identity, fiscal, bank, legal } = settings;
  const client = doc.clientSnapshot;
  const isPro = client.type === 'professionnel';
  const clientInFrance = isFrance(client.address.country);
  const isCreditNote = doc.type === 'credit_note';
  const frGoods = hasGoods(doc.operationNature);

  /* ----------------------- Entreprise (vendeur) ----------------------- */
  const sellerName = companyDisplayName(settings);
  if (sellerName) {
    b.ok('seller.identity', 'company', 'Identité du vendeur', `Vendeur identifié : ${sellerName}.`, 'art. 242 nonies A, 2° ann. II CGI');
  } else {
    b.blocking(
      'seller.identity',
      'company',
      'Identité du vendeur',
      "Renseignez le nom commercial, la dénomination sociale ou votre nom dans Paramètres > Identité de l'entreprise.",
      'art. 242 nonies A, 2° ann. II CGI',
    );
  }

  if (isAddressComplete(business.address)) {
    b.ok('seller.address', 'company', 'Adresse du vendeur', 'Adresse complète du vendeur.', 'art. 242 nonies A, 2° ann. II CGI');
  } else {
    b.blocking(
      'seller.address',
      'company',
      'Adresse du vendeur',
      "L'adresse du vendeur est incomplète (adresse, code postal et ville sont obligatoires).",
      'art. 242 nonies A, 2° ann. II CGI',
    );
  }

  const siren = (business.siren || '').replace(/\s/g, '');
  const siret = (business.siret || '').replace(/\s/g, '');
  if (!siren && !siret) {
    b.blocking(
      'seller.registration',
      'company',
      "Numéro d'immatriculation",
      'Le SIREN (ou SIRET) du vendeur est obligatoire sur la facture.',
      'art. 242 nonies A, 3° ann. II CGI — art. R. 123-221 C. com.',
    );
  } else if (siren && !isValidSiren(siren)) {
    b.incoherent('seller.registration', 'company', "Numéro d'immatriculation", 'Le SIREN saisi est invalide (9 chiffres, clé de contrôle).');
  } else if (!siren && siret && !isValidSiret(siret)) {
    b.incoherent('seller.registration', 'company', "Numéro d'immatriculation", 'Le SIRET saisi est invalide (14 chiffres, clé de contrôle).');
  } else if (siren && siret && !siret.startsWith(siren)) {
    b.incoherent('seller.registration', 'company', "Cohérence SIREN / SIRET", 'Le SIRET ne correspond pas au SIREN renseigné.');
  } else {
    b.ok('seller.registration', 'company', "Numéro d'immatriculation", 'SIREN/SIRET présent et valide.', 'art. 242 nonies A, 3° ann. II CGI');
  }

  if (requiresRcs(business.legalForm) || business.rcsApplicable) {
    if (business.rcs.trim()) {
      b.ok('seller.rcs', 'company', 'Numéro RCS', `RCS : ${business.rcs}.`, 'art. 242 nonies A, 4° ann. II CGI');
    } else {
      b.blocking(
        'seller.rcs',
        'company',
        'Numéro RCS',
        "Votre forme juridique implique une immatriculation au RCS : renseignez le numéro RCS (ex. « RCS Paris 123 456 789 ») ou désactivez l'option si elle ne s'applique pas.",
        'art. 242 nonies A, 4° ann. II CGI',
      );
    }
  } else {
    b.notApplicable('seller.rcs', 'company', 'Numéro RCS', 'Immatriculation au RCS non applicable à cette forme juridique.');
  }

  if (business.legalForm.trim()) {
    b.ok('seller.legalForm', 'company', 'Forme juridique', `Forme juridique : ${business.legalForm}.`, 'art. 242 nonies A, 4° ann. II CGI');
  } else {
    b.notApplicable(
      'seller.legalForm',
      'company',
      'Forme juridique',
      "Forme juridique non renseignée : elle n'est pas exigée pour une entreprise individuelle, mais doit être complétée pour une société.",
    );
  }

  if (requiresCapital(business.legalForm)) {
    if (business.capitalCents && business.capitalCents > 0) {
      b.ok('seller.capital', 'company', 'Capital social', `Capital social : ${formatEuros(business.capitalCents)}.`, 'art. 242 nonies A, 4° ann. II CGI');
    } else {
      b.blocking(
        'seller.capital',
        'company',
        'Capital social',
        "Le capital social doit être mentionné pour votre forme juridique. Renseignez-le dans les paramètres.",
        'art. 242 nonies A, 4° ann. II CGI',
      );
    }
  } else {
    b.notApplicable('seller.capital', 'company', 'Capital social', 'Mention du capital non applicable à cette forme juridique.');
  }

  if (business.rmApplicable) {
    if (business.rm.trim()) {
      b.ok('seller.rm', 'company', 'Numéro RM', `RM : ${business.rm}.`, 'art. 242 nonies A, 4° ann. II CGI');
    } else {
      b.blocking('seller.rm', 'company', 'Numéro RM', 'Vous avez indiqué être immatriculé au répertoire des métiers : renseignez le numéro RM.');
    }
  } else if ((business.legalStatus || '').toLowerCase().includes('artisan')) {
    b.warning(
      'seller.rm',
      'company',
      'Numéro RM',
      "Vous êtes artisan : le numéro RM (ou la mention du registre des entreprises) doit figurer sur la facture.",
    );
  } else {
    b.notApplicable('seller.rm', 'company', 'Numéro RM', 'Numéro RM non applicable.');
  }

  if (!fiscal.regime) {
    b.blocking(
      'vat.regime',
      'vat',
      'Régime de TVA',
      "Le régime de TVA n'est pas configuré. Choisissez votre régime dans Paramètres > Fiscalité : FacturePro n'applique aucune TVA par défaut.",
      'art. 242 nonies A ann. II CGI',
    );
  } else if (fiscal.regime === 'normal') {
    b.ok('vat.regime', 'vat', 'Régime de TVA', 'Régime normal : TVA facturée aux taux configurés.', 'art. 289 CGI');
  } else if (fiscal.regime === 'franchise') {
    if (fiscal.franchiseMention.trim()) {
      b.ok('vat.regime', 'vat', 'Régime de TVA', 'Franchise en base : mention de TVA non applicable affichée.', 'art. L. 223-3 CIBS');
    } else {
      b.blocking('vat.regime', 'vat', 'Régime de TVA', 'La mention de franchise en base de TVA est vide.');
    }
  } else {
    if (fiscal.exemptionReason.trim()) {
      b.ok('vat.regime', 'vat', 'Régime de TVA', 'Exonération de TVA : motif renseigné.', 'art. 261 CGI');
    } else {
      b.blocking(
        'vat.regime',
        'vat',
        'Régime de TVA',
        "Indiquez le motif légal d'exonération de TVA (il doit figurer sur la facture).",
        'art. 242 nonies A ann. II CGI',
      );
    }
  }

  if (fiscal.regime === 'normal') {
    if (!business.vatNumber.trim()) {
      if (isEuropeanUnion(client.address.country) && !isFrance(client.address.country)) {
        b.blocking(
          'vat.number',
          'vat',
          'Numéro de TVA du vendeur',
          'Le numéro de TVA intracommunautaire du vendeur est requis pour une prestation intracommunautaire.',
          'art. 289 CGI',
        );
      } else {
        b.warning(
          'vat.number',
          'vat',
          'Numéro de TVA du vendeur',
          "Le numéro de TVA intracommunautaire du vendeur n'est pas renseigné (recommandé, et obligatoire dans certains cas).",
          'art. 289 CGI',
        );
      }
    } else if (!isValidFrenchVatNumber(business.vatNumber) && !isValidVatNumber(business.vatNumber)) {
      b.incoherent('vat.number', 'vat', 'Numéro de TVA du vendeur', 'Le numéro de TVA intracommunautaire saisi est invalide.', 'art. 289 CGI');
    } else {
      b.ok('vat.number', 'vat', 'Numéro de TVA du vendeur', `TVA intracommunautaire : ${business.vatNumber}.`, 'art. 289 CGI');
    }
  } else if (fiscal.regime) {
    if (business.vatNumber.trim()) {
      b.warning(
        'vat.number',
        'vat',
        'Numéro de TVA du vendeur',
        "Vous n'êtes pas assujetti : un numéro de TVA ne doit en principe pas être affiché.",
      );
    } else {
      b.notApplicable('vat.number', 'vat', 'Numéro de TVA du vendeur', 'Aucun numéro de TVA à afficher pour ce régime.');
    }
  }

  if (identity.email && !isValidEmail(identity.email)) {
    b.incoherent('seller.email', 'company', 'E-mail du vendeur', "L'adresse e-mail du vendeur est invalide.");
  } else {
    b.ok('seller.email', 'company', 'E-mail du vendeur', "Coordonnées du vendeur présentes.", 'art. 242 nonies A, 2° ann. II CGI');
  }

  if (bank.iban.trim()) {
    if (isValidIban(bank.iban)) {
      b.ok('seller.iban', 'company', 'Coordonnées bancaires', 'IBAN valide.', 'art. 242 nonies A, 12° ann. II CGI');
    } else {
      b.incoherent('seller.iban', 'company', 'Coordonnées bancaires', "L'IBAN saisi est invalide.");
    }
  } else {
    b.notApplicable('seller.iban', 'company', 'Coordonnées bancaires', 'Aucune coordonnée bancaire renseignée (facultatif).');
  }

  if (identity.phone && !identity.phone.trim()) {
    b.warning('seller.phone', 'company', 'Téléphone du vendeur', 'Téléphone non renseigné.');
  }

  /* --------------------------- Client --------------------------- */
  const clientName = client.displayName || [client.firstName, client.lastName].filter(Boolean).join(' ') || client.companyName;
  if (clientName.trim()) {
    b.ok('client.identity', 'client', 'Identité du client', `Client identifié : ${clientName}.`, 'art. 242 nonies A, 5° ann. II CGI');
  } else {
    b.blocking('client.identity', 'client', 'Identité du client', "Sélectionnez un client ou renseignez son identité.", 'art. 242 nonies A, 5° ann. II CGI');
  }

  if (isAddressComplete(doc.billingAddress)) {
    b.ok('client.address', 'client', 'Adresse de facturation', 'Adresse de facturation complète.', 'art. 242 nonies A, 6° ann. II CGI');
  } else {
    b.blocking(
      'client.address',
      'client',
      'Adresse de facturation',
      "L'adresse de facturation du client est incomplète (adresse, code postal, ville et pays).",
      'art. 242 nonies A, 6° ann. II CGI',
    );
  }

  if (isPro && clientInFrance) {
    if (!client.siren.trim()) {
      const phaseStart = getEInvoicingStart(legal.eInvoicingPhase);
      const phaseReached = Boolean(phaseStart && doc.issueDate >= phaseStart);
      if (legal.enforceSirenForProClients || phaseReached) {
        b.blocking(
          'client.siren',
          'client',
          'SIREN du client',
          "Pour un client professionnel établi en France, le numéro SIREN doit figurer sur la facture. Complétez la fiche client.",
          'art. 242 nonies A, 1° ann. II CGI — décret n° 2022-1299',
        );
      } else {
        b.warning(
          'client.siren',
          'client',
          'SIREN du client',
          "Le SIREN du client professionnel est absent (mention obligatoire à compter du 1er septembre 2027 pour les PME).",
          'décret n° 2022-1299',
        );
      }
    } else if (!isValidSiren(client.siren)) {
      b.incoherent('client.siren', 'client', 'SIREN du client', 'Le SIREN du client est invalide.', 'art. 242 nonies A, 1° ann. II CGI');
    } else {
      b.ok('client.siren', 'client', 'SIREN du client', `SIREN client : ${client.siren}.`, 'art. 242 nonies A, 1° ann. II CGI');
    }
  } else if (isPro) {
    b.notApplicable(
      'client.siren',
      'client',
      'SIREN du client',
      "Le SIREN n'est pas applicable à un client professionnel étranger sans établissement en France.",
    );
  } else {
    b.notApplicable('client.siren', 'client', 'SIREN du client', 'Non applicable pour un particulier.');
  }

  if (client.vatNumber.trim()) {
    if (isValidVatNumber(client.vatNumber)) {
      b.ok('client.vat', 'client', 'Numéro de TVA du client', `TVA client : ${client.vatNumber}.`, 'art. 289 CGI');
    } else {
      b.incoherent('client.vat', 'client', 'Numéro de TVA du client', 'Le numéro de TVA du client est invalide.');
    }
  } else {
    b.notApplicable('client.vat', 'client', 'Numéro de TVA du client', 'Aucun numéro de TVA client renseigné (facultatif).');
  }

  /* ------------------------ Dates et paiement ------------------------ */
  if (doc.issueDate > today) {
    b.incoherent('invoice.issueDate', 'invoice', "Date d'émission", "La date d'émission ne peut pas être postérieure à aujourd'hui.", 'art. 242 nonies A, 1° ann. II CGI');
  } else {
    b.ok('invoice.issueDate', 'invoice', "Date d'émission", `Émise le ${formatDateFR(doc.issueDate)}.`, 'art. 242 nonies A, 1° ann. II CGI');
  }

  if (!doc.serviceDate) {
    b.blocking(
      'invoice.serviceDate',
      'invoice',
      "Date de réalisation / livraison",
      "La date de réalisation de la prestation ou de livraison des biens est obligatoire.",
      'art. 242 nonies A, 8° ann. II CGI',
    );
  } else if (doc.serviceDate > doc.issueDate) {
    b.warning(
      'invoice.serviceDate',
      'invoice',
      "Date de réalisation / livraison",
      "La date de réalisation est postérieure à la date d'émission : vérifiez qu'elle est exacte.",
    );
  } else {
    b.ok('invoice.serviceDate', 'invoice', "Date de réalisation / livraison", `Réalisée le ${formatDateFR(doc.serviceDate)}.`, 'art. 242 nonies A, 8° ann. II CGI');
  }

  if (doc.dueDate < doc.issueDate) {
    b.incoherent('invoice.dueDate', 'invoice', "Date d'échéance", "La date d'échéance ne peut pas précéder la date d'émission.", 'art. L. 441-9 C. com.');
  } else {
    b.ok('invoice.dueDate', 'invoice', "Date d'échéance", `Échéance le ${formatDateFR(doc.dueDate)}.`, 'art. L. 441-9 C. com.');
  }

  if (!doc.paymentTerms.trim()) {
    b.blocking(
      'invoice.paymentTerms',
      'payment',
      'Conditions de règlement',
      "Indiquez les conditions de règlement (ex. « Paiement à 30 jours »).",
      'art. L. 441-9 C. com.',
    );
  } else {
    b.ok('invoice.paymentTerms', 'payment', 'Conditions de règlement', doc.paymentTerms, 'art. L. 441-9 C. com.');
  }

  if (!doc.paymentMethod) {
    b.blocking('invoice.paymentMethod', 'payment', 'Mode de paiement', 'Indiquez le mode de paiement attendu.', 'art. 242 nonies A, 11° ann. II CGI');
  } else {
    b.ok('invoice.paymentMethod', 'payment', 'Mode de paiement', 'Mode de paiement renseigné.', 'art. 242 nonies A, 11° ann. II CGI');
  }

  if (isPro) {
    if (legal.latePenaltyRateBp === null) {
      b.blocking(
        'legal.penalties',
        'payment',
        'Pénalités de retard',
        "Renseignez le taux des pénalités de retard dans les paramètres (obligatoire entre professionnels). FacturePro n'invente aucun taux.",
        'art. L. 441-9 C. com.',
      );
    } else if (legal.latePenaltyRateBp < 0) {
      b.incoherent('legal.penalties', 'payment', 'Pénalités de retard', 'Le taux des pénalités de retard est invalide.');
    } else {
      b.ok(
        'legal.penalties',
        'payment',
        'Pénalités de retard',
        `Taux de pénalités de retard : ${(legal.latePenaltyRateBp / 100).toLocaleString('fr-FR')} % par an.`,
        'art. L. 441-9 C. com.',
      );
    }

    if (!legal.escompte.trim()) {
      b.blocking(
        'legal.escompte',
        'payment',
        'Conditions d’escompte',
        "Indiquez les conditions d'escompte (ex. « Aucun escompte accordé pour paiement anticipé »).",
        'art. L. 441-9 C. com.',
      );
    } else {
      b.ok('legal.escompte', 'payment', 'Conditions d’escompte', legal.escompte, 'art. L. 441-9 C. com.');
    }

    if (!legal.recoveryIndemnity) {
      b.warning(
        'legal.indemnity',
        'payment',
        'Indemnité forfaitaire de 40 €',
        "L'indemnité forfaitaire de 40 € pour frais de recouvrement est due de plein droit entre professionnels : sa mention est recommandée.",
        'art. L. 441-9 et D. 441-5 C. com.',
      );
    } else {
      b.ok('legal.indemnity', 'payment', 'Indemnité forfaitaire de 40 €', 'Indemnité de recouvrement mentionnée.', 'art. L. 441-9 et D. 441-5 C. com.');
    }
  } else {
    b.notApplicable('legal.penalties', 'payment', 'Pénalités de retard', 'Pénalités et indemnité de recouvrement non applicables à un particulier.');
  }

  /* ---------------------- Nature des opérations ---------------------- */
  if (!doc.operationNature) {
    b.blocking(
      'invoice.nature',
      'e_invoicing',
      'Nature de l’opération',
      'Précisez si la facture porte sur une livraison de biens, une prestation de services ou les deux.',
      'art. 242 nonies A, 7° ter ann. II CGI — décret n° 2022-1299',
    );
  } else {
    b.ok(
      'invoice.nature',
      'e_invoicing',
      'Nature de l’opération',
      `Nature : ${doc.operationNature === 'goods' ? 'livraison de biens' : doc.operationNature === 'services' ? 'prestation de services' : 'biens et services'}.`,
      'art. 242 nonies A, 7° ter ann. II CGI',
    );
  }

  if (doc.deliveryAddress) {
    if (isAddressComplete(doc.deliveryAddress)) {
      b.ok(
        'invoice.deliveryAddress',
        'e_invoicing',
        'Adresse de livraison',
        "L'adresse de livraison, différente de l'adresse de facturation, est mentionnée sur la facture.",
        'art. 242 nonies A, 7° bis ann. II CGI',
      );
    } else {
      b.incoherent(
        'invoice.deliveryAddress',
        'e_invoicing',
        'Adresse de livraison',
        "L'adresse de livraison est incomplète (adresse, code postal, ville et pays).",
        'art. 242 nonies A, 7° bis ann. II CGI',
      );
    }
  } else if (doc.operationNature === 'goods' && client.type === 'professionnel') {
    b.notApplicable(
      'invoice.deliveryAddress',
      'e_invoicing',
      'Adresse de livraison',
      "Adresse de livraison identique à l'adresse de facturation : aucune mention supplémentaire n'est exigée.",
    );
  } else {
    b.notApplicable('invoice.deliveryAddress', 'e_invoicing', 'Adresse de livraison', 'Adresse de livraison non renseignée (facultatif).');
  }

  /* ------------------------------ Lignes ------------------------------ */
  if (doc.lines.length === 0) {
    b.blocking('lines.count', 'lines', 'Lignes de facturation', 'Ajoutez au moins une ligne de facturation.', 'art. 242 nonies A, 9° ann. II CGI');
  } else {
    const invalidDesignation = doc.lines.filter((l) => !l.designation.trim());
    const invalidQty = doc.lines.filter((l) => !Number.isFinite(l.quantity) || l.quantity <= 0);
    const invalidPrice = doc.lines.filter((l) => !Number.isFinite(l.unitPriceCents) || l.unitPriceCents < 0);
    const invalidUnit = doc.lines.filter((l) => !l.unit.trim());
    if (invalidDesignation.length) {
      b.blocking('lines.designation', 'lines', 'Désignation des prestations', 'Chaque ligne doit comporter une désignation.', 'art. 242 nonies A, 9° ann. II CGI');
    } else {
      b.ok('lines.designation', 'lines', 'Désignation des prestations', 'Toutes les lignes sont désignées.', 'art. 242 nonies A, 9° ann. II CGI');
    }
    if (invalidQty.length) {
      b.blocking('lines.quantity', 'lines', 'Quantités', 'Chaque ligne doit avoir une quantité strictement positive.');
    } else {
      b.ok('lines.quantity', 'lines', 'Quantités', 'Quantités renseignées.', 'art. 242 nonies A, 9° ann. II CGI');
    }
    if (invalidPrice.length) {
      b.blocking('lines.price', 'lines', 'Prix unitaires', 'Les prix unitaires doivent être positifs ou nuls.');
    } else {
      b.ok('lines.price', 'lines', 'Prix unitaires', 'Prix unitaires renseignés.', 'art. 242 nonies A, 9° ann. II CGI');
    }
    if (invalidUnit.length) {
      b.blocking('lines.unit', 'lines', 'Unités', 'Chaque ligne doit comporter une unité (unité, heure, forfait…).');
    } else {
      b.ok('lines.unit', 'lines', 'Unités', 'Unités renseignées.', 'art. 242 nonies A, 9° ann. II CGI');
    }

    if (fiscal.regime && fiscal.regime !== 'normal') {
      const withVat = doc.lines.filter((l) => l.vatRateBp !== 0);
      if (withVat.length) {
        b.incoherent(
          'vat.lines',
          'vat',
          'TVA sur les lignes',
          `Votre régime (${fiscal.regime === 'franchise' ? 'franchise en base' : 'exonération'}) ne permet pas de facturer la TVA. ${withVat.length} ligne(s) portent un taux de TVA non nul.`,
          'art. 293 B CGI — art. L. 223-3 CIBS',
        );
      } else {
        b.ok('vat.lines', 'vat', 'TVA sur les lignes', 'Aucune TVA facturée, conformément au régime choisi.');
      }
    } else if (fiscal.regime === 'normal') {
      const allowed = new Set(fiscal.vatRates.map((r) => Math.round(r)));
      const unknownRates = [...new Set(doc.lines.filter((l) => !allowed.has(Math.round(l.vatRateBp))).map((l) => l.vatRateBp))];
      if (unknownRates.length) {
        b.warning(
          'vat.lines',
          'vat',
          'Taux de TVA',
          `Taux non déclaré(s) dans vos paramètres : ${unknownRates.map((r) => `${r / 100} %`).join(', ')}. Vérifiez votre configuration fiscale.`,
          'art. 278 CGI',
        );
      } else {
        b.ok('vat.lines', 'vat', 'Taux de TVA', 'Taux de TVA conformes à votre configuration.', 'art. 278 CGI');
      }
      if (doc.totals.totalVatCents === 0) {
        b.warning('vat.zero', 'vat', 'TVA nulle', "Aucune TVA n'est calculée alors que vous êtes assujetti : vérifiez les taux des lignes.");
      }
    }
  }

  /* ---------------------- Cohérence des totaux ---------------------- */
  const recomputed = computeInvoiceTotals(doc.lines as InvoiceLineInput[], doc.globalDiscountType, doc.globalDiscountValue);
  if (recomputed.totals.totalTtcCents !== doc.totals.totalTtcCents || recomputed.totals.totalHtCents !== doc.totals.totalHtCents) {
    b.incoherent(
      'totals.consistency',
      'invoice',
      'Cohérence des totaux',
      `Les totaux enregistrés ne correspondent pas au calcul des lignes (attendu ${formatEuros(recomputed.totals.totalTtcCents)} TTC).`,
    );
  } else {
    b.ok('totals.consistency', 'invoice', 'Cohérence des totaux', 'Totaux HT, TVA et TTC cohérents.', 'art. 242 nonies A, 10° ann. II CGI');
  }

  if (doc.totals.totalTtcCents < 0) {
    b.incoherent('totals.negative', 'invoice', 'Montant total', 'Le total TTC ne peut pas être négatif.');
  }
  if (doc.globalDiscountType === 'percent' && doc.globalDiscountValue > 10_000) {
    b.incoherent('totals.discount', 'invoice', 'Remise globale', 'La remise globale ne peut pas dépasser 100 %.');
  }
  if (doc.globalDiscountType === 'amount' && doc.globalDiscountValue > doc.totals.subtotalCents - doc.totals.lineDiscountCents) {
    b.incoherent('totals.discount', 'invoice', 'Remise globale', 'La remise globale dépasse le total HT des lignes.');
  }

  /* ----------------------------- Numéro ----------------------------- */
  if (doc.number) {
    if (input.numberUnique === false) {
      b.incoherent('invoice.number', 'invoice', 'Numéro de facture', 'Le numéro de facture existe déjà. La numérotation doit être unique et continue.', 'art. 242 nonies A, 1° ann. II CGI');
    } else {
      b.ok('invoice.number', 'invoice', 'Numéro de facture', `Numéro : ${doc.number}.`, 'art. 242 nonies A, 1° ann. II CGI');
    }
  } else if (input.numberAssigned === false) {
    b.notApplicable(
      'invoice.number',
      'invoice',
      'Numéro de facture',
      "Le numéro définitif sera attribué automatiquement à l'émission.",
      'art. 242 nonies A, 1° ann. II CGI',
    );
  } else {
    b.blocking('invoice.number', 'invoice', 'Numéro de facture', "Aucun numéro n'a été attribué à ce document.", 'art. 242 nonies A, 1° ann. II CGI');
  }

  /* --------------------- Bon de commande (optionnel) --------------------- */
  if (doc.purchaseOrder.trim()) {
    b.ok('invoice.purchaseOrder', 'invoice', 'Bon de commande', `Référence : ${doc.purchaseOrder}.`, 'art. 242 nonies A, 7° ann. II CGI');
  } else {
    b.notApplicable('invoice.purchaseOrder', 'invoice', 'Bon de commande', 'Aucun bon de commande (mention facultative).');
  }

  /* ------------------------------ Avoir ------------------------------ */
  if (isCreditNote) {
    if (!doc.sourceInvoiceNumber) {
      b.blocking('credit.source', 'invoice', 'Facture d’origine', "Un avoir doit référencer la facture d'origine.", 'art. 272 CGI');
    } else {
      b.ok('credit.source', 'invoice', 'Facture d’origine', `Facture d'origine : ${doc.sourceInvoiceNumber}.`, 'art. 272 CGI');
    }
    const creditReason = (doc.reason ?? '').trim();
    if (!creditReason) {
      b.blocking('credit.reason', 'invoice', 'Motif de l’avoir', "Indiquez le motif de l'avoir (annulation, remise, erreur de facturation…).", 'art. 272 CGI');
    } else {
      b.ok('credit.reason', 'invoice', 'Motif de l’avoir', creditReason, 'art. 272 CGI');
    }
    if (input.creditNoteContext) {
      const max = input.creditNoteContext.sourceTotalCents - input.creditNoteContext.alreadyCreditedCents;
      if (doc.totals.totalTtcCents > max) {
        b.incoherent(
          'credit.amount',
          'invoice',
          'Montant de l’avoir',
          `Le montant de l'avoir (${formatEuros(doc.totals.totalTtcCents)}) dépasse le solde créditable de la facture d'origine (${formatEuros(Math.max(max, 0))}).`,
          'art. 272 CGI',
        );
      } else {
        b.ok('credit.amount', 'invoice', 'Montant de l’avoir', "Montant de l'avoir cohérent avec la facture d'origine.", 'art. 272 CGI');
      }
    }
  }

  /* --------------------------- Particuliers --------------------------- */
  if (client.type === 'particulier') {
    if (frGoods) {
      if (legal.consumerGoodsMention.trim()) {
        b.ok(
          'consumer.guarantee',
          'client',
          'Garantie légale de conformité',
          'Mention relative à la garantie légale de conformité affichée.',
          'art. L. 217-3 et s. C. conso.',
        );
      } else {
        b.blocking(
          'consumer.guarantee',
          'client',
          'Garantie légale de conformité',
          'Pour une vente de biens à un particulier, la mention de la garantie légale de conformité doit figurer sur la facture.',
          'art. L. 217-3 et s. C. conso.',
        );
      }
      if (legal.mediatorName.trim()) {
        b.ok('consumer.mediator', 'client', 'Médiateur de la consommation', `Médiateur : ${legal.mediatorName}.`, 'art. L. 612-1 C. conso.');
      } else {
        b.warning(
          'consumer.mediator',
          'client',
          'Médiateur de la consommation',
          "Renseignez les coordonnées du médiateur de la consommation : leur mention est obligatoire pour les ventes aux particuliers.",
          'art. L. 616-1 C. conso.',
        );
      }
    } else {
      b.notApplicable(
        'consumer.guarantee',
        'client',
        'Garantie légale de conformité',
        'Mention sans objet pour une prestation de services sans livraison de biens.',
      );
      b.notApplicable('consumer.mediator', 'client', 'Médiateur de la consommation', 'Médiateur non requis pour cette opération.');
    }
  } else {
    b.notApplicable('consumer.guarantee', 'client', 'Garantie légale de conformité', 'Non applicable à un client professionnel.');
    b.notApplicable('consumer.mediator', 'client', 'Médiateur de la consommation', 'Non applicable à un client professionnel.');
  }

  /* -------------------------- Facturation électronique -------------------------- */
  if (fiscal.debitsOption) {
    b.ok(
      'einv.debits',
      'e_invoicing',
      'Option TVA d’après les débits',
      "Mention « option pour le paiement de la TVA d'après les débits » imprimée sur la facture.",
      'art. 242 nonies A ann. II CGI',
    );
  } else {
    b.notApplicable('einv.debits', 'e_invoicing', 'Option TVA d’après les débits', "Option non exercée : aucune mention n'est imprimée.");
  }

  const phase = legal.eInvoicingPhase;
  const phaseStart = getEInvoicingStart(phase);
  if (phase === 'unspecified') {
    b.warning(
      'einv.phase',
      'e_invoicing',
      'Facturation électronique',
      "Indiquez votre catégorie d'entreprise dans les paramètres pour savoir à quelle date l'émission électronique devient obligatoire.",
      'art. 289 bis CGI — décret n° 2022-1299',
    );
  } else if (phase === 'not_concerned') {
    b.notApplicable('einv.phase', 'e_invoicing', 'Facturation électronique', 'Entreprise non concernée par la facturation électronique obligatoire.');
  } else if (phase) {
    const reached = Boolean(phaseStart && doc.issueDate >= phaseStart);
    if (reached) {
      b.warning(
        'einv.phase',
        'e_invoicing',
        'Facturation électronique',
        `Depuis le ${formatDateFR(phaseStart)}, les entreprises de votre catégorie (${E_INVOICING_PHASE_LABEL[phase]}) doivent émettre des factures électroniques structurées via une plateforme agréée. Ce PDF n'est pas une facture électronique conforme au dispositif : conservez-le comme document lisible et préparez la transmission via une PA.`,
        'art. 289 bis CGI',
      );
    } else {
      b.add(
        'einv.phase',
        'e_invoicing',
        'Facturation électronique',
        'ok',
        'info',
        `Émission électronique obligatoire à partir du ${formatDateFR(phaseStart)} pour les ${E_INVOICING_PHASE_LABEL[phase]}. Ce PDF ne constitue pas une facture électronique structurée.`,
        'art. 289 bis CGI',
      );
    }
  }

  b.add(
    'einv.pdf',
    'e_invoicing',
    'Nature du document',
    'not_applicable',
    'info',
    "Ce PDF est un document lisible et archivé localement. Il ne remplace pas une facture électronique structurée (Factur-X / UBL / CII) transmise via une plateforme agréée. FacturePro ne prétend pas satisfaire à lui seul cette obligation.",
    'art. 289 bis CGI',
  );

  const checks = b.checks;
  const blockingCount = checks.filter((c) => c.severity === 'blocking' && (c.status === 'missing' || c.status === 'incoherent')).length;
  const warningCount = checks.filter((c) => c.severity === 'warning' && (c.status === 'missing' || c.status === 'incoherent')).length;
  const okCount = checks.filter((c) => c.status === 'ok').length;
  const notApplicableCount = checks.filter((c) => c.status === 'not_applicable').length;

  return {
    checkedAt: nowISO(),
    rulesVersion: RULES_VERSION,
    checks,
    canIssue: blockingCount === 0,
    blockingCount,
    warningCount,
    okCount,
    notApplicableCount,
  };
}

/* ------------------------------------------------------------------ */
/* Mentions imprimées sur le PDF                                       */
/* ------------------------------------------------------------------ */

export interface LegalMention {
  id: string;
  text: string;
  reference?: string;
}

export function buildLegalMentions(params: {
  legal: LegalSnapshot;
  clientType: ClientType;
  operationNature: OperationNature;
  hasVat: boolean;
}): LegalMention[] {
  const { legal, clientType, operationNature } = params;
  const isPro = clientType === 'professionnel';
  const goods = operationNature === 'goods' || operationNature === 'mixed';
  const mentions: LegalMention[] = [];

  if (legal.vatRegime === 'franchise') {
    mentions.push({
      id: 'vat-franchise',
      text: legal.franchiseMention || 'TVA non applicable, art. L. 223-3 du code des impositions sur les biens et services (CIBS).',
      reference: 'art. L. 223-3 CIBS',
    });
  } else if (legal.vatRegime === 'exemption') {
    mentions.push({
      id: 'vat-exemption',
      text: `TVA non applicable — ${legal.exemptionReason || 'exonération de TVA'}`,
      reference: 'art. 261 CGI',
    });
  }

  if (legal.debitsOption) {
    mentions.push({
      id: 'vat-debits',
      text: 'Option pour le paiement de la taxe sur la valeur ajoutée d’après les débits.',
      reference: 'art. 242 nonies A ann. II CGI',
    });
  }

  if (isPro) {
    if (legal.latePenaltyRateBp !== null) {
      mentions.push({
        id: 'late-penalties',
        text: `Pénalités de retard : ${(legal.latePenaltyRateBp / 100).toLocaleString('fr-FR')} % par an, applicables de plein droit en cas de paiement après l'échéance.`,
        reference: 'art. L. 441-9 C. com.',
      });
    }
    if (legal.recoveryIndemnity) {
      mentions.push({
        id: 'recovery-indemnity',
        text: 'Indemnité forfaitaire pour frais de recouvrement : 40 € pour tout professionnel en situation de retard de paiement.',
        reference: 'art. L. 441-9 et D. 441-5 C. com.',
      });
    }
    if (legal.escompte.trim()) {
      mentions.push({ id: 'escompte', text: legal.escompte.trim(), reference: 'art. L. 441-9 C. com.' });
    }
  }

  if (clientType === 'particulier' && goods && legal.consumerGoodsMention.trim()) {
    mentions.push({
      id: 'consumer-guarantee',
      text: legal.consumerGoodsMention.trim(),
      reference: 'art. L. 217-3 et s. C. conso.',
    });
  }

  if (clientType === 'particulier' && legal.mediatorName.trim()) {
    mentions.push({
      id: 'consumer-mediator',
      text: `Médiateur de la consommation : ${legal.mediatorName}${legal.mediatorUrl ? ` — ${legal.mediatorUrl}` : ''}.`,
      reference: 'art. L. 616-1 C. conso.',
    });
  }

  return mentions;
}

/** Résumé de conformité lisible pour l'interface. */
export function complianceSummary(report: ComplianceReport): string {
  if (report.canIssue) {
    return report.warningCount > 0
      ? `Conforme — ${report.warningCount} point(s) à vérifier`
      : 'Conforme — prêt à émettre';
  }
  return `${report.blockingCount} information(s) obligatoire(s) manquante(s)`;
}

export function statusLabel(status: string): string {
  return STATUS_META[status as keyof typeof STATUS_META]?.label ?? status;
}

/** Texte par défaut de la garantie légale (exporté pour l'interface de paramétrage). */
export const DEFAULT_CONSUMER_MENTION_EXPORT = DEFAULT_CONSUMER_MENTION;
