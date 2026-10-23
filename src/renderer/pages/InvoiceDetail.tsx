import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Eye,
  FileMinus2,
  FileText,
  MailCheck,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { ComplianceReport, Invoice, Payment, PaymentMethod } from '@shared/types';
import { PAYMENT_METHODS, formatAddressLines } from '@shared/constants';
import { todayISO } from '@shared/dates';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync } from '../lib/hooks';
import { euro, formatDateFR, formatDateTimeFR } from '../lib/format';
import { Link, navigate, useRoute } from '../lib/router';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Field,
  IconButton,
  InlineError,
  InfoRow,
  LoadingBlock,
  Modal,
  MoneyInput,
  PageHeader,
  Select,
  StatusBadge,
  TextInput,
  Textarea,
} from '../components/ui';
import { InvoicePreview } from '../components/InvoicePreview';
import { CompliancePanel } from '../components/CompliancePanel';

interface Loaded {
  invoice: Invoice;
  payments: Payment[];
  report: ComplianceReport;
  creditNotes: Awaited<ReturnType<typeof api.invoices.creditNotes>>;
}

export function InvoiceDetailPage() {
  const route = useRoute();
  const toast = useToast();
  const { bumpData } = useAppData();
  const id = route.pathname.split('/')[2] ?? '';
  const [previewOpen, setPreviewOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [integrity, setIntegrity] = useState<boolean | null>(null);

  const { data, loading, error, reload } = useAsync<Loaded>(async () => {
    const invoice = await api.invoices.get(id);
    const [payments, report, creditNotes] = await Promise.all([
      api.payments.byInvoice(id),
      api.invoices.validate(id),
      api.invoices.creditNotes(id),
    ]);
    return { invoice, payments, report, creditNotes };
  }, [id]);

  const previewData = useMemo(() => {
    if (!data) return null;
    const invoice = data.invoice;
    return {
      type: invoice.type,
      number: invoice.number,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      serviceDate: invoice.serviceDate,
      purchaseOrder: invoice.purchaseOrder,
      operationNature: invoice.operationNature,
      description: invoice.description,
      paymentTerms: invoice.paymentTerms,
      paymentMethod: invoice.paymentMethod,
      notes: invoice.notes,
      client: invoice.clientSnapshot,
      seller: invoice.sellerSnapshot,
      legal: invoice.legalSnapshot,
      billingAddress: invoice.billingAddress,
      deliveryAddress: invoice.deliveryAddress,
      lines: invoice.lines,
      totals: invoice.totals,
      globalDiscountType: invoice.globalDiscountType,
      globalDiscountValue: invoice.globalDiscountValue,
      draft: invoice.status === 'draft',
      sourceInvoiceNumber: invoice.sourceInvoiceNumber,
    };
  }, [data]);

  if (loading && !data) {
    return (
      <div className="page">
        <LoadingBlock label="Ouverture du document…" height={420} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page">
        <InlineError message={errorMessage(error)} onRetry={reload} />
        <Link to="/factures">
          <Button variant="secondary" icon={<ArrowLeft size={15} />}>
            Retour aux factures
          </Button>
        </Link>
      </div>
    );
  }

  if (!data) return null;
  const { invoice, payments, report, creditNotes } = data;
  const isDraft = invoice.status === 'draft';
  const isCredit = invoice.type === 'credit_note';
  const canPay = !isDraft && !isCredit && invoice.balanceCents > 0;
  const settled = !isCredit && invoice.balanceCents <= 0 && !isDraft;

  const withReload = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      bumpData();
      reload();
    } catch (reason) {
      toast.error('Opération impossible', errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const markSent = () =>
    withReload(async () => {
      await api.invoices.markSent(invoice.id);
      toast.success('Facture marquée comme envoyée', 'La date d’envoi est enregistrée dans le journal.');
    });

  const savePdf = async () => {
    try {
      const result = await api.invoices.saveAs(invoice.id);
      if (!result.canceled) toast.success('PDF enregistré', result.path);
    } catch (reason) {
      toast.error('Enregistrement impossible', errorMessage(reason));
    }
  };

  const printPdf = async () => {
    try {
      const result = await api.invoices.print(invoice.id);
      if (result.printed) toast.success('Impression lancée', invoice.number ?? '');
      else if (result.opened) toast.info('PDF ouvert', 'Utilisez votre lecteur PDF pour imprimer.');
      else toast.error('Impression impossible');
    } catch (reason) {
      toast.error('Impression impossible', errorMessage(reason));
    }
  };

  const openPdf = async () => {
    try {
      await api.invoices.open(invoice.id);
    } catch (reason) {
      toast.error('Ouverture impossible', errorMessage(reason));
    }
  };

  const checkIntegrity = async () => {
    try {
      const result = await api.invoices.readPdf(invoice.id);
      setIntegrity(result.integrity);
      if (result.integrity) toast.success('PDF intègre', 'L’empreinte SHA-256 correspond à l’original archivé.');
      else toast.error('PDF modifié', 'Le fichier ne correspond plus à l’empreinte d’origine.');
    } catch (reason) {
      toast.error('Vérification impossible', errorMessage(reason));
    }
  };

  const createCreditNote = () => {
    navigate(`/factures/nouvelle?type=credit_note&source=${invoice.id}`);
  };

  return (
    <div className="page">
      <Link to="/factures" className="back-link">
        <ArrowLeft size={14} /> Toutes les factures
      </Link>
      <PageHeader
        eyebrow={isCredit ? 'Avoir' : 'Facture'}
        title={invoice.number ?? 'Brouillon'}
        subtitle={`${invoice.clientSnapshot.displayName} · ${formatDateFR(invoice.issueDate)}`}
        actions={
          <>
            {isDraft ? (
              <>
                <Button variant="secondary" icon={<Eye size={15} />} onClick={() => setPreviewOpen(true)}>
                  Aperçu
                </Button>
                <Button
                  icon={<Pencil size={15} />}
                  onClick={() => navigate(`/factures/${invoice.id}/modifier`)}
                >
                  Modifier le brouillon
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" icon={<Eye size={15} />} onClick={() => setPreviewOpen(true)}>
                  Aperçu
                </Button>
                <Button variant="secondary" icon={<Download size={15} />} onClick={savePdf}>
                  Télécharger
                </Button>
                <Button variant="secondary" icon={<Printer size={15} />} onClick={printPdf}>
                  Imprimer
                </Button>
                {canPay ? (
                  <Button icon={<CreditCard size={15} />} onClick={() => setPaymentOpen(true)}>
                    Encaisser
                  </Button>
                ) : null}
              </>
            )}
          </>
        }
      />

      <div className="detail-layout">
        <div className="detail-main">
          <Card className="document-summary">
            <div className="document-summary-head">
              <div className="document-title">
                <span className="doc-type-icon">{isCredit ? <FileMinus2 size={20} /> : <FileText size={20} />}</span>
                <div>
                  <h2>{invoice.number ?? 'Document en brouillon'}</h2>
                  <p>
                    {isCredit ? 'Avoir' : 'Facture'} ·{' '}
                    {invoice.number ? `émis le ${formatDateFR(invoice.issueDate)}` : 'modifiable jusqu’à l’émission'}
                  </p>
                </div>
              </div>
              <StatusBadge status={invoice.effectiveStatus ?? invoice.status} />
            </div>

            <div className="document-parties">
              <div>
                <p className="paper-label">Client</p>
                <strong>{invoice.clientSnapshot.displayName}</strong>
                {formatAddressLines(invoice.billingAddress).map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {invoice.clientSnapshot.siren ? <p className="paper-ids">SIREN {invoice.clientSnapshot.siren}</p> : null}
                {invoice.clientSnapshot.vatNumber ? (
                  <p className="paper-ids">TVA {invoice.clientSnapshot.vatNumber}</p>
                ) : null}
              </div>
              <div>
                <p className="paper-label">Émetteur</p>
                <strong>{invoice.sellerSnapshot.displayName}</strong>
                {formatAddressLines(invoice.sellerSnapshot.address).map((line) => (
                  <p key={line}>{line}</p>
                ))}
                {invoice.sellerSnapshot.siren ? (
                  <p className="paper-ids">SIREN {invoice.sellerSnapshot.siren}</p>
                ) : null}
              </div>
              <div className="document-dates">
                <InfoRow label="Émission" value={formatDateFR(invoice.issueDate)} />
                {/* Un avoir n'a ni échéance ni conditions de règlement : il
                    s'impute sur la facture d'origine qu'il référence. */}
                {isCredit ? (
                  <InfoRow label="Facture d’origine" value={invoice.sourceInvoiceNumber ?? '—'} />
                ) : (
                  <>
                    <InfoRow label="Échéance" value={formatDateFR(invoice.dueDate)} />
                    <InfoRow label="Prestation" value={formatDateFR(invoice.serviceDate)} />
                    <InfoRow
                      label="Règlement"
                      value={
                        invoice.paymentTerms ||
                        PAYMENT_METHODS.find((m) => m.value === invoice.paymentMethod)?.label ||
                        '—'
                      }
                    />
                  </>
                )}
              </div>
            </div>

            <div className="document-lines">
              <table className="table">
                <thead>
                  <tr>
                    <th>Désignation</th>
                    <th className="num">Qté</th>
                    <th className="num">P.U. HT</th>
                    <th className="num">TVA</th>
                    <th className="num">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line.id}>
                      <td>
                        <div className="doc-meta">
                          <strong>{line.designation}</strong>
                          {line.description ? <span>{line.description}</span> : null}
                        </div>
                      </td>
                      <td className="num">
                        {line.quantity.toLocaleString('fr-FR')} {line.unit}
                      </td>
                      <td className="num">{euro(line.unitPriceCents)}</td>
                      <td className="num">{(line.vatRateBp / 100).toLocaleString('fr-FR')} %</td>
                      <td className="num strong">{euro(line.netCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="document-totals">
              <div>
                <InfoRow label="Sous-total HT" value={euro(invoice.totals.subtotalCents)} />
                {invoice.totals.globalDiscountCents > 0 ? (
                  <InfoRow label="Remise globale" value={`−${euro(invoice.totals.globalDiscountCents)}`} />
                ) : null}
                <InfoRow label="Total HT" value={euro(invoice.totals.totalHtCents)} />
                {invoice.totals.vatBreakdown.length > 0 ? (
                  invoice.totals.vatBreakdown.map((entry) => (
                    <InfoRow
                      key={entry.rateBp}
                      label={`TVA ${(entry.rateBp / 100).toLocaleString('fr-FR')} %`}
                      value={euro(entry.vatCents)}
                    />
                  ))
                ) : (
                  <InfoRow label="TVA" value="0,00 €" />
                )}
                <div className="total-ttc-row">
                  <span>{isCredit ? 'Total avoir TTC' : 'Total TTC'}</span>
                  <strong>{euro(invoice.totals.totalTtcCents)}</strong>
                </div>
                {!isCredit ? (
                  <>
                    <InfoRow label="Déjà payé" value={euro(invoice.paidCents)} />
                    {invoice.creditedCents > 0 ? (
                      <InfoRow label="Avoirs émis" value={`−${euro(invoice.creditedCents)}`} />
                    ) : null}
                    <InfoRow label="Solde dû" value={euro(invoice.balanceCents)} />
                  </>
                ) : null}
              </div>
            </div>
          </Card>

          {!isCredit ? (
            <Card>
              <CardHeader
                title="Paiements"
                subtitle={`${payments.length} règlement${payments.length > 1 ? 's' : ''} enregistré${payments.length > 1 ? 's' : ''}`}
                actions={
                  canPay ? (
                    <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => setPaymentOpen(true)}>
                      Encaisser
                    </Button>
                  ) : null
                }
              />
              <div className="card-body card-body-flush">
                {payments.length === 0 ? (
                  <p className="empty-inline">
                    {settled
                      ? 'Facture soldée par avoir, aucun paiement encaissé.'
                      : 'Aucun paiement enregistré pour cette facture.'}
                  </p>
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Mode</th>
                        <th>Référence</th>
                        <th className="num">Montant</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((payment) => (
                        <tr key={payment.id}>
                          <td>{formatDateFR(payment.date)}</td>
                          <td>{PAYMENT_METHODS.find((method) => method.value === payment.method)?.label ?? payment.method}</td>
                          <td className="muted">{payment.reference || payment.note || '—'}</td>
                          <td className="num strong">{euro(payment.amountCents)}</td>
                          <td>
                            <div className="table-actions">
                              <IconButton
                                label="Supprimer le paiement"
                                className="is-danger"
                                onClick={() =>
                                  withReload(async () => {
                                    await api.payments.remove(payment.id);
                                    toast.success('Paiement supprimé', 'Le statut de la facture a été recalculé.');
                                  })
                                }
                              >
                                <Trash2 size={14} />
                              </IconButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>
          ) : null}

          {creditNotes.length > 0 ? (
            <Card>
              <CardHeader title="Avoirs liés" subtitle="Documents de correction rattachés à cette facture" />
              <div className="card-body card-body-flush">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Avoir</th>
                      <th>Date</th>
                      <th>Motif</th>
                      <th className="num">Montant TTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creditNotes.map((credit) => (
                      <tr key={credit.id} className="is-clickable" onClick={() => navigate(`/factures/${credit.id}`)}>
                        <td className="strong">{credit.number}</td>
                        <td>{formatDateFR(credit.issueDate)}</td>
                        <td className="muted">Avoir émis</td>
                        <td className="num strong">{euro(credit.totalTtcCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {isCredit && invoice.sourceInvoiceNumber ? (
            <Card>
              <CardHeader title="Facture d'origine" subtitle="Document corrigé par cet avoir" />
              <div className="card-body">
                <div className="source-invoice">
                  <FileText size={18} />
                  <div>
                    <strong>{invoice.sourceInvoiceNumber}</strong>
                    <p>{invoice.reason || 'Aucun motif renseigné'}</p>
                  </div>
                  {invoice.sourceInvoiceId ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(`/factures/${invoice.sourceInvoiceId}`)}
                    >
                      Ouvrir
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ) : null}
        </div>

        <aside className="detail-aside">
          <Card>
            <CardHeader title="Document" subtitle="Actions et traçabilité" />
            <div className="card-body">
              <div className="aside-actions">
                {isDraft ? (
                  <Button variant="primary" block icon={<Pencil size={15} />} onClick={() => navigate(`/factures/${invoice.id}/modifier`)}>
                    Continuer la rédaction
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" block icon={<Download size={15} />} onClick={savePdf}>
                      Enregistrer le PDF
                    </Button>
                    <Button variant="ghost" block icon={<Printer size={15} />} onClick={printPdf}>
                      Imprimer
                    </Button>
                    <Button variant="ghost" block icon={<FileText size={15} />} onClick={openPdf}>
                      Ouvrir dans le lecteur PDF
                    </Button>
                    {invoice.status === 'issued' ? (
                      <Button variant="ghost" block icon={<MailCheck size={15} />} loading={busy} onClick={markSent}>
                        {isCredit ? 'Marquer comme transmis' : 'Marquer comme envoyée'}
                      </Button>
                    ) : null}
                  </>
                )}
                {!isCredit && invoice.status !== 'draft' ? (
                  <Button variant="soft" block icon={<FileMinus2 size={15} />} onClick={createCreditNote}>
                    Créer un avoir
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  block
                  icon={<Copy size={15} />}
                  onClick={() =>
                    withReload(async () => {
                      const copy = await api.invoices.duplicate(invoice.id);
                      toast.success('Brouillon créé à partir du document');
                      navigate(`/factures/${copy.id}/modifier`);
                    })
                  }
                >
                  Dupliquer en brouillon
                </Button>
                {isDraft ? (
                  <Button variant="danger" block icon={<Trash2 size={15} />} onClick={() => setDeleteOpen(true)}>
                    Supprimer le brouillon
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Traçabilité" subtitle="Horodatage local" />
            <div className="card-body">
              <ul className="timeline">
                <li className="is-done">
                  <span />
                  <div>
                    <strong>Créé</strong>
                    <p>{formatDateTimeFR(invoice.createdAt)}</p>
                  </div>
                </li>
                <li className={invoice.issuedAt ? 'is-done' : ''}>
                  <span />
                  <div>
                    <strong>Émis</strong>
                    <p>{invoice.issuedAt ? formatDateTimeFR(invoice.issuedAt) : 'Non émis'}</p>
                  </div>
                </li>
                <li className={invoice.sentAt ? 'is-done' : ''}>
                  <span />
                  <div>
                    <strong>{isCredit ? 'Transmis' : 'Envoyé'}</strong>
                    <p>
                      {invoice.sentAt
                        ? formatDateTimeFR(invoice.sentAt)
                        : isCredit
                          ? 'Non transmis'
                          : 'Non envoyé'}
                    </p>
                  </div>
                </li>
                {/* Un avoir n'a pas de solde à solder : il réduit celui de la facture d'origine. */}
                {isCredit ? (
                  <li className="is-done">
                    <span />
                    <div>
                      <strong>Crédité</strong>
                      <p>{euro(invoice.totals.totalTtcCents)} sur la facture d’origine</p>
                    </div>
                  </li>
                ) : (
                  <li className={settled ? 'is-done' : ''}>
                    <span />
                    <div>
                      <strong>Soldé</strong>
                      <p>{settled ? 'Solde nul' : `Reste ${euro(invoice.balanceCents)}`}</p>
                    </div>
                  </li>
                )}
              </ul>
              {invoice.pdf ? (
                <div className="pdf-meta">
                  <div className="pdf-meta-head">
                    <span>PDF archivé</span>
                    <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={checkIntegrity}>
                      Vérifier
                    </Button>
                  </div>
                  <p className="mono">SHA-256 {invoice.pdf.sha256.slice(0, 16)}…</p>
                  <p>{formatDateTimeFR(invoice.pdf.generatedAt)}</p>
                  {integrity !== null ? (
                    <p className={integrity ? 'text-ok' : 'text-danger'}>
                      {integrity ? (
                        <>
                          <CheckCircle2 size={13} /> Intégrité vérifiée
                        </>
                      ) : (
                        'Fichier modifié depuis l’émission'
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          </Card>

          <CompliancePanel report={report} title="Conformité du document" />
        </aside>
      </div>

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Aperçu du document"
        subtitle={isDraft ? 'Aperçu filigrané — le numéro définitif sera attribué à l’émission.' : `Rendu de ${invoice.number}`}
        size="xl"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  const preview = await api.invoices.preview({ id: invoice.id });
                  await api.savePreviewPdf(preview.base64, preview.fileName);
                  toast.success('Aperçu PDF enregistré');
                } catch (reason) {
                  toast.error('Enregistrement impossible', errorMessage(reason));
                }
              }}
            >
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

      <PaymentDialog
        open={paymentOpen}
        invoice={invoice}
        onClose={() => setPaymentOpen(false)}
        onSaved={() => {
          setPaymentOpen(false);
          bumpData();
          reload();
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Supprimer ce brouillon ?"
        description="Cette action est définitive. Aucun numéro définitif n'a été consommé."
        confirmLabel="Supprimer"
        danger
        loading={busy}
        onConfirm={() =>
          withReload(async () => {
            await api.invoices.deleteDraft(invoice.id);
            toast.success('Brouillon supprimé');
            navigate('/factures');
          })
        }
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}

export function PaymentDialog({
  open,
  invoice,
  onClose,
  onSaved,
}: {
  open: boolean;
  invoice: Invoice;
  onClose: () => void;
  onSaved: (payment?: Payment) => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(invoice.balanceCents);
  const [method, setMethod] = useState<PaymentMethod>('virement');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(todayISO());
    setAmount(invoice.balanceCents);
    setMethod('virement');
    setReference('');
    setNote('');
  }, [open, invoice.id, invoice.balanceCents]);

  const submit = async () => {
    if (amount <= 0) {
      toast.error('Montant invalide', 'Le montant doit être supérieur à zéro.');
      return;
    }
    setSaving(true);
    try {
      const payment = await api.payments.create({
        invoiceId: invoice.id,
        date,
        amountCents: amount,
        method,
        reference: reference.trim(),
        note: note.trim(),
      });
      toast.success('Paiement enregistré', `${euro(amount)} · ${invoice.number ?? ''}`);
      setAmount(invoice.balanceCents - amount);
      setReference('');
      setNote('');
      onSaved(payment);
    } catch (reason) {
      toast.error('Paiement refusé', errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Encaisser un paiement"
      subtitle={`${invoice.number ?? 'Facture'} · solde dû ${euro(invoice.balanceCents)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Annuler
          </Button>
          <Button onClick={submit} loading={saving}>
            Enregistrer le paiement
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Date du règlement" required>
          <TextInput type="date" value={date} max={todayISO()} onChange={(event) => setDate(event.target.value)} />
        </Field>
        <Field label="Montant encaissé" required hint={`Solde restant : ${euro(invoice.balanceCents)}`}>
          <MoneyInput value={amount} onChange={setAmount} ariaLabel="Montant encaissé" />
        </Field>
        <Field label="Moyen de paiement" required>
          <Select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Référence">
          <TextInput
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="N° de virement, chèque…"
          />
        </Field>
        <Field label="Note interne" className="span-2">
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
        </Field>
      </div>
      <div className="payment-quick">
        {[25, 50, 100].map((percent) => (
          <button
            key={percent}
            type="button"
            className="quick-chip"
            onClick={() => setAmount(Math.round((invoice.balanceCents * percent) / 100))}
          >
            {percent === 100 ? 'Solde total' : `${percent} %`}
            <span>
              {euro(Math.round((invoice.balanceCents * percent) / 100))}
            </span>
          </button>
        ))}
      </div>
      <p className="modal-note">
        {euro(invoice.paidCents)} déjà réglés sur {euro(invoice.totals.totalTtcCents)}. Un paiement supérieur au
        solde restant est refusé.
      </p>
    </Modal>
  );
}
