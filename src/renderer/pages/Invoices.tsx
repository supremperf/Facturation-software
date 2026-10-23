import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Eye,
  FileDown,
  FilePlus2,
  FileText,
  Filter,
  Plus,
  Trash2,
} from 'lucide-react';
import type { InvoiceListFilters, InvoiceSummary, InvoiceStatus } from '@shared/types';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync, useDebounced } from '../lib/hooks';
import { euro, formatDateFR, numberFR } from '../lib/format';
import { navigate, useRoute } from '../lib/router';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineError,
  LoadingBlock,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  StatusBadge,
  Tabs,
} from '../components/ui';
import { todayISO } from '@shared/dates';

type StatusTab = 'all' | 'draft' | 'issued' | 'overdue' | 'paid';

const TAB_FILTER: Record<StatusTab, InvoiceListFilters['status']> = {
  all: 'all',
  draft: 'draft',
  issued: 'issued',
  overdue: 'overdue',
  paid: 'paid',
};

export function InvoicesPage() {
  const route = useRoute();
  const toast = useToast();
  const { dataVersion, bumpData } = useAppData();
  const [tab, setTab] = useState<StatusTab>('all');
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 250);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortBy, setSortBy] = useState<NonNullable<InvoiceListFilters['sortBy']>>('issueDate');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<InvoiceSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  useEffect(() => {
    const status = route.search.get('status');
    if (status && ['all', 'draft', 'issued', 'overdue', 'paid'].includes(status)) {
      setTab(status as StatusTab);
      setPage(1);
    }
  }, [route.search.toString()]);

  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [tab, debouncedQuery, dateFrom, dateTo, sortBy]);

  const filters: InvoiceListFilters = useMemo(
    () => ({
      status: TAB_FILTER[tab],
      query: debouncedQuery.trim() || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sortBy,
      sortDir: 'desc',
      page,
      pageSize: 15,
    }),
    [tab, debouncedQuery, dateFrom, dateTo, sortBy, page],
  );

  const { data, loading, error, reload } = useAsync(() => api.invoices.list(filters), [filters, dataVersion]);
  const invoices = data?.items ?? [];
  const activeFilterCount = (dateFrom ? 1 : 0) + (dateTo ? 1 : 0);

  const allSelected = invoices.length > 0 && invoices.every((invoice) => selected.includes(invoice.id));

  const toggleAll = () => {
    if (allSelected) setSelected([]);
    else setSelected(invoices.map((invoice) => invoice.id));
  };

  const exportZip = async () => {
    if (!selected.length) return;
    setBusy(true);
    try {
      const result = await api.exports.zip(selected);
      if (!result.canceled) {
        toast.success('Archive créée', `${result.count ?? selected.length} PDF exportés`);
      }
    } catch (reason) {
      toast.error('Export impossible', errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.invoices.deleteDraft(deleting.id);
      toast.success('Brouillon supprimé');
      setDeleting(null);
      bumpData();
      reload();
    } catch (reason) {
      toast.error('Suppression impossible', errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Gestion"
        title="Factures"
        subtitle="Tous vos documents, brouillons compris. Une facture émise ne peut plus être modifiée ni supprimée."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<FileDown size={15} />}
              onClick={async () => {
                try {
                  const result = await api.exports.csv(filters);
                  if (!result.canceled) toast.success('Export CSV créé', result.path);
                } catch (reason) {
                  toast.error('Export impossible', errorMessage(reason));
                }
              }}
            >
              Exporter CSV
            </Button>
            <Button icon={<Plus size={16} />} onClick={() => navigate('/factures/nouvelle')}>
              Nouvelle facture
            </Button>
          </>
        }
      />

      {error ? <InlineError message={errorMessage(error)} onRetry={reload} /> : null}

      <Card>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Numéro, client, montant…" />
          <div className="toolbar-spacer" />
          <Button
            variant={filtersOpen || activeFilterCount ? 'soft' : 'secondary'}
            size="sm"
            icon={<Filter size={14} />}
            onClick={() => setFiltersOpen((value) => !value)}
          >
            Filtres{activeFilterCount ? ` (${activeFilterCount})` : ''}
          </Button>
          <Select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
            aria-label="Trier par"
            className="select-compact"
          >
            <option value="issueDate">Date d'émission</option>
            <option value="number">Numéro</option>
            <option value="clientName">Client</option>
            <option value="dueDate">Échéance</option>
            <option value="totalTtcCents">Montant TTC</option>
            <option value="balanceCents">Solde dû</option>
          </Select>
        </div>

        {filtersOpen ? (
          <div className="filter-bar">
            <label>
              <span>Du</span>
              <input
                type="date"
                className="input"
                value={dateFrom}
                max={dateTo || todayISO()}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label>
              <span>Au</span>
              <input
                type="date"
                className="input"
                value={dateTo}
                min={dateFrom}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDateFrom('');
                setDateTo('');
              }}
            >
              Réinitialiser
            </Button>
            <div className="toolbar-spacer" />
            {selected.length > 0 ? (
              <Button size="sm" variant="soft" icon={<Download size={14} />} loading={busy} onClick={exportZip}>
                Exporter la sélection ({selected.length})
              </Button>
            ) : null}
          </div>
        ) : null}

        <Tabs
          tabs={[
            { value: 'all', label: 'Toutes' },
            { value: 'draft', label: 'Brouillons' },
            { value: 'issued', label: 'Émises' },
            { value: 'overdue', label: 'En retard' },
            { value: 'paid', label: 'Payées' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as StatusTab)}
        />

        {loading && !data ? (
          <LoadingBlock />
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={
              debouncedQuery || activeFilterCount
                ? 'Aucune facture ne correspond à ces critères'
                : tab === 'all'
                  ? 'Aucune facture'
                  : 'Aucun document dans cette catégorie'
            }
            description={
              debouncedQuery || activeFilterCount
                ? 'Ajustez la recherche, les dates ou le statut sélectionné.'
                : 'Créez votre première facture : le numéro sera attribué automatiquement à l’émission, sans rupture de séquence.'
            }
            action={
              <Button icon={<FilePlus2 size={15} />} onClick={() => navigate('/factures/nouvelle')}>
                Créer une facture
              </Button>
            }
          />
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th className="check-cell">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Tout sélectionner" />
                  </th>
                  <th>Document</th>
                  <th>Client</th>
                  <th>Émission</th>
                  <th>Échéance</th>
                  <th className="num">Total TTC</th>
                  <th className="num">Payé</th>
                  <th className="num">Solde</th>
                  <th>Statut</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="is-clickable" onClick={() => navigate(`/factures/${invoice.id}`)}>
                    <td className="check-cell" onClick={(event) => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.includes(invoice.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, invoice.id]
                              : current.filter((id) => id !== invoice.id),
                          )
                        }
                        aria-label={`Sélectionner ${invoice.number ?? 'le brouillon'}`}
                      />
                    </td>
                    <td>
                      <div className="table-primary">
                        <span className={`doc-icon ${invoice.type === 'credit_note' ? '' : 'accent'}`}>
                          <FileText size={15} />
                        </span>
                        <span className="doc-meta">
                          <strong>{invoice.number ?? 'Brouillon'}</strong>
                          <span>{invoice.type === 'credit_note' ? 'Avoir' : 'Facture'}</span>
                        </span>
                      </div>
                    </td>
                    <td>{invoice.clientName || '—'}</td>
                    <td className="muted">{formatDateFR(invoice.issueDate)}</td>
                    <td className="muted">{formatDateFR(invoice.dueDate)}</td>
                    <td className="num strong">{euro(invoice.totalTtcCents)}</td>
                    <td className="num">{euro(invoice.paidCents)}</td>
                    <td className="num">
                      {invoice.type === 'credit_note' ? (
                        <span className="muted" title="Un avoir ne porte pas de solde à encaisser">
                          —
                        </span>
                      ) : (
                        <span className={invoice.balanceCents > 0 ? 'amount-due' : 'muted'}>
                          {euro(invoice.balanceCents)}
                        </span>
                      )}
                    </td>
                    <td>
                      <StatusBadge status={invoice.effectiveStatus} size="sm" />
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="table-actions">
                        <IconButton label="Ouvrir" onClick={() => navigate(`/factures/${invoice.id}`)}>
                          <Eye size={14} />
                        </IconButton>
                        {invoice.status === 'draft' ? (
                          <IconButton label="Supprimer le brouillon" className="is-danger" onClick={() => setDeleting(invoice)}>
                            <Trash2 size={14} />
                          </IconButton>
                        ) : (
                          <IconButton
                            label="Enregistrer le PDF"
                            onClick={async () => {
                              try {
                                const result = await api.invoices.saveAs(invoice.id);
                                if (!result.canceled) toast.success('PDF enregistré', result.path);
                              } catch (reason) {
                                toast.error('Enregistrement impossible', errorMessage(reason));
                              }
                            }}
                          >
                            <Download size={14} />
                          </IconButton>
                        )}
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

      <p className="page-note">
        {data ? `${numberFR(data.total)} document${data.total > 1 ? 's' : ''} au total.` : ''} Les brouillons
        n’occupent aucun numéro définitif : la séquence reste continue à l’émission.
      </p>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Supprimer ce brouillon ?"
        description="Le brouillon sera définitivement supprimé. Aucun numéro n'ayant été attribué, la séquence de facturation reste intacte."
        confirmLabel="Supprimer le brouillon"
        danger
        loading={busy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
