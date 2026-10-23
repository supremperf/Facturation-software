import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  FileMinus2,
  FileText,
  Info,
  Plus,
  Save,
  Send,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  Address,
  Client,
  ClientSnapshot,
  ComplianceReport,
  DiscountType,
  DocumentType,
  Invoice,
  InvoiceDraftInput,
  InvoiceSummary,
  InvoiceLineInput,
  OperationNature,
  PaymentMethod,
  VatRegime,
} from '@shared/types';
import {
  OPERATION_NATURE_LABEL,
  PAYMENT_METHODS,
  UNITS,
  clientSnapshotFromClient,
} from '@shared/constants';
import { addDays, dueDateFromTerms, todayISO } from '@shared/dates';
import { computeInvoiceTotals } from '@shared/money';
import { buildLegalSnapshot, buildSellerSnapshot } from '@shared/legal';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useDebounced } from '../lib/hooks';
import { euro, formatDateFR } from '../lib/format';
import { navigate, useRoute } from '../lib/router';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  CardHeader,
  Field,
  IconButton,
  InlineError,
  Modal,
  MoneyInput,
  PageHeader,
  PercentInput,
  QuantityInput,
  Select,
  Switch,
  TextInput,
  Textarea,
} from '../components/ui';
import { InvoicePreview, type PreviewData } from '../components/InvoicePreview';
import { CompliancePanel } from '../components/CompliancePanel';
import { ClientDialog } from '../components/ClientDialog';

interface EditorLine extends InvoiceLineInput {
  key: string;
}

const emptyAddress = (): Address => ({ line1: '', line2: '', postalCode: '', city: '', country: 'France' });

function newLine(defaults: { vatRateBp: number; unit: string }): EditorLine {
  return {
    key: crypto.randomUUID(),
    designation: '',
    description: '',
    reference: '',
    quantity: 1,
    unit: defaults.unit,
    unitPriceCents: 0,
    discountType: 'none',
    discountValue: 0,
    vatRateBp: defaults.vatRateBp,
    isExtraFee: false,
    operationNature: '',
  };
}

function snapshotForClient(client: Client | null): ClientSnapshot {
  if (client) return clientSnapshotFromClient(client);
  return {
    id: null,
    displayName: 'Client à sélectionner',
    type: 'professionnel',
    civility: '',
    firstName: '',
    lastName: '',
    companyName: '',
    legalForm: '',
    siren: '',
    siret: '',
    vatNumber: '',
    vatSubject: true,
    email: '',
    phone: '',
    address: emptyAddress(),
    deliveryAddress: null,
  };
}

