import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  Clock3,
  CreditCard,
  DatabaseBackup,
  FileText,
  Plus,
  ReceiptText,
  ShieldAlert,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { STATUS_META, companyDisplayName, formatAddressLines } from '@shared/constants';
import type { ActivityItem, EffectiveStatus, InvoiceSummary, PeriodPreset } from '@shared/types';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync } from '../lib/hooks';
import { Link, navigate } from '../lib/router';
import {
  euro,
  euroCompact,
  formatDateFR,
  formatRelativeFR,
  humanFileSize,
  numberFR,
} from '../lib/format';
import {
  Card,
  CardHeader,
  EmptyState,
  InlineError,
  KpiCard,
  LoadingBlock,
  PageHeader,
  Segmented,
  StatusBadge,
  Button,
} from '../components/ui';
import { AreaChart, BarChart, ChartLegend, DonutChart, Sparkline } from '../components/Charts';

const PERIOD_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: 'month', label: 'Ce mois' },
  { value: 'quarter', label: 'Ce trimestre' },
  { value: 'year', label: 'Cette année' },
];

const ACTIVITY_ICONS: Record<string, typeof Activity> = {
  invoice_created: FileText,
  invoice_updated: FileText,
  invoice_issued: ReceiptText,
  invoice_sent: ArrowUpRight,
  invoice_deleted: FileText,
  payment_received: CreditCard,
  payment_deleted: CreditCard,
  credit_note_created: ReceiptText,
  credit_note_issued: ReceiptText,
  client_created: Building2,
  client_updated: Building2,
  client_archived: Building2,
  client_deleted: Building2,
  settings_updated: Sparkles,
  backup_created: DatabaseBackup,
  backup_restored: DatabaseBackup,
  export_completed: ArrowUpRight,
  pdf_generated: FileText,
  system: Activity,
};

