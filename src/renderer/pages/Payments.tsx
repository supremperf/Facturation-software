import { useState } from 'react';
import { CreditCard, Plus, Search, Trash2, Wallet } from 'lucide-react';
import type { Invoice, InvoiceSummary } from '@shared/types';
import { PAYMENT_METHODS } from '@shared/constants';
import { todayISO } from '@shared/dates';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync, useDebounced } from '../lib/hooks';
import { euro, formatDateFR, numberFR } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineError,
  LoadingBlock,
  Modal,
  PageHeader,
  Pagination,
  SearchField,
  TextInput,
} from '../components/ui';
import { PaymentDialog } from './InvoiceDetail';

export function PaymentsPage() {
  const toast = useToast();
  const { dataVersion, bumpData } = useAppData();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 250);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [choosing, setChoosing] = useState(false);
  const [target, setTarget] = useState<Invoice | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(
    () =>
      api.payments.list({
        query: debounced.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        page,
        pageSize: 20,
      }),
    [debounced, dateFrom, dateTo, page, dataVersion],
  );

  const { data: stats } = useAsync(() => api.stats(Number(todayISO().slice(0, 4))), [dataVersion]);
  const payments = data?.items ?? [];
  const pageTotal = payments.reduce((sum, payment) => sum + payment.amountCents, 0);

  const openPayment = async (invoiceId: string) => {
    try {
      const invoice = await api.invoices.get(invoiceId);
      setTarget(invoice);
      setChoosing(false);
    } catch (reason) {
      toast.error('Facture introuvable', errorMessage(reason));
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Gestion"
        title="Paiements"
        subtitle="Chaque encaissement recalcule le solde et le statut de la facture, sans jamais modifier le PDF émis."
        actions={
          <Button icon={<Plus size={16} />} onClick={() => setChoosing(true)}>
            Encaisser une facture
          </Button>
        }
      />

      <div className="mini-stats">
        <div className="mini-stat">
          <span className="mini-stat-icon success">
            <Wallet size={16} />
          </span>
          <div>
            <strong>{euro(stats?.totals.collectedCents ?? 0)}</strong>
            <p>encaissé en {todayISO().slice(0, 4)}</p>
          </div>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-icon warning">
            <CreditCard size={16} />
          </span>
          <div>
            <strong>{euro(stats?.totals.outstandingCents ?? 0)}</strong>
            <p>restant à encaisser</p>
          </div>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-icon accent">
            <CreditCard size={16} />
          </span>
          <div>
            <strong>{numberFR(data?.total ?? 0)}</strong>
            <p>règlements enregistrés</p>
          </div>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-icon info">
            <Search size={16} />
          </span>
          <div>
            <strong>{euro(pageTotal)}</strong>
            <p>total affiché sur cette page</p>
          </div>
        </div>
      </div>

      {error ? <InlineError message={errorMessage(error)} onRetry={reload} /> : null}

      <Card>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Facture, client, référence…" />
          <div className="toolbar-spacer" />
          <label className="inline-date">
            <span>Du</span>
            <input type="date" className="input" value={dateFrom} max={dateTo || todayISO()} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label className="inline-date">
            <span>Au</span>
            <input type="date" className="input" value={dateTo} min={dateFrom} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          {dateFrom || dateTo ? (
            <Button variant="ghost" size="sm" onClick={() => { setDateFrom(''); setDateTo(''); }}>
              Effacer
            </Button>
          ) : null}
        </div>

        {loading && !data ? (
          <LoadingBlock />
        ) : payments.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title={debounced || dateFrom || dateTo ? 'Aucun paiement pour ces critères' : 'Aucun paiement'}
            description="Enregistrez un encaissement depuis une facture émise. Les paiements partiels sont pris en charge et le statut est recalculé automatiquement."
            action={
              <Button icon={<Plus size={15} />} onClick={() => setChoosing(true)}>
                Encaisser une facture
              </Button>
            }
          />
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Facture</th>
                  <th>Client</th>
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
                    <td className="strong">{payment.invoiceNumber ?? '—'}</td>
                    <td>{payment.clientName}</td>
                    <td>{PAYMENT_METHODS.find((method) => method.value === payment.method)?.label ?? payment.method}</td>
                    <td className="muted">{payment.reference || payment.note || '—'}</td>
                    <td className="num strong">{euro(payment.amountCents)}</td>
                    <td>
                      <div className="table-actions">
                        <IconButton label="Supprimer le paiement" className="is-danger" onClick={() => setDeleting(payment.id)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={data?.page ?? 1}
              totalPages={data?.totalPages ?? 1}
              total={data?.total ?? 0}
              onPage={setPage}
            />
          </>
        )}
      </Card>

      <ChooseInvoiceModal
        open={choosing}
        onClose={() => setChoosing(false)}
        onChoose={openPayment}
      />

      {target ? (
        <PaymentDialog
          open={Boolean(target)}
          invoice={target}
          onClose={() => setTarget(null)}
          onSaved={() => {
            setTarget(null);
            bumpData();
            reload();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Supprimer ce paiement ?"
        description="Le règlement sera retiré et le solde de la facture recalculé. Cette opération est tracée dans le journal d'audit."
        confirmLabel="Supprimer le paiement"
        danger
        loading={busy}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy(true);
          try {
            await api.payments.remove(deleting);
            toast.success('Paiement supprimé');
            setDeleting(null);
            bumpData();
            reload();
          } catch (reason) {
            toast.error('Suppression impossible', errorMessage(reason));
          } finally {
            setBusy(false);
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

function ChooseInvoiceModal({
  open,
  onClose,
  onChoose,
}: {
  open: boolean;
  onClose: () => void;
  onChoose: (invoiceId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 200);
  const { data, loading } = useAsync(
    () =>
      open
        ? api.invoices.list({ status: 'all', query: debounced.trim() || undefined, pageSize: 50, sortBy: 'issueDate', sortDir: 'asc' })
        : Promise.resolve({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1 }),
    [open, debounced],
  );
  const candidates = (data?.items ?? []).filter(
    (invoice: InvoiceSummary) =>
      invoice.type === 'invoice' && invoice.status !== 'draft' && invoice.status !== 'cancelled' && invoice.balanceCents > 0,
  );

  return (
    <Modal open={open} onClose={onClose} title="Encaisser une facture" subtitle="Sélectionnez une facture dont le solde est supérieur à zéro." size="md">
      <TextInput
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher une facture ou un client…"
        autoFocus
      />
      <div className="invoice-picker">
        {loading ? (
          <LoadingBlock label="Chargement des factures…" height={120} />
        ) : candidates.length === 0 ? (
          <EmptyState
            compact
            icon={CreditCard}
            title="Aucune facture à encaisser"
            description="Toutes les factures émises sont soldées, ou aucune facture n’a encore été émise."
          />
        ) : (
          <ul>
            {candidates.map((invoice) => (
              <li key={invoice.id}>
                <button type="button" className="client-option" onClick={() => onChoose(invoice.id)}>
                  <span className="client-option-avatar">{invoice.number?.slice(-2) ?? 'FA'}</span>
                  <span>
                    <strong>
                      {invoice.number} · {invoice.clientName}
                    </strong>
                    <small>
                      Émise le {formatDateFR(invoice.issueDate)} · solde {euro(invoice.balanceCents)}
                    </small>
                  </span>
                  <b>{euro(invoice.balanceCents)}</b>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
