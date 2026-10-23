import { z } from 'zod';
import { isValidISODate } from '@shared/dates';

const text = (max: number) => z.string().max(max);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ attendue')
  .refine((value) => isValidISODate(value), 'Date invalide');
const identifier = z.string().min(1).max(100);
const positiveInt = (max = 1_000_000_000) => z.number().int().min(0).max(max);

export const AddressSchema = z.object({
  line1: text(200),
  line2: text(200),
  postalCode: text(20),
  city: text(100),
  country: text(60),
});

export const ClientSchema = z.object({
  type: z.enum(['particulier', 'professionnel']),
  civility: text(20),
  firstName: text(100),
  lastName: text(100),
  companyName: text(200),
  legalForm: text(100),
  siren: text(20),
  siret: text(20),
  vatNumber: text(30),
  vatSubject: z.boolean(),
  email: text(254),
  phone: text(30),
  address: AddressSchema,
  deliveryAddress: AddressSchema.nullable(),
  notes: text(2000),
});

export const ClientListSchema = z
  .object({
    query: text(200).optional(),
    type: z.enum(['particulier', 'professionnel', 'all']).optional(),
    includeArchived: z.boolean().optional(),
    sort: z.enum(['name', 'created', 'revenue']).optional(),
  })
  .optional();

export const LineSchema = z.object({
  id: z.string().max(100).optional(),
  designation: text(500),
  description: text(2000),
  reference: text(100),
  quantity: z.number().finite().min(0).max(1_000_000),
  unit: text(30),
  unitPriceCents: z.number().int().min(0).max(1_000_000_000),
  discountType: z.enum(['none', 'percent', 'amount']),
  discountValue: z.number().int().min(0).max(1_000_000_000),
  vatRateBp: z.number().int().min(0).max(10_000),
  isExtraFee: z.boolean(),
  operationNature: z.enum(['goods', 'services', '']),
});

export const DraftSchema = z.object({
  id: identifier.optional(),
  type: z.enum(['invoice', 'credit_note']).optional(),
  clientId: identifier.nullable(),
  issueDate: isoDate,
  dueDate: isoDate,
  serviceDate: isoDate,
  billingAddress: AddressSchema,
  deliveryAddress: AddressSchema.nullable(),
  purchaseOrder: text(100),
  operationNature: z.enum(['goods', 'services', 'mixed']),
  description: text(4000),
  paymentTerms: text(500),
  paymentMethod: z.enum(['virement', 'carte', 'especes', 'cheque', 'autre']),
  notes: text(4000),
  lines: z.array(LineSchema).min(1).max(500),
  globalDiscountType: z.enum(['none', 'percent', 'amount']),
  globalDiscountValue: z.number().int().min(0).max(1_000_000_000),
  sourceInvoiceId: identifier.nullable().optional(),
  reason: text(500).optional(),
});

export const UpdateDraftSchema = DraftSchema.extend({ id: identifier });

export const InvoiceFiltersSchema = z.object({
  query: text(200).optional(),
  status: z
    .enum(['all', 'draft', 'issued', 'sent', 'partial', 'paid', 'overdue', 'cancelled'])
    .optional(),
  type: z.enum(['invoice', 'credit_note', 'all']).optional(),
  clientId: identifier.optional(),
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  sortBy: z
    .enum(['number', 'clientName', 'issueDate', 'dueDate', 'totalTtcCents', 'balanceCents', 'status'])
    .optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
});

