import { Bell, ChevronRight, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from '../lib/router';
import { Button, IconButton } from './ui';
import { api } from '../lib/api';
import { euro, formatDateFR, formatDateLongFR, formatRelativeFR } from '../lib/format';
import { useClickOutside } from '../lib/hooks';
import { todayISO } from '@shared/dates';
import type { InvoiceSummary } from '@shared/types';

function breadcrumb(pathname: string): { parent: string; current: string } {
  if (pathname === '/') return { parent: '', current: 'Tableau de bord' };
  const map: Record<string, [string, string]> = {
    '/factures': ['Gestion', 'Factures'],
    '/factures/nouvelle': ['Gestion', 'Créer une facture'],
    '/avoirs': ['Gestion', 'Avoirs'],
    '/clients': ['Gestion', 'Clients'],
    '/paiements': ['Gestion', 'Paiements'],
    '/statistiques': ['Analyse', 'Statistiques'],
    '/rapports': ['Analyse', 'Rapports'],
    '/parametres': ['Configuration', 'Paramètres'],
    '/parametres/entreprise': ['Configuration', "Identité de l'entreprise"],
    '/sauvegardes': ['Configuration', 'Sauvegardes'],
  };
  if (map[pathname]) return { parent: map[pathname][0], current: map[pathname][1] };
  if (pathname.startsWith('/factures/')) return { parent: 'Gestion', current: 'Facture' };
  return { parent: 'FacturePro', current: 'Page' };
}

export function Topbar({
  pathname,
  onOpenSearch,
}: {
  pathname: string;
  onOpenSearch: () => void;
}) {
  const crumb = breadcrumb(pathname);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [overdue, setOverdue] = useState<InvoiceSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const popoverRef = useClickOutside<HTMLDivElement>(() => setAlertsOpen(false));

  useEffect(() => {
    if (!alertsOpen || loaded) return;
    api.invoices
      .list({ status: 'overdue', pageSize: 5, sortBy: 'dueDate', sortDir: 'asc' })
      .then((result) => {
        setOverdue(result.items);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [alertsOpen, loaded]);

  return (
    <header className="topbar">
      <div className="topbar-crumb">
        {crumb.parent ? (
          <>
            <span>{crumb.parent}</span>
            <ChevronRight size={13} />
          </>
        ) : null}
        <strong>{crumb.current}</strong>
      </div>

      <div className="topbar-search">
        <button type="button" onClick={onOpenSearch} aria-label="Rechercher dans FacturePro">
          <Search size={15} />
          <span>Rechercher un client, une facture…</span>
          <kbd>Ctrl K</kbd>
        </button>
      </div>

      <div className="topbar-actions">
        {window.facturepro?.platform === 'web-preview' ? (
          <span className="preview-badge" title="Serveur d’aperçu : même backend et même base SQLite que l’application de bureau.">
            Aperçu navigateur
          </span>
        ) : null}
        <span className="topbar-date">{formatDateLongFR(todayISO())}</span>
        <div className="topbar-bell" ref={popoverRef}>
          <IconButton label="Alertes et échéances" onClick={() => setAlertsOpen((value) => !value)}>
            <Bell size={17} />
            {overdue.length > 0 ? <span className="dot" /> : null}
          </IconButton>
          {alertsOpen ? (
            <div className="alerts-popover">
              <div className="alerts-head">
                <strong>Alertes</strong>
                <span>{formatDateFR(todayISO())}</span>
              </div>
              {!loaded ? (
                <p className="alerts-empty">Chargement…</p>
              ) : overdue.length === 0 ? (
                <p className="alerts-empty">Aucune facture en retard. Tout est à jour.</p>
              ) : (
                <>
                  {overdue.map((invoice) => (
                    <Link
                      key={invoice.id}
                      to={`/factures/${invoice.id}`}
                      className="alert-row"
                      onClick={() => setAlertsOpen(false)}
                    >
                      <span className="alert-icon">!</span>
                      <span>
                        <strong>{invoice.number ?? 'Brouillon'}</strong>
                        <small>
                          {invoice.clientName} · échue le {formatDateFR(invoice.dueDate)}
                        </small>
                      </span>
                      <b>{euro(invoice.balanceCents)}</b>
                    </Link>
                  ))}
                  <Link to="/factures?status=overdue" className="alerts-more" onClick={() => setAlertsOpen(false)}>
                    Voir toutes les factures en retard
                  </Link>
                </>
              )}
              <p className="alerts-foot">Dernière activité : {formatRelativeFR(new Date().toISOString())}</p>
            </div>
          ) : null}
        </div>
        <Link to="/factures/nouvelle">
          <Button size="sm" icon={<Plus size={15} />}>
            Nouvelle facture
          </Button>
        </Link>
      </div>
    </header>
  );
}