export function DashboardPage() {
  const { settings, dataVersion } = useAppData();
  const [preset, setPreset] = useState<PeriodPreset>('year');
  const { data, loading, error, reload } = useAsync(() => api.dashboard(preset), [preset, dataVersion]);

  const company =
    settings && companyDisplayName(settings)
      ? companyDisplayName(settings)
      : settings?.identity.firstName
        ? settings.identity.firstName
        : 'votre entreprise';
  const addressLine = settings ? formatAddressLines(settings.business.address)[0] : '';
  const setupIncomplete = !settings?.setupCompleted;
  // Le moteur de conformité exige ces mentions pour les factures entre
  // professionnels : on prévient dès le tableau de bord au lieu de bloquer
  // l'utilisateur au moment d'émettre.
  const legalIncomplete = Boolean(
    settings && (settings.legal.latePenaltyRateBp === null || !settings.legal.escompte.trim()),
  );

  const donutData = useMemo(() => {
    if (!data) return [];
    return data.statusBreakdown
      .filter((entry) => entry.count > 0)
      .map((entry) => ({
        label: STATUS_META[entry.status]?.label ?? entry.status,
        value: entry.count,
        color: STATUS_META[entry.status]?.color ?? '#94a3b8',
      }));
  }, [data]);

  const revenueSeries = data?.revenueSeries ?? [];
  const cashSeries = data?.cashComparison ?? [];
  const recentInvoices = data?.recentInvoices ?? [];
  const activities = data?.recentActivities ?? [];
  const emptyWorkspace = data ? data.kpis.invoicesCount === 0 && data.kpis.clientCount === 0 : false;

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="Vue d'ensemble"
        title={`Bonjour${settings?.identity.firstName ? `, ${settings.identity.firstName}` : ''}`}
        subtitle={
          data
            ? `Activité de ${company} — ${data.period.label.toLowerCase()}${addressLine ? ` · ${addressLine}` : ''}`
            : 'Chargement de votre activité…'
        }
        actions={
          <>
            <Segmented options={PERIOD_OPTIONS} value={preset} onChange={setPreset} />
            <Link to="/rapports">
              <Button variant="secondary" size="md" icon={<ArrowUpRight size={15} />}>
                Exporter
              </Button>
            </Link>
            <Link to="/factures/nouvelle">
              <Button icon={<Plus size={16} />}>Créer une facture</Button>
            </Link>
          </>
        }
      />

      {legalIncomplete && !setupIncomplete ? (
        <div className="setup-banner is-warning">
          <span className="setup-banner-icon">
            <ShieldAlert size={18} />
          </span>
          <div>
            <strong>Mentions légales à compléter</strong>
            <p>
              Le taux des pénalités de retard et les conditions d’escompte sont obligatoires sur les factures entre
              professionnels. FacturePro ne les invente pas : renseignez-les avant la première émission.
            </p>
          </div>
          <Link to="/parametres">
            <Button variant="secondary" size="sm" trailingIcon={<ArrowRight size={14} />}>
              Compléter
            </Button>
          </Link>
        </div>
      ) : null}

      {setupIncomplete ? (
        <div className="setup-banner">
          <span className="setup-banner-icon">
            <Sparkles size={18} />
          </span>
          <div>
            <strong>Finalisez la configuration de votre entreprise</strong>
            <p>
              Renseignez votre identité, votre régime de TVA et vos coordonnées bancaires pour produire des
              factures conformes.
            </p>
          </div>
          <Link to="/parametres/entreprise">
            <Button variant="soft" size="sm" trailingIcon={<ArrowRight size={14} />}>
              Compléter
            </Button>
          </Link>
        </div>
      ) : null}

      {error ? <InlineError message={errorMessage(error)} onRetry={reload} /> : null}

      {loading && !data ? (
        <LoadingBlock label="Calcul des indicateurs…" height={420} />
      ) : data ? (
        <>
          <div className="kpi-grid">
            <KpiCard
              label="Chiffre d'affaires HT"
              value={euro(data.kpis.revenueHtCents)}
              hint={`TTC facturé : ${euro(data.kpis.revenueTtcCents)}`}
              icon={CircleDollarSign}
              delta={{ current: data.kpis.revenueHtCents, previous: data.previous.revenueHtCents }}
              sparkline={<Sparkline values={revenueSeries.map((point) => point.htCents)} color="#8b5cf6" />}
              tone="accent"
            />
            <KpiCard
              label="Encaissements"
              value={euro(data.kpis.collectedCents)}
              hint={`${numberFR(data.kpis.paidCount)} facture${data.kpis.paidCount > 1 ? 's' : ''} soldée${data.kpis.paidCount > 1 ? 's' : ''}`}
              icon={Wallet}
              delta={{ current: data.kpis.collectedCents, previous: data.previous.collectedCents }}
              sparkline={<Sparkline values={cashSeries.map((point) => point.collectedCents)} color="#34d399" />}
              tone="success"
            />
            <KpiCard
              label="Reste à encaisser"
              value={euro(data.kpis.outstandingCents)}
              hint={
                data.kpis.overdueCount > 0
                  ? `${numberFR(data.kpis.overdueCount)} facture${data.kpis.overdueCount > 1 ? 's' : ''} en retard`
                  : 'Aucune facture en retard'
              }
              icon={Clock3}
              sparkline={<Sparkline values={cashSeries.map((point) => point.outstandingCents)} color="#fbbf24" />}
              tone="warning"
            />
            <KpiCard
              label="Factures sur la période"
              value={numberFR(data.kpis.invoicesCount)}
              hint={`${numberFR(data.kpis.draftCount)} brouillon${data.kpis.draftCount > 1 ? 's' : ''} · ${numberFR(data.kpis.pendingCount)} en attente`}
              icon={ReceiptText}
              delta={{ current: data.kpis.invoicesCount, previous: data.previous.invoicesCount }}
              sparkline={<Sparkline values={revenueSeries.map((point) => point.count)} color="#60a5fa" />}
              tone="info"
            />
          </div>

          {emptyWorkspace ? (
            <Card className="onboarding-card">
              <div className="onboarding-copy">
                <span className="onboarding-icon">
                  <Sparkles size={22} />
                </span>
                <h2>Votre espace de facturation est prêt</h2>
                <p>
                  Aucune donnée fictive : cet espace se remplit avec vos vrais clients et vos factures. Commencez
                  par créer votre premier client puis émettez une facture conforme.
                </p>
                <div className="onboarding-actions">
                  <Link to="/clients?action=new">
                    <Button variant="secondary" icon={<Building2 size={15} />}>
                      Ajouter un client
                    </Button>
                  </Link>
                  <Link to="/factures/nouvelle">
                    <Button icon={<Plus size={15} />}>Créer une facture</Button>
                  </Link>
                </div>
              </div>
              <ol className="onboarding-steps">
                <li>
                  <span>1</span>
                  <div>
                    <strong>Identité de l'entreprise</strong>
                    <p>Mentions légales, logo et coordonnées bancaires.</p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Client</strong>
                    <p>Particulier ou professionnel, avec SIREN pour les pros.</p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Facture</strong>
                    <p>Lignes, TVA, contrôle de conformité et PDF A4.</p>
                  </div>
                </li>
              </ol>
            </Card>
          ) : null}

          <div className="dash-grid">
            <Card className="chart-card">
              <CardHeader
                title="Chiffre d'affaires"
                subtitle="Évolution mensuelle du chiffre d'affaires hors taxes"
                actions={<span className="chart-total">{euro(data.kpis.revenueHtCents)}</span>}
              />
              <div className="card-body chart-body">
                <AreaChart data={revenueSeries.map((point) => ({ label: point.label, value: point.htCents }))} />
              </div>
            </Card>

            <Card className="status-card">
              <CardHeader title="Statut des factures" subtitle={`${numberFR(data.statusTotal)} documents`} />
              <div className="card-body">
                {donutData.length === 0 ? (
                  <EmptyState
                    compact
                    icon={FileText}
                    title="Aucune facture"
                    description="Les statuts apparaîtront dès la première facture émise."
                  />
                ) : (
                  <div className="status-breakdown">
                    <DonutChart
                      data={donutData}
                      centerValue={numberFR(data.statusTotal)}
                      centerLabel="documents"
                    />
                    <ChartLegend
                      items={data.statusBreakdown
                        .filter((entry) => entry.count > 0)
                        .map((entry) => ({
                          label: STATUS_META[entry.status]?.label ?? entry.status,
                          color: STATUS_META[entry.status]?.color ?? '#94a3b8',
                          value: `${entry.count}`,
                        }))}
                    />
                  </div>
                )}
              </div>
            </Card>
          </div>

          <div className="dash-grid dash-grid-table">
            <Card className="recent-card">
              <CardHeader
                title="Dernières factures"
                subtitle="Documents récemment créés ou émis"
                actions={
                  <Link to="/factures" className="link-inline">
                    Tout voir <ArrowRight size={13} />
                  </Link>
                }
              />
              <div className="card-body card-body-flush">
                {recentInvoices.length === 0 ? (
                  <EmptyState
                    compact
                    icon={FileText}
                    title="Aucune facture pour le moment"
                    description="Créez votre première facture en quelques étapes."
                    action={
                      <Link to="/factures/nouvelle">
                        <Button size="sm" icon={<Plus size={14} />}>
                          Créer une facture
                        </Button>
                      </Link>
                    }
                  />
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Document</th>
                        <th>Client</th>
                        <th>Échéance</th>
                        <th className="num">Montant TTC</th>
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentInvoices.map((invoice) => (
                        <RecentInvoiceRow key={invoice.id} invoice={invoice} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Card>

            <Card className="activity-card">
              <CardHeader
                title="Activité récente"
                subtitle="Journal local de vos opérations"
                actions={
                  <Link to="/rapports" className="link-inline">
                    Journal <ArrowRight size={13} />
                  </Link>
                }
              />
              <div className="card-body">
                {activities.length === 0 ? (
                  <EmptyState
                    compact
                    icon={Activity}
                    title="Rien à afficher"
                    description="Vos actions apparaîtront ici."
                  />
                ) : (
                  <ul className="activity-feed">
                    {activities.slice(0, 6).map((activity) => (
                      <ActivityRow key={activity.id} activity={activity} />
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          <div className="dash-grid dash-grid-bottom">
            <Card>
              <CardHeader
                title="Encaissements & reste dû"
                subtitle="Comparaison des six derniers mois"
                actions={
                  <div className="mini-legend">
                    <span>
                      <i style={{ background: '#6c5ce7' }} /> Encaissé
                    </span>
                    <span>
                      <i style={{ background: '#fbbf24' }} /> Reste dû
                    </span>
                  </div>
                }
              />
              <div className="card-body chart-body">
                <BarChart
                  data={cashSeries.map((point) => ({
                    label: point.label,
                    values: [point.collectedCents, point.outstandingCents],
                  }))}
                  colors={['#6c5ce7', '#fbbf24']}
                  height={230}
                />
              </div>
            </Card>

            <Card className="pulse-card">
              <CardHeader title="Point du jour" subtitle="Indicateurs à surveiller" />
              <div className="card-body">
                <div className="pulse-grid">
                  <div className="pulse-item">
                    <span className="pulse-icon warning">
                      <AlertTriangle size={16} />
                    </span>
                    <div>
                      <strong>{euro(data.overdueTotalCents)}</strong>
                      <p>
                        {data.kpis.overdueCount > 0
                          ? `${numberFR(data.kpis.overdueCount)} facture${data.kpis.overdueCount > 1 ? 's' : ''} en retard`
                          : 'Aucun retard de paiement'}
                      </p>
                    </div>
                  </div>
                  <div className="pulse-item">
                    <span className="pulse-icon accent">
                      <FileText size={16} />
                    </span>
                    <div>
                      <strong>{numberFR(data.kpis.draftCount)}</strong>
                      <p>brouillon{data.kpis.draftCount > 1 ? 's' : ''} à finaliser</p>
                    </div>
                  </div>
                  <div className="pulse-item">
                    <span className="pulse-icon info">
                      <Building2 size={16} />
                    </span>
                    <div>
                      <strong>{numberFR(data.kpis.clientCount)}</strong>
                      <p>client{data.kpis.clientCount > 1 ? 's' : ''} actif{data.kpis.clientCount > 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="pulse-item">
                    <span className="pulse-icon success">
                      <DatabaseBackup size={16} />
                    </span>
                    <div>
                      <strong>{data.lastBackupAt ? formatRelativeFR(data.lastBackupAt) : 'Jamais'}</strong>
                      <p>dernière sauvegarde · {humanFileSize(data.storageBytes)}</p>
                    </div>
                  </div>
                </div>
                <div className="pulse-actions">
                  <Link to="/sauvegardes">
                    <Button variant="secondary" size="sm" icon={<DatabaseBackup size={14} />}>
                      Sauvegarder
                    </Button>
                  </Link>
                  <Link to="/factures?status=overdue">
                    <Button variant="ghost" size="sm" trailingIcon={<ArrowRight size={13} />}>
                      Voir les retards
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}

function RecentInvoiceRow({ invoice }: { invoice: InvoiceSummary }) {
  return (
    <tr className="is-clickable" onClick={() => navigate(`/factures/${invoice.id}`)}>
      <td>
        <div className="table-primary">
          <span className={`doc-icon ${invoice.type === 'credit_note' ? '' : 'accent'}`}>
            <FileText size={15} />
          </span>
          <span className="doc-meta">
            <strong>{invoice.number ?? 'Brouillon'}</strong>
            <span>{invoice.type === 'credit_note' ? 'Avoir' : 'Facture'} · {formatDateFR(invoice.issueDate)}</span>
          </span>
        </div>
      </td>
      <td>{invoice.clientName || '—'}</td>
      <td className="muted">{formatDateFR(invoice.dueDate)}</td>
      <td className="num strong">{euro(invoice.totalTtcCents)}</td>
      <td>
        <StatusBadge status={invoice.effectiveStatus as EffectiveStatus} size="sm" />
      </td>
    </tr>
  );
}

function ActivityRow({ activity }: { activity: ActivityItem }) {
  const Icon = ACTIVITY_ICONS[activity.type] ?? Activity;
  return (
    <li className="activity-row">
      <span className="activity-icon">
        <Icon size={14} />
      </span>
      <div>
        <strong>{activity.title}</strong>
        {activity.detail ? <p>{activity.detail}</p> : null}
        <span className="activity-time">{formatRelativeFR(activity.createdAt)}</span>
      </div>
    </li>
  );
}
