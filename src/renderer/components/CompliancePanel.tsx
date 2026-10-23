import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Info, ShieldCheck, ShieldX } from 'lucide-react';
import type { ComplianceCheck, ComplianceReport } from '@shared/types';
import { Link } from '../lib/router';
import { Card, CardHeader, LoadingBlock } from './ui';

const CATEGORY_LABEL: Record<string, string> = {
  company: 'Entreprise',
  client: 'Client',
  invoice: 'Document',
  lines: 'Lignes',
  vat: 'TVA',
  payment: 'Règlement',
  e_invoicing: 'Facturation électronique',
};

function CheckIcon({ check }: { check: ComplianceCheck }) {
  if (check.status === 'ok') return <CheckCircle2 size={15} className="check-ok" />;
  if (check.status === 'not_applicable') return <Info size={15} className="check-na" />;
  if (check.severity === 'blocking') return <ShieldX size={15} className="check-blocking" />;
  return <AlertTriangle size={15} className="check-warning" />;
}

export function CompliancePanel({
  report,
  loading = false,
  title = 'Contrôle de conformité',
  emptyMessage = "Complétez le document pour lancer l'analyse.",
}: {
  report: ComplianceReport | null;
  loading?: boolean;
  title?: string;
  emptyMessage?: string;
}) {
  const [showValid, setShowValid] = useState(false);

  const issues = useMemo(
    () =>
      (report?.checks ?? []).filter(
        (check) => check.status === 'missing' || check.status === 'incoherent',
      ),
    [report],
  );
  const valid = useMemo(() => (report?.checks ?? []).filter((check) => check.status === 'ok'), [report]);
  const blocking = issues.filter((check) => check.severity === 'blocking');
  const warnings = issues.filter((check) => check.severity !== 'blocking');

  return (
    <Card className="compliance-card">
      <CardHeader
        title={title}
        subtitle={report ? `Référentiel ${report.rulesVersion}` : 'Analyse en cours'}
        icon={ShieldCheck}
      />
      <div className="card-body">
        {loading && !report ? (
          <LoadingBlock label="Vérification des mentions…" height={160} />
        ) : !report ? (
          <p className="paper-muted">{emptyMessage}</p>
        ) : (
          <>
            <div className={`compliance-summary ${report.canIssue ? 'is-ok' : 'is-blocked'}`}>
              <span className="compliance-summary-icon">
                {report.canIssue ? <ShieldCheck size={22} /> : <ShieldX size={22} />}
              </span>
              <div>
                <strong>
                  {report.canIssue
                    ? 'Document conforme, prêt à être émis'
                    : `${report.blockingCount} point${report.blockingCount > 1 ? 's' : ''} bloquant${report.blockingCount > 1 ? 's' : ''}`}
                </strong>
                <p>
                  {report.canIssue
                    ? `${report.okCount} contrôles validés${report.warningCount > 0 ? ` · ${report.warningCount} avertissement${report.warningCount > 1 ? 's' : ''}` : ''}`
                    : 'Corrigez les éléments ci-dessous pour débloquer l’émission.'}
                </p>
              </div>
            </div>

            {blocking.length > 0 ? (
              <ul className="check-list">
                {blocking.map((check) => (
                  <li key={check.id} className="check-row is-blocking">
                    <CheckIcon check={check} />
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.message}</p>
                      <span className="check-category">{CATEGORY_LABEL[check.category] ?? check.category}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {warnings.length > 0 ? (
              <ul className="check-list">
                {warnings.map((check) => (
                  <li key={check.id} className="check-row is-warning">
                    <CheckIcon check={check} />
                    <div>
                      <strong>{check.label}</strong>
                      <p>{check.message}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {issues.length === 0 ? (
              <p className="compliance-allgood">
                Toutes les mentions obligatoires sont présentes et cohérentes.
              </p>
            ) : null}

            {blocking.length > 0 ? (
              <div className="compliance-fix">
                <p>Ces informations se renseignent dans la configuration ; le contrôle les relit à chaque frappe.</p>
                <div className="compliance-fix-actions">
                  <Link to="/parametres/entreprise" className="btn btn-secondary btn-sm">
                    Identité de l'entreprise
                  </Link>
                  <Link to="/parametres" className="btn btn-ghost btn-sm">
                    Mentions légales
                  </Link>
                </div>
              </div>
            ) : null}

            {valid.length > 0 ? (
              <div className="compliance-valid">
                <button type="button" className="link-button" onClick={() => setShowValid((value) => !value)}>
                  {showValid ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showValid ? 'Masquer' : 'Afficher'} les {valid.length} contrôles validés
                </button>
                {showValid ? (
                  <ul className="check-list check-list-valid">
                    {valid.map((check) => (
                      <li key={check.id} className="check-row">
                        <CheckIcon check={check} />
                        <div>
                          <strong>{check.label}</strong>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
