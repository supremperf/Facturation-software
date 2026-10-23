import { useState } from 'react';
import {
  Activity,
  Archive,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Table2,
} from 'lucide-react';
import type { DocumentType, EffectiveStatus } from '@shared/types';
import { todayISO } from '@shared/dates';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync } from '../lib/hooks';
import { euro, formatDateTimeFR, formatRelativeFR, humanFileSize, numberFR } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  InlineError,
  LoadingBlock,
  PageHeader,
  Select,
  TextInput,
} from '../components/ui';

const ACTIVITY_FILTERS: { value: string; label: string; types: string[] }[] = [
  { value: 'all', label: 'Toutes les activités', types: [] },
  { value: 'invoice', label: 'Facturation', types: ['invoice_', 'credit_note_', 'pdf_'] },
  { value: 'payment', label: 'Paiements', types: ['payment_'] },
  { value: 'client', label: 'Clients', types: ['client_'] },
  { value: 'backup', label: 'Sauvegardes', types: ['backup_'] },
  { value: 'settings', label: 'Paramètres', types: ['settings_', 'export_'] },
];

export function ReportsPage() {
  const toast = useToast();
  const { appInfo, dataVersion } = useAppData();
  const [exportFrom, setExportFrom] = useState(`${todayISO().slice(0, 4)}-01-01`);
  const [exportTo, setExportTo] = useState(todayISO());
  const [exportType, setExportType] = useState<DocumentType | 'all'>('all');
  const [exportStatus, setExportStatus] = useState<EffectiveStatus | 'all'>('all');
  const [vatFrom, setVatFrom] = useState(`${todayISO().slice(0, 4)}-01-01`);
  const [vatTo, setVatTo] = useState(todayISO());
  const [activityFilter, setActivityFilter] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);

  const activities = useAsync(() => api.activities(100), [dataVersion]);
  const diagnostics = useAsync(() => api.diagnostics(), [dataVersion]);

  const run = async (key: string, action: () => Promise<{ canceled?: boolean; path?: string; count?: number } | void>) => {
    setBusy(key);
    try {
      const result = await action();
      if (result && 'canceled' in result && result.canceled) return;
      if (result && 'path' in result && result.path) {
        toast.success('Export terminé', result.path);
      } else {
        toast.success('Export terminé');
      }
    } catch (reason) {
      toast.error('Export impossible', errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const filteredActivities = (activities.data ?? []).filter((item) => {
    if (activityFilter === 'all') return true;
    const filter = ACTIVITY_FILTERS.find((entry) => entry.value === activityFilter);
    return filter ? filter.types.some((prefix) => item.type.startsWith(prefix)) : true;
  });

  const zipExport = async () => {
    setBusy('zip');
    try {
      const result = await api.invoices.list({
        type: exportType,
        status: exportStatus,
        dateFrom: exportFrom || undefined,
        dateTo: exportTo || undefined,
        pageSize: 200,
        sortBy: 'issueDate',
        sortDir: 'asc',
      });
      const ids = result.items.filter((invoice) => invoice.hasPdf).map((invoice) => invoice.id);
      if (ids.length === 0) {
        toast.warning('Aucun PDF à exporter', 'Aucune facture émise ne correspond à ces critères.');
        return;
      }
      const exported = await api.exports.zip(ids);
      if (!exported.canceled) {
        toast.success('Archive ZIP créée', `${exported.count ?? ids.length} PDF · ${exported.path ?? ''}`);
      }
    } catch (reason) {
      toast.error('Export ZIP impossible', errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Analyse"
        title="Rapports & exports"
        subtitle="Exportez vos données pour votre comptable ou archivez-les hors de l'application. Tout reste local."
        actions={
          <>
            <Button variant="secondary" icon={<FolderOpen size={15} />} onClick={() => void api.openDataFolder()}>
              Dossier de données
            </Button>
            <Button variant="ghost" icon={<RefreshCw size={15} />} onClick={() => { activities.reload(); diagnostics.reload(); }}>
              Actualiser
            </Button>
          </>
        }
      />

      <div className="report-grid">
        <Card>
          <CardHeader
            title="Journal des factures"
            subtitle="CSV compatible Excel (séparateur point-virgule, UTF-8 BOM)"
            icon={FileSpreadsheet}
          />
          <div className="card-body">
            <div className="form-grid">
              <label className="inline-date">
                <span>Du</span>
                <TextInput type="date" value={exportFrom} max={exportTo} onChange={(event) => setExportFrom(event.target.value)} />
              </label>
              <label className="inline-date">
                <span>Au</span>
                <TextInput type="date" value={exportTo} min={exportFrom} onChange={(event) => setExportTo(event.target.value)} />
              </label>
              <Select value={exportType} onChange={(event) => setExportType(event.target.value as typeof exportType)}>
                <option value="all">Factures et avoirs</option>
                <option value="invoice">Factures uniquement</option>
                <option value="credit_note">Avoirs uniquement</option>
              </Select>
              <Select value={exportStatus} onChange={(event) => setExportStatus(event.target.value as typeof exportStatus)}>
                <option value="all">Tous statuts</option>
                <option value="draft">Brouillons</option>
                <option value="issued">Émises</option>
                <option value="partial">Partiellement payées</option>
                <option value="paid">Payées</option>
                <option value="overdue">En retard</option>
                <option value="cancelled">Annulées</option>
              </Select>
            </div>
            <div className="report-actions">
              <Button
                variant="secondary"
                icon={<Download size={14} />}
                loading={busy === 'csv'}
                onClick={() =>
                  void run('csv', () =>
                    api.exports.csv({
                      dateFrom: exportFrom || undefined,
                      dateTo: exportTo || undefined,
                      type: exportType,
                      status: exportStatus,
                    }),
                  )
                }
              >
                Exporter en CSV
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Déclaration de TVA" subtitle="Assiettes et taxe par taux sur la période" icon={Table2} />
          <div className="card-body">
            <div className="form-grid">
              <label className="inline-date">
                <span>Du</span>
                <TextInput type="date" value={vatFrom} max={vatTo} onChange={(event) => setVatFrom(event.target.value)} />
              </label>
              <label className="inline-date">
                <span>Au</span>
                <TextInput type="date" value={vatTo} min={vatFrom} onChange={(event) => setVatTo(event.target.value)} />
              </label>
            </div>
            <div className="report-actions">
              <Button
                variant="secondary"
                icon={<Download size={14} />}
                loading={busy === 'vat'}
                onClick={() => void run('vat', () => api.exports.vatCsv(vatFrom, vatTo))}
              >
                Exporter la TVA
              </Button>
            </div>
            <p className="field-hint">
              Régime de franchise : aucune TVA collectée. Le fichier reste généré avec un total à zéro.
            </p>
          </div>
        </Card>

        <Card>
          <CardHeader title="Archive PDF" subtitle="Compresse les PDF archivés dans une seule archive ZIP" icon={Archive} />
          <div className="card-body">
            <p className="report-text">
              Reprend les filtres du journal ci-dessus et n'inclut que les documents dont le PDF a été généré à
              l'émission. Les brouillons ne possèdent pas de PDF définitif.
            </p>
            <div className="report-actions">
              <Button
                variant="secondary"
                icon={<Archive size={14} />}
                loading={busy === 'zip'}
                onClick={() => void zipExport()}
              >
                Exporter les PDF (ZIP)
              </Button>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Sauvegarde JSON" subtitle="Structure complète : réglages, clients, factures, paiements" icon={FileJson} />
          <div className="card-body">
            <p className="report-text">
              Format lisible destiné à l'archivage ou à un contrôle externe. Pour restaurer l'application, utilisez
              plutôt une sauvegarde ZIP depuis l'écran Sauvegardes.
            </p>
            <div className="report-actions">
              <Button
                variant="secondary"
                icon={<FileJson size={14} />}
                loading={busy === 'json'}
                onClick={() => void run('json', () => api.exports.json())}
              >
                Exporter en JSON
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <div className="report-layout">
        <Card>
          <CardHeader
            title="Journal d'activité"
            subtitle="Historique local des opérations"
            icon={Activity}
            actions={
              <Select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)} className="select-compact">
                {ACTIVITY_FILTERS.map((filter) => (
                  <option key={filter.value} value={filter.value}>
                    {filter.label}
                  </option>
                ))}
              </Select>
            }
          />
          <div className="card-body card-body-flush">
            {activities.loading && !activities.data ? (
              <LoadingBlock />
            ) : filteredActivities.length === 0 ? (
              <EmptyState compact icon={Activity} title="Aucune activité" description="Les actions réalisées dans l'application seront consignées ici." />
            ) : (
              <ul className="journal-list">
                {filteredActivities.map((item) => (
                  <li key={item.id}>
                    <span className="journal-dot" />
                    <div>
                      <strong>{item.title}</strong>
                      {item.detail ? <p>{item.detail}</p> : null}
                    </div>
                    <time title={formatDateTimeFR(item.createdAt)}>{formatRelativeFR(item.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <aside className="report-aside">
          <Card>
            <CardHeader title="Diagnostic" subtitle="Contrôle d'intégrité de vos données" icon={ShieldCheck} />
            <div className="card-body">
              {diagnostics.error ? (
                <InlineError message={errorMessage(diagnostics.error)} onRetry={diagnostics.reload} />
              ) : !diagnostics.data ? (
                <LoadingBlock height={120} />
              ) : (
                <>
                  <div className={`integrity-badge ${diagnostics.data.integrity === 'ok' ? 'is-ok' : 'is-bad'}`}>
                    <Database size={16} />
                    <div>
                      <strong>{diagnostics.data.integrity === 'ok' ? 'Base intègre' : 'Anomalie détectée'}</strong>
                      <p>SQLite · schéma v{appInfo?.dbSchemaVersion ?? '—'}</p>
                    </div>
                  </div>
                  <div className="diagnostic-grid">
                    <div>
                      <span>Documents</span>
                      <strong>{numberFR(appInfo?.documentCount ?? 0)}</strong>
                    </div>
                    <div>
                      <span>PDF manquants</span>
                      <strong className={diagnostics.data.missingPdfs > 0 ? 'text-danger' : ''}>
                        {numberFR(diagnostics.data.missingPdfs)}
                      </strong>
                    </div>
                    <div>
                      <span>Numéros en doublon</span>
                      <strong className={diagnostics.data.duplicateNumbers > 0 ? 'text-danger' : ''}>
                        {numberFR(diagnostics.data.duplicateNumbers)}
                      </strong>
                    </div>
                    <div>
                      <span>Fichiers orphelins</span>
                      <strong>{numberFR(diagnostics.data.orphanFiles)}</strong>
                    </div>
                  </div>
                  <div className="info-list">
                    <div className="info-row">
                      <span>Base de données</span>
                      <strong>{humanFileSize(appInfo?.databaseSize ?? 0)}</strong>
                    </div>
                    <div className="info-row">
                      <span>Dossier documents</span>
                      <strong>{humanFileSize(appInfo?.documentsSize ?? 0)}</strong>
                    </div>
                    <div className="info-row">
                      <span>Dernière sauvegarde</span>
                      <strong>{diagnostics.data.lastBackupAt ? formatRelativeFR(diagnostics.data.lastBackupAt) : 'Jamais'}</strong>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    block
                    icon={<HardDrive size={14} />}
                    onClick={() => void api.openLogsFolder()}
                  >
                    Ouvrir les journaux techniques
                  </Button>
                </>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Sécurité & données" subtitle="Stockage hors ligne" icon={ShieldCheck} />
            <div className="card-body">
              <ul className="security-list">
                <li>Contexte isolé, aucune intégration Node.js dans l'interface.</li>
                <li>Validation stricte de chaque message IPC.</li>
                <li>Chiffrement d'empreinte SHA-256 des PDF archivés.</li>
                <li>Conservation 10 ans, aucune suppression automatique de facture émise.</li>
                <li>Sauvegardes automatiques et manuelles dans %APPDATA%/FacturePro.</li>
              </ul>
              {appInfo ? (
                <div className="info-list">
                  <div className="info-row">
                    <span>Version application</span>
                    <strong>{appInfo.version}</strong>
                  </div>
                  <div className="info-row">
                    <span>Electron / Chrome</span>
                    <strong>
                      {appInfo.electron} / {appInfo.chrome}
                    </strong>
                  </div>
                  <div className="info-row">
                    <span>Chemin des données</span>
                    <strong className="path-value" title={appInfo.userDataPath}>
                      {appInfo.userDataPath}
                    </strong>
                  </div>
                </div>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                block
                icon={<FolderOpen size={14} />}
                onClick={() => void api.openDataFolder()}
              >
                Ouvrir le dossier
              </Button>
            </div>
          </Card>
        </aside>
      </div>

      {diagnostics.data && diagnostics.data.tables.length > 0 ? (
        <Card className="tables-card">
          <CardHeader title="Tables de la base" subtitle="Contenu de la base locale" icon={Database} />
          <div className="card-body">
            <div className="table-chips">
              {diagnostics.data.tables.map((table) => (
                <span key={table.name} className="table-chip">
                  {table.name}
                  <b>{numberFR(table.rows)}</b>
                </span>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      <p className="page-note">
        Les rapports sont générés à la demande depuis la base locale. Aucune donnée n'est transmise à un service tiers.
        {appInfo ? ` Version ${appInfo.version} · ${euro(0)}` : ''}
      </p>
    </div>
  );
}
