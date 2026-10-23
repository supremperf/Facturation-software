import { useState } from 'react';
import { Eye, FileMinus2, FileText, Plus } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync, useDebounced } from '../lib/hooks';
import { euro, formatDateFR, numberFR } from '../lib/format';
import { navigate } from '../lib/router';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  InlineError,
  LoadingBlock,
  PageHeader,
  Pagination,
  SearchField,
  StatusBadge,
} from '../components/ui';

export function CreditNotesPage() {
  const { dataVersion } = useAppData();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 250);
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useAsync(
    () =>
      api.invoices.list({
        type: 'credit_note',
        status: 'all',
        query: debounced.trim() || undefined,
        sortBy: 'issueDate',
        sortDir: 'desc',
        page,
        pageSize: 15,
      }),
    [debounced, page, dataVersion],
  );

  const creditNotes = data?.items ?? [];
  const total = creditNotes.reduce((sum, note) => sum + (note.status === 'draft' ? 0 : note.totalTtcCents), 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Gestion"
        title="Avoirs"
        subtitle="Les corrections passent exclusivement par un avoir numéroté, rattaché à sa facture d'origine."
        actions={
          <Button icon={<Plus size={16} />} onClick={() => navigate('/factures/nouvelle?type=credit_note')}>
            Créer un avoir
          </Button>
        }
      />

      <div className="mini-stats mini-stats-2">
        <div className="mini-stat">
          <span className="mini-stat-icon accent">
            <FileMinus2 size={16} />
          </span>
          <div>
            <strong>{numberFR(data?.total ?? 0)}</strong>
            <p>avoirs enregistrés</p>
          </div>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-icon warning">
            <FileText size={16} />
          </span>
          <div>
            <strong>{euro(total)}</strong>
            <p>montant crédité (page courante)</p>
          </div>
        </div>
      </div>

      {error ? <InlineError message={errorMessage(error)} onRetry={reload} /> : null}

      <Card>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Numéro d'avoir, client, facture d'origine…" />
        </div>
        {loading && !data ? (
          <LoadingBlock />
        ) : creditNotes.length === 0 ? (
          <EmptyState
            icon={FileMinus2}
            title="Aucun avoir"
            description="Un avoir corrige une facture déjà émise, sans la modifier ni la supprimer. Créez-en un depuis la facture concernée ou via le bouton ci-dessus."
            action={
              <Button icon={<Plus size={15} />} onClick={() => navigate('/factures/nouvelle?type=credit_note')}>
                Créer un avoir
              </Button>
            }
          />
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Avoir</th>
                  <th>Client</th>
                  <th>Facture d'origine</th>
                  <th>Émission</th>
                  <th className="num">Montant TTC</th>
                  <th>Statut</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {creditNotes.map((note) => (
                  <tr key={note.id} className="is-clickable" onClick={() => navigate(`/factures/${note.id}`)}>
                    <td>
                      <div className="table-primary">
                        <span className="doc-icon">
                          <FileMinus2 size={15} />
                        </span>
                        <span className="doc-meta">
                          <strong>{note.number ?? 'Brouillon'}</strong>
                          <span>Avoir</span>
                        </span>
                      </div>
                    </td>
                    <td>{note.clientName || '—'}</td>
                    <td className="muted">{note.sourceInvoiceNumber ?? '—'}</td>
                    <td className="muted">{formatDateFR(note.issueDate)}</td>
                    <td className="num strong">{euro(note.totalTtcCents)}</td>
                    <td>
                      <StatusBadge status={note.effectiveStatus} size="sm" />
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <div className="table-actions">
                        <IconButton label="Ouvrir" onClick={() => navigate(`/factures/${note.id}`)}>
                          <Eye size={14} />
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
      <p className="page-note">
        Un avoir ne peut jamais dépasser le montant restant créditable de la facture d'origine. Les factures émises
        restent immuables et conservées.
      </p>
    </div>
  );
}
