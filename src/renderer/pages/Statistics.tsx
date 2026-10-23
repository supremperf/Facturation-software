import { useEffect, useState } from 'react';
import { BarChart3, Download, FileJson, Percent, TrendingUp, Wallet } from 'lucide-react';
import { todayISO } from '@shared/dates';
import { api, errorMessage } from '../lib/api';
import { useAppData } from '../lib/app-context';
import { useAsync } from '../lib/hooks';
import { euro, numberFR } from '../lib/format';
import { useToast } from '../components/Toast';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  InlineError,
  KpiCard,
  LoadingBlock,
  PageHeader,
  Select,
} from '../components/ui';
import { BarChart, ChartLegend, HBars } from '../components/Charts';

export function StatisticsPage() {
  const toast = useToast();
  const { dataVersion } = useAppData();
  const currentYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const { data, loading, error, reload } = useAsync(() => api.stats(year), [year, dataVersion]);

  const years = data?.availableYears?.length ? data.availableYears : [currentYear];
  useEffect(() => {
    if (data && !data.availableYears.includes(year) && data.availableYears.length) {
      // Ne force pas la sélection : la base peut simplement ne pas avoir de données pour cette année.
    }
  }, [data, year]);

  const monthly = data?.monthly ?? [];
  const hasData = (data?.totals.invoiceCount ?? 0) > 0;

  const exportVat = async () => {
    try {
      const result = await api.exports.vatCsv(`${year}-01-01`, `${year}-12-31`);
      if (!result.canceled) toast.success('Export TVA créé', result.path);
    } catch (reason) {
      toast.error('Export impossible', errorMessage(reason));
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Analyse"
        title="Statistiques"
        subtitle="Indicateurs calculés à partir des factures émises, avoirs et encaissements enregistrés."
        actions={
          <>
            <Select value={String(year)} onChange={(event) => setYear(Number(event.target.value))} aria-label="Année">
              {years.map((item) => (
                <option key={item} value={item}>
                  Exercice {item}
                </option>
              ))}
            </Select>
            <Button variant="secondary" icon={<FileJson size={15} />} onClick={exportVat}>
              Exporter la TVA
            </Button>
          </>
        }
      />

      {error ? <InlineError message={errorMessage(error)} onRetry={reload} /> : null}

      {loading && !data ? (
        <LoadingBlock label="Calcul des statistiques…" height={400} />
      ) : data ? (
        <>
          <div className="kpi-grid">
            <KpiCard
              label="Chiffre d'affaires HT"
              value={euro(data.totals.revenueHtCents)}
              hint={`TTC : ${euro(data.totals.revenueTtcCents)}`}
              icon={TrendingUp}
              tone="accent"
            />
            <KpiCard
              label="TVA collectée"
              value={euro(data.totals.vatCents)}
              hint={`${data.vatByRate.length} taux utilisé${data.vatByRate.length > 1 ? 's' : ''}`}
              icon={Percent}
              tone="info"
            />
            <KpiCard
              label="Encaissements"
              value={euro(data.totals.collectedCents)}
              hint={`Reste dû : ${euro(data.totals.outstandingCents)}`}
              icon={Wallet}
              tone="success"
            />
            <KpiCard
              label="Panier moyen"
              value={euro(data.totals.averageInvoiceCents)}
              hint={`${numberFR(data.totals.invoiceCount)} facture${data.totals.invoiceCount > 1 ? 's' : ''} émise${data.totals.invoiceCount > 1 ? 's' : ''}`}
              icon={BarChart3}
              tone="warning"
            />
          </div>

          {!hasData ? (
            <Card>
              <EmptyState
                icon={BarChart3}
                title={`Aucune donnée pour l'exercice ${year}`}
                description="Les statistiques se construisent à partir de vos factures réelles. Émettez une facture pour voir apparaître les indicateurs."
              />
            </Card>
          ) : null}

          <div className="stats-grid">
            <Card>
              <CardHeader
                title="Activité mensuelle"
                subtitle={`Facturation et encaissements de l'exercice ${year}`}
                actions={
                  <div className="mini-legend">
                    <span>
                      <i style={{ background: '#6c5ce7' }} /> Facturé HT
                    </span>
                    <span>
                      <i style={{ background: '#34d399' }} /> Encaissé
                    </span>
                  </div>
                }
              />
              <div className="card-body chart-body">
                <BarChart
                  data={monthly.map((month) => ({
                    label: month.label,
                    values: [month.htCents, month.paidCents],
                  }))}
                  colors={['#6c5ce7', '#34d399']}
                  height={300}
                />
              </div>
            </Card>

            <Card>
              <CardHeader title="TVA par taux" subtitle="Assiette et taxe collectée" />
              <div className="card-body card-body-flush">
                {data.vatByRate.length === 0 ? (
                  <EmptyState compact icon={Percent} title="Aucune TVA collectée" description="Régime de franchise ou aucune facture émise." />
                ) : (
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Taux</th>
                        <th className="num">Base HT</th>
                        <th className="num">TVA</th>
                        <th className="num">Part</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.vatByRate.map((entry) => {
                        const share = data.totals.vatCents > 0 ? (entry.vatCents / data.totals.vatCents) * 100 : 0;
                        return (
                          <tr key={entry.rateBp}>
                            <td className="strong">{(entry.rateBp / 100).toLocaleString('fr-FR')} %</td>
                            <td className="num">{euro(entry.baseCents)}</td>
                            <td className="num strong">{euro(entry.vatCents)}</td>
                            <td className="num">
                              <div className="inline-progress">
                                <span style={{ width: `${share}%` }} />
                                <em>{numberFR(share, 0)} %</em>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card-foot-note">
                Total TVA collectée : <strong>{euro(data.totals.vatCents)}</strong>
                {data.totals.creditNotesCents > 0 ? ` · avoirs : ${euro(data.totals.creditNotesCents)}` : ''}
              </div>
            </Card>
          </div>

          <div className="stats-grid stats-grid-bottom">
            <Card>
              <CardHeader title="Meilleurs clients" subtitle="Chiffre d'affaires TTC par client" actions={<span className="chart-total">{euro(data.totals.revenueTtcCents)}</span>} />
              <div className="card-body">
                {data.topClients.length === 0 ? (
                  <EmptyState compact icon={BarChart3} title="Pas encore de client facturé" />
                ) : (
                  <HBars
                    items={data.topClients.map((client) => ({
                      label: client.name,
                      value: client.totalCents,
                      hint: `${numberFR(client.count)} facture${client.count > 1 ? 's' : ''}`,
                    }))}
                    formatValue={euro}
                  />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Encaissements mensuels" subtitle="Trésorerie réellement perçue" />
              <div className="card-body chart-body">
                {data.monthlyPayments.every((month) => month.amountCents === 0) ? (
                  <EmptyState compact icon={Wallet} title="Aucun encaissement enregistré" description="Les règlements apparaîtront ici." />
                ) : (
                  <div className="payment-bars">
                    <ChartLegend
                      items={[
                        { label: 'Encaissé sur l’exercice', color: '#34d399', value: euro(data.totals.collectedCents) },
                      ]}
                    />
                    <div className="month-bars">
                      {data.monthlyPayments.map((month) => {
                        const max = Math.max(...data.monthlyPayments.map((item) => item.amountCents), 1);
                        const height = (month.amountCents / max) * 100;
                        return (
                          <div key={month.label} className="month-bar">
                            <div className="month-bar-track">
                              <span style={{ height: `${Math.max(height, month.amountCents > 0 ? 3 : 0)}%` }} />
                            </div>
                            <small>{month.label}</small>
                            <b>{month.amountCents > 0 ? euro(month.amountCents) : '—'}</b>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>

          <p className="page-note">
            <Download size={13} /> Les exports CSV utilisent le point-virgule et l'encodage UTF-8 avec BOM pour une
            ouverture directe dans Excel.
          </p>
        </>
      ) : null}
    </div>
  );
}