export function InvoiceEditorPage() {
  const route = useRoute();
  const toast = useToast();
  const { settings, appInfo, bumpData } = useAppData();
  const draftIdFromRoute =
    route.pathname.startsWith('/factures/') && route.pathname.endsWith('/modifier')
      ? route.pathname.split('/')[2]
      : null;
  const [draftId, setDraftId] = useState<string | null>(draftIdFromRoute);
  const queryType = route.search.get('type') === 'credit_note' ? 'credit_note' : 'invoice';
  const querySource = route.search.get('source');

  const [docType, setDocType] = useState<DocumentType>(queryType);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState<string | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [issueDate, setIssueDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState(addDays(todayISO(), 30));
  const [serviceDate, setServiceDate] = useState(todayISO());
  const [billingAddress, setBillingAddress] = useState<Address>(emptyAddress());
  const [deliveryAddress, setDeliveryAddress] = useState<Address>(emptyAddress());
  const [useDelivery, setUseDelivery] = useState(false);
  const [purchaseOrder, setPurchaseOrder] = useState('');
  const [operationNature, setOperationNature] = useState<OperationNature>('services');
  const [description, setDescription] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('virement');
  const [lines, setLines] = useState<EditorLine[]>([]);
  const [globalDiscountType, setGlobalDiscountType] = useState<DiscountType>('none');
  const [globalDiscountValue, setGlobalDiscountValue] = useState(0);
  const [sourceInvoiceId, setSourceInvoiceId] = useState<string | null>(querySource);
  const [sourceInvoice, setSourceInvoice] = useState<Invoice | null>(null);
  const [reason, setReason] = useState('');
  const [availableSources, setAvailableSources] = useState<InvoiceSummary[]>([]);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [newClientOpen, setNewClientOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [report, setReport] = useState<ComplianceReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numberPreview, setNumberPreview] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const franchise = settings?.fiscal.regime === 'franchise' || settings?.fiscal.regime === 'exemption';
  const defaultVatRate = franchise ? 0 : settings?.documents.defaultVatRateBp ?? 2000;
  const defaultUnit = settings?.documents.defaultUnit || 'unité';
  const termsDays = settings?.documents.defaultTermsDays ?? 30;

  const vatOptions = useMemo(() => {
    const base = franchise ? [0] : settings?.fiscal.vatRates?.length ? settings.fiscal.vatRates : [2000, 1000, 550, 210, 0];
    const values = new Set<number>(base);
    if (settings?.documents.defaultVatRateBp != null) values.add(settings.documents.defaultVatRateBp);
    lines.forEach((line) => values.add(line.vatRateBp));
    return Array.from(values).sort((a, b) => b - a);
  }, [franchise, settings, lines]);

  /* Chargement initial */
  useEffect(() => {
    api.clients
      .list()
      .then(setClients)
      .catch((error) => setLoadError(errorMessage(error)));
    api.invoices
      .numberPreview(queryType)
      .then((preview) => setNumberPreview(preview.nextNumber))
      .catch(() => setNumberPreview(null));
  }, [queryType]);

  useEffect(() => {
    if (initialized || !settings) return;
    setLines([newLine({ vatRateBp: defaultVatRate, unit: defaultUnit })]);
    setPaymentMethod(settings.documents.defaultPaymentMethod);
    setPaymentTerms(
      `Paiement à ${termsDays} jours date de facture.`,
    );
    setDueDate(dueDateFromTerms(todayISO(), termsDays));
    setInitialized(true);
  }, [settings, initialized, defaultVatRate, defaultUnit, termsDays]);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    api.invoices
      .get(draftId)
      .then((invoice) => {
        if (cancelled) return;
        if (invoice.status !== 'draft') {
          toast.info('Document déjà émis', 'Les factures émises ne sont plus modifiables.');
          navigate(`/factures/${invoice.id}`);
          return;
        }
        setDocType(invoice.type);
        setClientId(invoice.clientId);
        if (invoice.clientId) {
          api.clients.get(invoice.clientId).then((found) => setClient(found)).catch(() => setClient(null));
        }
        setIssueDate(invoice.issueDate);
        setDueDate(invoice.dueDate);
        setServiceDate(invoice.serviceDate);
        setBillingAddress(invoice.billingAddress);
        setUseDelivery(Boolean(invoice.deliveryAddress));
        setDeliveryAddress(invoice.deliveryAddress ?? emptyAddress());
        setPurchaseOrder(invoice.purchaseOrder);
        setOperationNature(invoice.operationNature);
        setDescription(invoice.description);
        setNotes(invoice.notes);
        setPaymentTerms(invoice.paymentTerms);
        setPaymentMethod(invoice.paymentMethod);
        setLines(
          invoice.lines.map((line) => ({
            key: line.id,
            designation: line.designation,
            description: line.description,
            reference: line.reference,
            quantity: line.quantity,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            discountType: line.discountType,
            discountValue: line.discountValue,
            vatRateBp: line.vatRateBp,
            isExtraFee: line.isExtraFee,
            operationNature: line.operationNature,
          })),
        );
        setGlobalDiscountType(invoice.globalDiscountType);
        setGlobalDiscountValue(invoice.globalDiscountValue);
        setSourceInvoiceId(invoice.sourceInvoiceId);
        setReason(invoice.reason);
        setInitialized(true);
      })
      .catch((error) => setLoadError(errorMessage(error)));
    return () => {
      cancelled = true;
    };
  }, [draftId, toast]);

  useEffect(() => {
    if (docType !== 'credit_note') return;
    api.invoices
      .list({ type: 'invoice', status: 'all', pageSize: 100, sortBy: 'issueDate', sortDir: 'desc' })
      .then((result) => setAvailableSources(result.items.filter((item) => item.status !== 'draft')))
      .catch(() => setAvailableSources([]));
  }, [docType]);

  useEffect(() => {
    if (!sourceInvoiceId) {
      setSourceInvoice(null);
      return;
    }
    api.invoices
      .get(sourceInvoiceId)
      .then((invoice) => {
        setSourceInvoice(invoice);
        if (!draftId) {
          setClientId(invoice.clientId);
          if (invoice.clientId) {
            api.clients.get(invoice.clientId).then((found) => {
              setClient(found);
              setBillingAddress(found.address);
              setDeliveryAddress(found.deliveryAddress ?? emptyAddress());
              setUseDelivery(Boolean(found.deliveryAddress));
            });
          }
          setServiceDate(invoice.serviceDate);
          setPaymentTerms(invoice.paymentTerms);
          setPaymentMethod(invoice.paymentMethod);
          setOperationNature(invoice.operationNature);
          setLines(
            invoice.lines.map((line) => ({
              key: crypto.randomUUID(),
              designation: line.designation,
              description: line.description,
              reference: line.reference,
              quantity: line.quantity,
              unit: line.unit,
              unitPriceCents: line.unitPriceCents,
              discountType: line.discountType,
              discountValue: line.discountValue,
              vatRateBp: invoice.legalSnapshot.vatRegime === 'normal' ? line.vatRateBp : 0,
              isExtraFee: line.isExtraFee,
              operationNature: line.operationNature,
            })),
          );
          setDescription(`Avoir sur facture ${invoice.number ?? ''}`);
        }
      })
      .catch(() => setSourceInvoice(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceInvoiceId]);

  const chooseClient = (selected: Client) => {
    setClientId(selected.id);
    setClient(selected);
    setBillingAddress(selected.address);
    setUseDelivery(Boolean(selected.deliveryAddress));
    setDeliveryAddress(selected.deliveryAddress ?? emptyAddress());
    setClientPickerOpen(false);
  };

  const useClientAddress = () => {
    if (!client) return;
    setBillingAddress(client.address);
  };

  const computed = useMemo(
    () => computeInvoiceTotals(lines, globalDiscountType, globalDiscountValue),
    [lines, globalDiscountType, globalDiscountValue],
  );

  const payload: InvoiceDraftInput = useMemo(
    () => ({
      type: docType,
      clientId,
      issueDate,
      dueDate,
      serviceDate,
      billingAddress,
      deliveryAddress: useDelivery ? deliveryAddress : null,
      purchaseOrder: purchaseOrder.trim(),
      operationNature,
      description: description.trim(),
      paymentTerms: paymentTerms.trim(),
      paymentMethod,
      notes: notes.trim(),
      lines: lines.map(({ key: _key, ...line }) => ({ ...line, id: undefined })),
      globalDiscountType,
      globalDiscountValue,
      sourceInvoiceId: docType === 'credit_note' ? sourceInvoiceId : null,
      reason: docType === 'credit_note' ? reason.trim() : '',
    }),
    [
      docType,
      clientId,
      issueDate,
      dueDate,
      serviceDate,
      billingAddress,
      useDelivery,
      deliveryAddress,
      purchaseOrder,
      operationNature,
      description,
      paymentTerms,
      paymentMethod,
      notes,
      lines,
      globalDiscountType,
      globalDiscountValue,
      sourceInvoiceId,
      reason,
    ],
  );

  const serializedPayload = useMemo(() => JSON.stringify(payload), [payload]);
  const debouncedPayload = useDebounced(serializedPayload, 450);

  useEffect(() => {
    // Sans client, le contrôle n'a pas de sens : on ne sollicite pas le moteur
    // et on invite explicitement à sélectionner un client.
    if (!clientId) {
      setReport(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const timer = window.setTimeout(() => {
      api.invoices
        .validateDraft(JSON.parse(debouncedPayload) as InvoiceDraftInput)
        .then((nextReport) => {
          if (!cancelled) {
            setReport(nextReport);
            setChecking(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setReport(null);
            setChecking(false);
          }
        });
    }, 60);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [debouncedPayload, clientId, lines]);

  const previewData = useMemo<PreviewData | null>(() => {
    if (!settings) return null;
    return {
      type: docType,
      number: null,
      issueDate,
      dueDate,
      serviceDate,
      purchaseOrder: purchaseOrder.trim(),
      operationNature,
      description: description.trim(),
      paymentTerms: paymentTerms.trim() || `Paiement à ${termsDays} jours date de facture.`,
      paymentMethod,
      notes: notes.trim(),
      client: snapshotForClient(client),
      seller: buildSellerSnapshot(settings),
      legal: buildLegalSnapshot(settings),
      billingAddress,
      deliveryAddress: useDelivery ? deliveryAddress : null,
      lines: computed.lines.map((line, index) => ({
        ...line,
        id: lines[index]?.key ?? String(index),
        position: index,
      })),
      totals: computed.totals,
      globalDiscountType,
      globalDiscountValue,
      draft: true,
    };
  }, [
    settings,
    docType,
    issueDate,
    dueDate,
    serviceDate,
    purchaseOrder,
    operationNature,
    description,
    paymentTerms,
    paymentMethod,
    notes,
    client,
    billingAddress,
    deliveryAddress,
    useDelivery,
    computed,
    lines,
    globalDiscountType,
    globalDiscountValue,
    termsDays,
  ]);

  const updateLine = (key: string, patch: Partial<InvoiceLineInput>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const addLine = (extraFee = false) => {
    setLines((current) => [
      ...current,
      {
        ...newLine({ vatRateBp: defaultVatRate, unit: defaultUnit }),
        isExtraFee: extraFee,
        designation: extraFee ? 'Frais supplémentaires' : '',
      },
    ]);
  };

  const removeLine = (key: string) => {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  };

  const saveDraft = async (): Promise<Invoice | null> => {
    if (lines.length === 0) {
      toast.error('Document vide', 'Ajoutez au moins une ligne.');
      return null;
    }
    setSaving(true);
    try {
      const saved = draftId
        ? await api.invoices.updateDraft(draftId, payload)
        : await api.invoices.saveDraft(payload);
      setDraftId(saved.id);
      setNumberPreview(null);
      toast.success('Brouillon enregistré', `${lines.length} ligne${lines.length > 1 ? 's' : ''} · aucun numéro consommé`);
      bumpData();
      return saved;
    } catch (error) {
      toast.error('Enregistrement impossible', errorMessage(error));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const issue = async () => {
    if (report && !report.canIssue) {
      toast.error('Émission bloquée', 'Des mentions obligatoires sont manquantes. Consultez le contrôle de conformité.');
      return;
    }
    setIssuing(true);
    try {
      const saved = draftId
        ? await api.invoices.updateDraft(draftId, payload)
        : await api.invoices.saveDraft(payload);
      setDraftId(saved.id);
      const result = await api.invoices.issue(saved.id);
      bumpData();
      if (result.pdfWarning) {
        toast.warning('Document émis, PDF à vérifier', result.pdfWarning);
      } else {
        toast.success(
          docType === 'credit_note' ? 'Avoir émis' : 'Facture émise',
          `${result.invoice.number} · ${euro(result.invoice.totals.totalTtcCents)}`,
        );
      }
      navigate(`/factures/${saved.id}`);
    } catch (error) {
      toast.error('Émission impossible', errorMessage(error));
      const details = (error as { details?: ComplianceReport }).details;
      if (details && Array.isArray((details as ComplianceReport).checks)) {
        setReport(details as ComplianceReport);
      }
    } finally {
      setIssuing(false);
    }
  };

  const savePreviewPdf = async () => {
    try {
      const preview = await api.invoices.preview({ draft: payload });
      const saved = await api.savePreviewPdf(preview.base64, preview.fileName);
      if (!saved.canceled) toast.success('Aperçu PDF enregistré', saved.path);
    } catch (error) {
      toast.error('Aperçu impossible', errorMessage(error));
    }
  };

  const isCredit = docType === 'credit_note';
  // Montant encore créditable : le total TTC de la facture d'origine diminué
  // des avoirs déjà émis. Les encaissements n'entrent pas en compte : une
  // facture intégralement payée peut parfaitement faire l'objet d'un avoir
  // (remboursement), la limite légale étant le montant facturé.
  const creditableCents = sourceInvoice
    ? Math.max(0, sourceInvoice.totals.totalTtcCents - sourceInvoice.creditedCents)
    : 0;
  const canIssue = Boolean(report?.canIssue);

  if (loadError) {
    return (
      <div className="page">
        <InlineError message={loadError} />
        <Button variant="secondary" onClick={() => navigate('/factures')}>
          Retour aux factures
        </Button>
      </div>
    );
  }

  return (
    <div className="page editor-page">
      <button type="button" className="back-link" onClick={() => navigate(draftId ? `/factures/${draftId}` : '/factures')}>
        <ArrowLeft size={14} /> {draftId ? 'Retour au brouillon' : 'Retour aux factures'}
      </button>

      <PageHeader
        eyebrow={isCredit ? 'Avoir' : draftId ? 'Modification' : 'Nouvelle facture'}
        title={isCredit ? 'Créer un avoir' : draftId ? 'Modifier le brouillon' : 'Créer une facture'}
        subtitle={
          <>
            {isCredit
              ? 'Un avoir corrige une facture émise. Il est numéroté séparément et ne peut jamais dépasser le solde créditable.'
              : 'Le numéro définitif est attribué uniquement à l’émission, sans rupture de séquence.'}{' '}
            <span className="next-number">
              Prochain numéro <strong>{numberPreview ?? '—'}</strong>
            </span>
          </>
        }
        actions={
          <>
            <Button variant="secondary" icon={<FileText size={15} />} onClick={() => setPreviewOpen(true)}>
              Aperçu
            </Button>
            <Button variant="ghost" icon={<Save size={15} />} loading={saving} onClick={() => void saveDraft()}>
              Enregistrer
            </Button>
            <Button
              icon={<Send size={15} />}
              loading={issuing}
              disabled={!canIssue || Boolean(report && !report.canIssue)}
              title={canIssue ? 'Émettre le document' : 'Complétez les mentions obligatoires pour émettre'}
              onClick={() => void issue()}
            >
              {isCredit ? 'Émettre l’avoir' : 'Émettre la facture'}
            </Button>
          </>
        }
      />

      {franchise ? (
        <div className="info-banner">
          <Info size={17} />
          <div>
            <strong>Régime de TVA : {settings?.fiscal.regime === 'franchise' ? 'franchise en base' : 'exonération'}</strong>
            <p>
              Aucune TVA ne peut être facturée. La mention « {settings?.fiscal.franchiseMention || settings?.fiscal.exemptionReason} »
              sera imprimée sur le document.
            </p>
          </div>
        </div>
      ) : null}

      {isCredit ? (
        <Card className="credit-banner">
          <div className="credit-banner-grid">
            <Field label="Facture d'origine" required hint="Seules les factures émises peuvent faire l'objet d'un avoir.">
              <Select
                value={sourceInvoiceId ?? ''}
                onChange={(event) => setSourceInvoiceId(event.target.value || null)}
                disabled={Boolean(draftId)}
              >
                <option value="">Sélectionner une facture…</option>
                {availableSources.map((invoice) => (
                  <option key={invoice.id} value={invoice.id}>
                    {invoice.number} · {invoice.clientName} · {euro(invoice.balanceCents)} créditables
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Motif de l'avoir" required hint="Motif repris dans le document et le journal d'audit.">
              <TextInput
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Retour de marchandise, erreur de facturation, geste commercial…"
                maxLength={500}
              />
            </Field>
            {sourceInvoice ? (
              <div className="credit-source">
                <FileMinus2 size={18} />
                <div>
                  <strong>{sourceInvoice.number}</strong>
                  <p>
                    {sourceInvoice.clientSnapshot.displayName} · total TTC {euro(sourceInvoice.totals.totalTtcCents)} ·
                    créditable {euro(creditableCents)}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <div className="editor-layout">
        <div className="editor-main">
          <Card>
            <CardHeader
              title="Client"
              subtitle="La fiche client est figée sur le document au moment de l’émission."
              actions={
                <Button size="sm" variant="secondary" icon={<UserPlus size={14} />} onClick={() => setClientPickerOpen(true)}>
                  {client ? 'Changer' : 'Choisir un client'}
                </Button>
              }
            />
            <div className="card-body">
              {client ? (
                <div className="client-selected">
                  <div>
                    <strong>{client.companyName || `${client.firstName} ${client.lastName}`.trim()}</strong>
                    <p>
                      {[client.address.line1, `${client.address.postalCode} ${client.address.city}`.trim(), client.address.country]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="paper-ids">
                      {client.siren ? `SIREN ${client.siren}` : ''}
                      {client.vatNumber ? ` · TVA ${client.vatNumber}` : ''}
                      {client.email ? ` · ${client.email}` : ''}
                    </p>
                  </div>
                  <button type="button" className="link-button" onClick={() => setClientPickerOpen(true)}>
                    Modifier la sélection
                  </button>
                </div>
              ) : (
                <button type="button" className="client-empty" onClick={() => setClientPickerOpen(true)}>
                  <span className="client-empty-icon">
                    <UserPlus size={18} />
                  </span>
                  <div>
                    <strong>Sélectionner un client</strong>
                    <p>Obligatoire pour émettre la facture. Vous pouvez en créer un à la volée.</p>
                  </div>
                  <ChevronDown size={16} />
                </button>
              )}

              <div className="form-grid">
                <Field label="Adresse de facturation" className="span-2">
                  <div className="address-stack">
                    <TextInput
                      value={billingAddress.line1}
                      onChange={(event) => setBillingAddress({ ...billingAddress, line1: event.target.value })}
                      placeholder="Adresse"
                    />
                    <div className="address-row">
                      <TextInput
                        value={billingAddress.postalCode}
                        onChange={(event) => setBillingAddress({ ...billingAddress, postalCode: event.target.value })}
                        placeholder="Code postal"
                      />
                      <TextInput
                        value={billingAddress.city}
                        onChange={(event) => setBillingAddress({ ...billingAddress, city: event.target.value })}
                        placeholder="Ville"
                      />
                      <TextInput
                        value={billingAddress.country}
                        onChange={(event) => setBillingAddress({ ...billingAddress, country: event.target.value })}
                        placeholder="Pays"
                      />
                    </div>
                    {client ? (
                      <button type="button" className="link-button" onClick={useClientAddress}>
                        Réinitialiser avec l’adresse du client
                      </button>
                    ) : null}
                  </div>
                </Field>
                <div className="span-2">
                  <Switch
                    checked={useDelivery}
                    onChange={setUseDelivery}
                    label="Adresse de livraison différente"
                    hint="Requise lorsque la prestation ou la livraison a lieu ailleurs."
                  />
                  {useDelivery ? (
                    <div className="address-stack">
                      <TextInput
                        value={deliveryAddress.line1}
                        onChange={(event) => setDeliveryAddress({ ...deliveryAddress, line1: event.target.value })}
                        placeholder="Adresse de livraison"
                      />
                      <div className="address-row">
                        <TextInput
                          value={deliveryAddress.postalCode}
                          onChange={(event) => setDeliveryAddress({ ...deliveryAddress, postalCode: event.target.value })}
                          placeholder="Code postal"
                        />
                        <TextInput
                          value={deliveryAddress.city}
                          onChange={(event) => setDeliveryAddress({ ...deliveryAddress, city: event.target.value })}
                          placeholder="Ville"
                        />
                        <TextInput
                          value={deliveryAddress.country}
                          onChange={(event) => setDeliveryAddress({ ...deliveryAddress, country: event.target.value })}
                          placeholder="Pays"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Informations du document" subtitle="Dates, nature de l’opération et conditions de règlement" />
            <div className="card-body">
              <div className="form-grid form-grid-4">
                <Field label="Date d'émission" required>
                  <TextInput
                    type="date"
                    value={issueDate}
                    onChange={(event) => {
                      setIssueDate(event.target.value);
                      if (event.target.value) setDueDate(dueDateFromTerms(event.target.value, termsDays));
                    }}
                  />
                </Field>
                <Field label="Échéance" required>
                  <TextInput type="date" value={dueDate} min={issueDate} onChange={(event) => setDueDate(event.target.value)} />
                </Field>
                <Field label="Date de prestation" required>
                  <TextInput type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} />
                </Field>
                <Field label="Bon de commande">
                  <TextInput
                    value={purchaseOrder}
                    onChange={(event) => setPurchaseOrder(event.target.value)}
                    placeholder="PO-2026-042"
                    maxLength={100}
                  />
                </Field>
                <Field label="Nature de l'opération" required className="span-2">
                  <Select value={operationNature} onChange={(event) => setOperationNature(event.target.value as OperationNature)}>
                    {Object.entries(OPERATION_NATURE_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Moyen de règlement" required>
                  <Select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method.value} value={method.value}>
                        {method.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Conditions de règlement">
                  <TextInput value={paymentTerms} onChange={(event) => setPaymentTerms(event.target.value)} maxLength={500} />
                </Field>
                <Field label="Objet / description" className="span-4">
                  <Textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={2}
                    placeholder="Étude et développement du module de facturation…"
                    maxLength={4000}
                  />
                </Field>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Lignes du document"
              subtitle={`${lines.length} ligne${lines.length > 1 ? 's' : ''} · remises, TVA et frais annexes`}
              actions={
                <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => addLine()}>
                  Ajouter une ligne
                </Button>
              }
            />
            <div className="card-body card-body-flush">
              <div className="line-table">
                {lines.map((line, index) => {
                  const computedLine = computed.lines[index];
                  return (
                    <div className={`line-row ${line.isExtraFee ? 'is-extra' : ''}`.trim()} key={line.key}>
                      <div className="line-designation">
                        <TextInput
                          value={line.designation}
                          onChange={(event) => updateLine(line.key, { designation: event.target.value })}
                          placeholder={line.isExtraFee ? 'Frais de port, emballage…' : 'Désignation de la prestation'}
                          aria-label="Désignation"
                        />
                        <div className="line-subfields">
                          <TextInput
                            value={line.description}
                            onChange={(event) => updateLine(line.key, { description: event.target.value })}
                            placeholder="Description complémentaire (optionnelle)"
                            aria-label="Description"
                          />
                          <TextInput
                            value={line.reference}
                            onChange={(event) => updateLine(line.key, { reference: event.target.value })}
                            placeholder="Réf."
                            aria-label="Référence"
                            className="input-ref"
                          />
                        </div>
                        {line.isExtraFee ? <span className="line-tag">Frais annexe</span> : null}
                      </div>
                      <div className="line-field">
                        <span className="line-label">Qté</span>
                        <QuantityInput value={line.quantity} onChange={(value) => updateLine(line.key, { quantity: value })} />
                      </div>
                      <div className="line-field">
                        <span className="line-label">Unité</span>
                        <Select value={line.unit} onChange={(event) => updateLine(line.key, { unit: event.target.value })} aria-label="Unité">
                          {Array.from(new Set([line.unit || 'unité', ...UNITS])).map((unit) => (
                            <option key={unit} value={unit}>
                              {unit}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="line-field">
                        <span className="line-label">P. U. HT</span>
                        <MoneyInput value={line.unitPriceCents} onChange={(value) => updateLine(line.key, { unitPriceCents: value })} ariaLabel="Prix unitaire HT" />
                      </div>
                      <div className="line-field discount-cell">
                        <span className="line-label">Remise</span>
                        <div className="discount-inputs">
                        <Select
                          value={line.discountType}
                          onChange={(event) => updateLine(line.key, { discountType: event.target.value as DiscountType, discountValue: 0 })}
                          aria-label="Type de remise"
                          className="select-mini"
                        >
                          <option value="none">—</option>
                          <option value="percent">%</option>
                          <option value="amount">€</option>
                        </Select>
                        {line.discountType === 'percent' ? (
                          <PercentInput valueBp={line.discountValue} onChange={(value) => updateLine(line.key, { discountValue: Math.min(value, 10_000) })} ariaLabel="Remise en pourcentage" />
                        ) : line.discountType === 'amount' ? (
                          <MoneyInput value={line.discountValue} onChange={(value) => updateLine(line.key, { discountValue: value })} ariaLabel="Remise en euros" />
                        ) : null}
                        </div>
                      </div>
                      <div className="line-field">
                        <span className="line-label">TVA</span>
                        <Select
                          value={String(line.vatRateBp)}
                          onChange={(event) => updateLine(line.key, { vatRateBp: Number(event.target.value) })}
                          aria-label="Taux de TVA"
                          disabled={franchise}
                        >
                          {vatOptions.map((rate) => (
                            <option key={rate} value={rate}>
                              {(rate / 100).toLocaleString('fr-FR')} %
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="line-total num">
                        <span className="line-label">Total HT</span>
                        <strong>{euro(computedLine?.netCents ?? 0)}</strong>
                        {line.discountType !== 'none' && computedLine?.discountCents ? (
                          <span className="line-discount">−{euro(computedLine.discountCents)}</span>
                        ) : null}
                      </div>
                      <div className="line-remove">
                        <IconButton label="Supprimer la ligne" className="is-danger" onClick={() => removeLine(line.key)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="line-footer">
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => addLine()}>
                  Ajouter une ligne
                </Button>
                <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => addLine(true)}>
                  Ajouter des frais annexes
                </Button>
              </div>
            </div>
          </Card>

          <div className="editor-two">
            <Card>
              <CardHeader title="Remise globale" subtitle="Répartie au prorata sur toutes les lignes" />
              <div className="card-body">
                <div className="global-discount">
                  <Select
                    value={globalDiscountType}
                    onChange={(event) => {
                      setGlobalDiscountType(event.target.value as DiscountType);
                      setGlobalDiscountValue(0);
                    }}
                    aria-label="Type de remise globale"
                  >
                    <option value="none">Aucune remise</option>
                    <option value="percent">Pourcentage</option>
                    <option value="amount">Montant fixe</option>
                  </Select>
                  {globalDiscountType === 'percent' ? (
                    <PercentInput valueBp={globalDiscountValue} onChange={(value) => setGlobalDiscountValue(Math.min(value, 10_000))} />
                  ) : globalDiscountType === 'amount' ? (
                    <MoneyInput value={globalDiscountValue} onChange={setGlobalDiscountValue} />
                  ) : null}
                </div>
                <p className="field-hint">La remise globale ne modifie jamais le total TTC au-delà du HT facturé.</p>
              </div>
            </Card>
            <Card>
              <CardHeader title="Notes" subtitle="Mention libre imprimée sous les coordonnées bancaires" />
              <div className="card-body">
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Merci de votre confiance."
                  maxLength={4000}
                />
              </div>
            </Card>
          </div>
        </div>

        <aside className="editor-aside">
          <Card className="totals-card">
            <CardHeader title="Totaux" subtitle="Calcul exact au centime" />
            <div className="card-body">
              <div className="totals-lines">
                <div>
                  <span>Sous-total HT</span>
                  <strong>{euro(computed.totals.subtotalCents)}</strong>
                </div>
                {computed.totals.lineDiscountCents > 0 ? (
                  <div>
                    <span>Remises de ligne</span>
                    <strong>−{euro(computed.totals.lineDiscountCents)}</strong>
                  </div>
                ) : null}
                {computed.totals.globalDiscountCents > 0 ? (
                  <div>
                    <span>Remise globale</span>
                    <strong>−{euro(computed.totals.globalDiscountCents)}</strong>
                  </div>
                ) : null}
                <div>
                  <span>Total HT</span>
                  <strong>{euro(computed.totals.totalHtCents)}</strong>
                </div>
                {computed.totals.vatBreakdown.length === 0 ? (
                  <div>
                    <span>TVA</span>
                    <strong>{franchise ? 'Non applicable' : euro(0)}</strong>
                  </div>
                ) : (
                  computed.totals.vatBreakdown.map((entry) => (
                    <div key={entry.rateBp}>
                      <span>TVA {(entry.rateBp / 100).toLocaleString('fr-FR')} %</span>
                      <strong>{euro(entry.vatCents)}</strong>
                    </div>
                  ))
                )}
              </div>
              <div className="editor-total-ttc">
                <span>{isCredit ? 'Total avoir TTC' : 'Total TTC'}</span>
                <strong>{euro(computed.totals.totalTtcCents)}</strong>
              </div>
              {isCredit && sourceInvoice ? (
                <p className={`credit-limit ${computed.totals.totalTtcCents > creditableCents ? 'is-over' : ''}`}>
                  Créditable sur la facture d’origine : {euro(creditableCents)}
                </p>
              ) : null}
              <div className="totals-actions">
                <Button variant="secondary" block icon={<FileText size={15} />} onClick={() => setPreviewOpen(true)}>
                  Aperçu avant émission
                </Button>
                <Button
                  block
                  icon={<Send size={15} />}
                  loading={issuing}
                  disabled={Boolean(report && !report.canIssue)}
                  onClick={() => void issue()}
                >
                  {isCredit ? 'Émettre l’avoir' : 'Émettre la facture'}
                </Button>
              </div>
              <p className="totals-note">
                {report && !report.canIssue
                  ? `${report.blockingCount} point${report.blockingCount > 1 ? 's' : ''} bloquant${report.blockingCount > 1 ? 's' : ''} à corriger`
                  : 'Le PDF est généré et archivé à l’émission.'}
              </p>
            </div>
          </Card>

          <CompliancePanel
            report={report}
            loading={checking}
            emptyMessage={
              clientId
                ? "Complétez le document pour lancer l'analyse."
                : 'Sélectionnez un client pour lancer le contrôle des mentions obligatoires.'
            }
          />
        </aside>
      </div>

      <Modal
        open={clientPickerOpen}
        onClose={() => setClientPickerOpen(false)}
        title="Sélectionner un client"
        subtitle="Recherchez par nom, société ou e-mail."
        size="md"
        footer={
          <>
            <Button
              variant="secondary"
              icon={<UserPlus size={14} />}
              onClick={() => {
                setClientPickerOpen(false);
                setNewClientOpen(true);
              }}
            >
              Nouveau client
            </Button>
            <Button variant="ghost" onClick={() => setClientPickerOpen(false)}>
              Fermer
            </Button>
          </>
        }
      >
        <ClientPicker clients={clients} selectedId={clientId} onSelect={chooseClient} />
      </Modal>

      <ClientDialog
        open={newClientOpen}
        client={null}
        onClose={() => setNewClientOpen(false)}
        onSaved={(created) => {
          setClients((current) => [created, ...current]);
          chooseClient(created);
        }}
      />

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Aperçu avant émission"
        subtitle="Les montants, mentions et adresses sont ceux du document en cours."
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => void savePreviewPdf()}>
              Enregistrer l’aperçu PDF
            </Button>
            <Button variant="secondary" onClick={() => setPreviewOpen(false)}>
              Fermer
            </Button>
          </>
        }
      >
        {previewData ? <InvoicePreview data={previewData} /> : null}
      </Modal>
    </div>
  );
}

function ClientPicker({
  clients,
  selectedId,
  onSelect,
}: {
  clients: Client[];
  selectedId: string | null;
  onSelect: (client: Client) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = clients.filter((client) => {
    const haystack = [client.companyName, client.firstName, client.lastName, client.email, client.address.city]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });
  return (
    <div className="client-picker">
      <TextInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher un client…"
        autoFocus
      />
      <ul>
        {filtered.map((client) => {
          const name = client.companyName || `${client.firstName} ${client.lastName}`.trim();
          return (
            <li key={client.id}>
              <button type="button" className={`client-option ${selectedId === client.id ? 'is-selected' : ''}`.trim()} onClick={() => onSelect(client)}>
                <span className="client-option-avatar">{name.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{name}</strong>
                  <small>
                    {client.siren ? `SIREN ${client.siren} · ` : ''}
                    {client.address.city || 'Adresse non renseignée'}
                  </small>
                </span>
                {selectedId === client.id ? <Check size={15} /> : null}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 ? <li className="client-picker-empty">Aucun client trouvé.</li> : null}
      </ul>
    </div>
  );
}
