import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Building2,
  Mail,
  Pencil,
  Phone,
  Plus,
  Trash2,
  User,
  Users,
} from 'lucide-react';
import type { Client, ClientType } from '@shared/types';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync, useDebounced } from '../lib/hooks';
import { euro, formatDateFR, initials, numberFR } from '../lib/format';
import { navigate, useRoute } from '../lib/router';
import { ClientDialog } from '../components/ClientDialog';
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
  SearchField,
  Segmented,
  Tabs,
  Avatar,
} from '../components/ui';

type ArchiveTab = 'active' | 'archived';
type TypeFilter = ClientType | 'all';

export function ClientsPage() {
  const route = useRoute();
  const toast = useToast();
  const { dataVersion, bumpData } = useAppData();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounced(query, 250);
  const [tab, setTab] = useState<ArchiveTab>('active');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(
    () =>
      api.clients.list({
        query: debouncedQuery.trim() || undefined,
        type: typeFilter,
        includeArchived: tab === 'archived',
      }),
    [debouncedQuery, typeFilter, tab, dataVersion],
  );

  const clients = data ?? [];

  const summary = useMemo(() => {
    const pro = clients.filter((client) => client.type === 'professionnel').length;
    const billed = clients.reduce((sum, client) => sum + (client.totalBilledCents ?? 0), 0);
    const outstanding = clients.reduce((sum, client) => sum + (client.outstandingCents ?? 0), 0);
    return { pro, billed, outstanding };
  }, [clients]);

  useEffect(() => {
    const action = route.search.get('action');
    const focus = route.search.get('focus');
    if (action === 'new') {
      setEditing(null);
      setDialogOpen(true);
      navigate('/clients', { replace: true });
    } else if (focus) {
      api.clients
        .get(focus)
        .then((client) => {
          setEditing(client);
          setDialogOpen(true);
        })
        .catch(() => toast.error('Client introuvable'));
      navigate('/clients', { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.search.toString()]);

  const archive = async (client: Client) => {
    try {
      await api.clients.archive(client.id, !client.isArchived);
      toast.success(client.isArchived ? 'Client restauré' : 'Client archivé', client.companyName || client.lastName);
      bumpData();
      reload();
    } catch (reason) {
      toast.error('Opération impossible', errorMessage(reason));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.clients.remove(deleting.id);
      toast.success('Client supprimé');
      setDeleting(null);
      bumpData();
      reload();
    } catch (reason) {
      toast.error('Suppression impossible', errorMessage(reason));
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Gestion"
        title="Clients"
        subtitle="Carnet d'adresses local, avec les informations légales nécessaires à la facturation."
        actions={
          <Button
            icon={<Plus size={16} />}
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            Nouveau client
          </Button>
        }
      />

      <div className="mini-stats">
        <div className="mini-stat">
          <span className="mini-stat-icon accent">
            <Users size={16} />
          </span>
          <div>
            <strong>{numberFR(clients.length)}</strong>
            <p>{tab === 'archived' ? 'clients archivés' : 'clients actifs'}</p>
          </div>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-icon info">
            <Building2 size={16} />
          </span>
          <div>
            <strong>{numberFR(summary.pro)}</strong>
            <p>professionnels</p>
          </div>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-icon success">
            <Archive size={16} />
          </span>
          <div>
            <strong>{euro(summary.billed)}</strong>
            <p>chiffre d'affaires cumulé</p>
          </div>
        </div>
        <div className="mini-stat">
          <span className="mini-stat-icon warning">
            <Mail size={16} />
          </span>
          <div>
            <strong>{euro(summary.outstanding)}</strong>
            <p>restant à encaisser</p>
          </div>
        </div>
      </div>

      {error ? <InlineError message={errorMessage(error)} onRetry={reload} /> : null}

      <Card>
        <div className="toolbar">
          <SearchField value={query} onChange={setQuery} placeholder="Nom, société, e-mail, SIREN, ville…" />
          <div className="toolbar-spacer" />
          <Segmented
            options={[
              { value: 'all', label: 'Tous' },
              { value: 'professionnel', label: 'Professionnels' },
              { value: 'particulier', label: 'Particuliers' },
            ]}
            value={typeFilter}
            onChange={setTypeFilter}
            size="sm"
          />
        </div>
        <Tabs
          tabs={[
            { value: 'active', label: 'Actifs' },
            { value: 'archived', label: 'Archivés' },
          ]}
          value={tab}
          onChange={(value) => setTab(value as ArchiveTab)}
        />

        {loading && !data ? (
          <LoadingBlock />
        ) : clients.length === 0 ? (
          <EmptyState
            icon={Users}
            title={debouncedQuery ? 'Aucun client ne correspond à votre recherche' : tab === 'archived' ? 'Aucun client archivé' : 'Votre carnet d’adresses est vide'}
            description={
              debouncedQuery
                ? 'Modifiez vos critères ou créez un nouveau client.'
                : 'Créez votre premier client pour commencer à facturer. Les données restent sur ce poste.'
            }
            action={
              <Button
                icon={<Plus size={15} />}
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                Ajouter un client
              </Button>
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Client</th>
                <th>Type</th>
                <th>Coordonnées</th>
                <th>Identifiant</th>
                <th className="num">Factures</th>
                <th className="num">CA TTC</th>
                <th className="num">Reste dû</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const name =
                  client.companyName ||
                  [client.firstName, client.lastName].filter(Boolean).join(' ') ||
                  'Client sans nom';
                return (
                  <tr
                    key={client.id}
                    className="is-clickable"
                    onClick={() => {
                      setEditing(client);
                      setDialogOpen(true);
                    }}
                  >
                    <td>
                      <div className="table-primary">
                        <Avatar name={name} size={33} />
                        <span className="doc-meta">
                          <strong>{name}</strong>
                          <span>
                            {client.legalForm || (client.type === 'professionnel' ? 'Professionnel' : 'Particulier')}
                            {client.address.city ? ` · ${client.address.city}` : ''}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="type-pill">
                        {client.type === 'professionnel' ? <Building2 size={12} /> : <User size={12} />}
                        {client.type === 'professionnel' ? 'Pro' : 'Particulier'}
                      </span>
                    </td>
                    <td>
                      <div className="contact-cell">
                        {client.email ? (
                          <span>
                            <Mail size={12} /> {client.email}
                          </span>
                        ) : null}
                        {client.phone ? (
                          <span>
                            <Phone size={12} /> {client.phone}
                          </span>
                        ) : null}
                        {!client.email && !client.phone ? <span className="muted">—</span> : null}
                      </div>
                    </td>
                    <td>
                      {client.siren ? (
                        <span className="mono">{client.siren}</span>
                      ) : client.siret ? (
                        <span className="mono">{client.siret}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="num">{numberFR(client.invoiceCount ?? 0)}</td>
                    <td className="num strong">{euro(client.totalBilledCents ?? 0)}</td>
                    <td className="num">
                      <span className={(client.outstandingCents ?? 0) > 0 ? 'amount-due' : 'muted'}>
                        {euro(client.outstandingCents ?? 0)}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions" onClick={(event) => event.stopPropagation()}>
                        <IconButton
                          label="Modifier"
                          onClick={() => {
                            setEditing(client);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton
                          label={client.isArchived ? 'Restaurer' : 'Archiver'}
                          onClick={() => archive(client)}
                        >
                          {client.isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                        </IconButton>
                        <IconButton
                          label="Supprimer"
                          className="is-danger"
                          onClick={() => setDeleting(client)}
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="table-footer">
          <span>
            {clients.length} client{clients.length > 1 ? 's' : ''}
            {tab === 'active' ? ' actif' : ' archivé'}
            {clients.length > 1 ? 's' : ''}
          </span>
          <span className="muted">Dernière mise à jour : {formatDateFR(new Date().toISOString().slice(0, 10))}</span>
        </div>
      </Card>

      <ClientDialog
        open={dialogOpen}
        client={editing}
        onClose={() => setDialogOpen(false)}
        onSaved={() => {
          bumpData();
          reload();
        }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Supprimer ce client ?"
        description={
          deleting
            ? `« ${deleting.companyName || `${deleting.firstName} ${deleting.lastName}`.trim()} » sera définitivement supprimé. La suppression est refusée si des factures, même en brouillon, y sont rattachées.`
            : ''
        }
        confirmLabel="Supprimer"
        danger
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      >
        <div className="deleted-client-preview">
          {deleting ? <Avatar name={deleting.companyName || deleting.lastName} size={30} /> : null}
          <span>{deleting?.email || deleting?.phone || 'Aucune coordonnée'}</span>
        </div>
      </ConfirmDialog>
    </div>
  );
}

export { initials };
