import { useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  DatabaseBackup,
  Download,
  FolderOpen,
  HardDrive,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync } from '../lib/hooks';
import { formatDateTimeFR, formatRelativeFR, humanFileSize, numberFR } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  IconButton,
  InlineError,
  LoadingBlock,
  PageHeader,
} from '../components/ui';

export function BackupsPage() {
  const toast = useToast();
  const { appInfo, bumpData, refresh } = useAppData();
  const { data, loading, error, reload } = useAsync(() => api.backups.list(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const backups = data ?? [];
  const last = backups[0] ?? null;
  const totalSize = backups.reduce((sum, backup) => sum + backup.size, 0);

  const createBackup = async () => {
    setBusy('create');
    try {
      const backup = await api.backups.create();
      toast.success('Sauvegarde créée', backup.name);
      reload();
    } catch (reason) {
      toast.error('Sauvegarde impossible', errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const importBackup = async () => {
    setBusy('import');
    try {
      const result = await api.backups.import();
      if (result.canceled) return;
      toast.success('Sauvegarde importée', result.backup?.name);
      reload();
    } catch (reason) {
      toast.error('Import impossible', errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!restoring) return;
    setBusy('restore');
    try {
      await api.backups.restore(restoring);
      toast.success('Sauvegarde restaurée', 'Les données ont été remplacées. Vérifiez vos documents.');
      setRestoring(null);
      reload();
      bumpData();
      await refresh();
    } catch (reason) {
      toast.error('Restauration impossible', errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Configuration"
        title="Sauvegardes"
        subtitle="Copies complètes stockées sur ce poste : base de données, PDF archivés et logo. Aucun envoi dans le cloud."
        actions={
          <>
            <Button variant="secondary" icon={<Upload size={15} />} loading={busy === 'import'} onClick={importBackup}>
              Importer
            </Button>
            <Button icon={<Plus size={15} />} loading={busy === 'create'} onClick={createBackup}>
              Créer une sauvegarde
            </Button>
          </>
        }
      />

      {error ? <InlineError message={errorMessage(error)} onRetry={reload} /> : null}

      <div className="backup-hero">
        <div className="backup-hero-main">
          <span className="backup-hero-icon">
            <DatabaseBackup size={22} />
          </span>
          <div>
            <strong>{last ? `Dernière sauvegarde ${formatRelativeFR(last.createdAt)}` : 'Aucune sauvegarde pour le moment'}</strong>
            <p>
              {last
                ? `${last.name} · ${humanFileSize(last.size)} · ${formatDateTimeFR(last.createdAt)}`
                : 'Une sauvegarde de sécurité est créée automatiquement à chaque démarrage de l’application.'}
            </p>
          </div>
          <Badge tone={last ? 'success' : 'warning'}>{last ? 'Protégé' : 'À créer'}</Badge>
        </div>
        <div className="backup-hero-stats">
          <div>
            <span>Sauvegardes</span>
            <strong>{numberFR(backups.length)}</strong>
          </div>
          <div>
            <span>Espace utilisé</span>
            <strong>{humanFileSize(totalSize)}</strong>
          </div>
          <div>
            <span>Rétention automatique</span>
            <strong>30 copies</strong>
          </div>
          <div>
            <span>Dossier</span>
            <strong className="path-value">{appInfo?.backupsPath ?? '—'}</strong>
          </div>
        </div>
      </div>

      <div className="backup-layout">
        <Card>
          <CardHeader
            title="Historique des sauvegardes"
            subtitle="Copies locales, restaurables à tout moment"
            actions={
              <Button variant="ghost" size="sm" icon={<FolderOpen size={14} />} onClick={() => void api.backups.reveal()}>
                Ouvrir le dossier
              </Button>
            }
          />
          <div className="card-body card-body-flush">
            {loading && !data ? (
              <LoadingBlock />
            ) : backups.length === 0 ? (
              <EmptyState
                icon={DatabaseBackup}
                title="Aucune sauvegarde"
                description="Créez une sauvegarde avant toute évolution importante. Vous pourrez restaurer vos données en cas de problème."
                action={
                  <Button icon={<Plus size={15} />} loading={busy === 'create'} onClick={createBackup}>
                    Créer une sauvegarde
                  </Button>
                }
              />
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Sauvegarde</th>
                    <th>Date</th>
                    <th>Type</th>
                    <th className="num">Taille</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {backups.map((backup) => (
                    <tr key={backup.path}>
                      <td>
                        <div className="table-primary">
                          <span className="doc-icon accent">
                            <Archive size={15} />
                          </span>
                          <span className="doc-meta">
                            <strong>{backup.name}</strong>
                            <span>{formatRelativeFR(backup.createdAt)}</span>
                          </span>
                        </div>
                      </td>
                      <td className="muted">{formatDateTimeFR(backup.createdAt)}</td>
                      <td>
                        <Badge tone={backup.automatic ? 'info' : 'neutral'}>
                          {backup.automatic ? 'Automatique' : 'Manuelle'}
                        </Badge>
                      </td>
                      <td className="num">{humanFileSize(backup.size)}</td>
                      <td>
                        <div className="table-actions">
                          <IconButton label="Restaurer" onClick={() => setRestoring(backup.path)}>
                            <ArchiveRestore size={14} />
                          </IconButton>
                          <IconButton
                            label="Exporter"
                            onClick={async () => {
                              try {
                                const result = await api.backups.export(backup.path);
                                if (!result.canceled) toast.success('Copie exportée', result.path);
                              } catch (reason) {
                                toast.error('Export impossible', errorMessage(reason));
                              }
                            }}
                          >
                            <Download size={14} />
                          </IconButton>
                          <IconButton label="Supprimer" className="is-danger" onClick={() => setDeleting(backup.path)}>
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

        <aside className="backup-aside">
          <Card>
            <CardHeader title="Ce qui est sauvegardé" subtitle="Archive ZIP autonome" icon={Archive} />
            <div className="card-body">
              <ul className="backup-contents">
                <li>
                  <ShieldCheck size={15} />
                  Base SQLite complète (factures, clients, paiements, réglages)
                </li>
                <li>
                  <ShieldCheck size={15} />
                  PDF émis, factures et avoirs, avec leurs empreintes
                </li>
                <li>
                  <ShieldCheck size={15} />
                  Logo et éléments de marque
                </li>
                <li>
                  <ShieldCheck size={15} />
                  Manifeste de version pour contrôle avant restauration
                </li>
              </ul>
              <p className="field-hint">
                Les sauvegardes automatiques sont créées au lancement et conservées par roulement (30 maximum). Une
                copie de sécurité est systématiquement créée avant une restauration.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Bonnes pratiques" subtitle="Conservation légale" icon={HardDrive} />
            <div className="card-body">
              <ol className="tips-list">
                <li>Conservez les factures émises pendant au moins 10 ans.</li>
                <li>Copiez régulièrement les sauvegardes sur un support externe.</li>
                <li>Avant de changer d'ordinateur, exportez une sauvegarde puis importez-la sur le nouveau poste.</li>
                <li>Ne supprimez jamais le dossier de données pendant que l'application est ouverte.</li>
              </ol>
            </div>
          </Card>
        </aside>
      </div>

      <ConfirmDialog
        open={Boolean(restoring)}
        title="Restaurer cette sauvegarde ?"
        description="Les données actuelles seront remplacées par le contenu de la sauvegarde (base, PDF et logo). Une copie de sécurité de l'état actuel est créée automatiquement avant l'opération."
        confirmLabel="Restaurer"
        danger
        loading={busy === 'restore'}
        onConfirm={restore}
        onClose={() => setRestoring(null)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Supprimer cette sauvegarde ?"
        description="Le fichier ZIP sera supprimé du disque. Cette action ne touche pas à vos données actuelles."
        confirmLabel="Supprimer"
        danger
        loading={busy === 'delete'}
        onConfirm={async () => {
          if (!deleting) return;
          setBusy('delete');
          try {
            await api.backups.remove(deleting);
            toast.success('Sauvegarde supprimée');
            setDeleting(null);
            reload();
          } catch (reason) {
            toast.error('Suppression impossible', errorMessage(reason));
          } finally {
            setBusy(null);
          }
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