const SettingsBase = z.object({
  identity: z.object({
    civility: text(20),
    firstName: text(100),
    lastName: text(100),
    phone: text(30),
    email: text(254),
    website: text(200),
  }),
  business: z.object({
    tradeName: text(200),
    legalName: text(200),
    legalForm: text(100),
    legalStatus: text(100),
    siren: text(20),
    siret: text(20),
    rcs: text(100),
    rcsApplicable: z.boolean(),
    rm: text(100),
    rmApplicable: z.boolean(),
    capitalCents: z.number().int().min(0).max(1_000_000_000).nullable(),
    ape: text(20),
    activity: text(500),
    address: AddressSchema,
    vatNumber: text(30),
  }),
  bank: z.object({
    bankName: text(200),
    accountHolder: text(200),
    iban: text(50),
    bic: text(20),
    paymentInstructions: text(1000),
  }),
  fiscal: z.object({
    regime: z.enum(['normal', 'franchise', 'exemption']).nullable(),
    vatRates: z.array(z.number().int().min(0).max(10_000)).min(1).max(20),
    franchiseMention: text(500),
    exemptionReason: text(500),
    debitsOption: z.boolean(),
    fiscalRegime: text(100),
  }),
  branding: z.object({
    logo: z
      .object({
        path: text(300),
        mime: text(50),
        updatedAt: text(50),
      })
      .nullable(),
    primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue'),
    secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Couleur hexadécimale attendue'),
    showLogo: z.boolean(),
  }),
  documents: z.object({
    invoicePrefix: text(10),
    creditPrefix: text(10),
    padding: z.number().int().min(2).max(8),
    resetYearly: z.boolean(),
    startNumber: z.number().int().min(1).max(999_999).nullable(),
    pdfTemplate: z.enum(['classic', 'modern', 'minimal']),
    defaultTermsDays: z.number().int().min(0).max(365).nullable(),
    defaultPaymentMethod: z.enum(['virement', 'carte', 'especes', 'cheque', 'autre']),
    defaultVatRateBp: z.number().int().min(0).max(10_000).nullable(),
    defaultUnit: text(30),
  }),
  legal: z.object({
    latePenaltyRateBp: z.number().int().min(0).max(100_000).nullable(),
    recoveryIndemnity: z.boolean(),
    escompte: text(1000),
    mediatorName: text(200),
    mediatorAddress: text(500),
    mediatorUrl: text(300),
    consumerGoodsMention: text(2000),
    enforceSirenForProClients: z.boolean(),
    eInvoicingPhase: z.enum(['unspecified', 'ge_eti', 'pme', 'not_concerned']),
    eInvoicingPartner: text(200),
  }),
  setupCompleted: z.boolean(),
  updatedAt: z.string().nullable(),
});

export const SettingsSchema = SettingsBase;

export const PaymentCreateSchema = z.object({
  invoiceId: identifier,
  date: isoDate,
  amountCents: z.number().int().min(1).max(1_000_000_000),
  method: z.enum(['virement', 'carte', 'especes', 'cheque', 'autre']),
  reference: text(100),
  note: text(500),
});

export const PaymentListSchema = z
  .object({
    query: text(200).optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    invoiceId: identifier.optional(),
    page: z.number().int().min(1).max(100_000).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
  })
  .optional();

export const DashboardSchema = z.object({
  preset: z.enum(['today', 'week', 'month', 'quarter', 'year', 'custom', 'all']),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const StatsSchema = z.object({
  year: z.number().int().min(2000).max(2100),
});

export const ExportFiltersSchema = z.object({
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  clientId: identifier.optional(),
  status: z
    .enum(['all', 'draft', 'issued', 'sent', 'partial', 'paid', 'overdue', 'cancelled'])
    .optional(),
  type: z.enum(['invoice', 'credit_note', 'all']).optional(),
});

export const LogoUploadSchema = z.object({
  fileName: text(200),
  mime: text(50),
  base64: z.string().min(10).max(8_000_000),
});

export const PreviewSchema = z
  .object({
    id: identifier.optional(),
    draft: DraftSchema.optional(),
  })
  .refine((value) => Boolean(value.id) !== Boolean(value.draft), 'Indiquez soit un document, soit un brouillon.');

export const IdSchema = z.object({ id: identifier });
export const IdBooleanSchema = z.object({ id: identifier, value: z.boolean() });

export const ExternalUrlSchema = z.object({
  url: z.string().url().max(2000),
});

export const SavePreviewSchema = z.object({
  base64: z.string().min(10).max(20_000_000),
  fileName: text(200),
});

export const ZipExportSchema = z.object({
  ids: z.array(identifier).min(1).max(500),
});

export const VatExportSchema = z.object({
  dateFrom: isoDate,
  dateTo: isoDate,
});

export const BackupPathSchema = z.object({ path: text(2000) });

export const PeriodTypeSchema = z.object({
  type: z.enum(['invoice', 'credit_note']).optional(),
});
