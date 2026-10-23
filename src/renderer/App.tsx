import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, SearchX, Sparkles } from 'lucide-react';
import { APP_EVENTS } from '@shared/ipc';
import { api, errorMessage } from './lib/api';
import { AppProvider, useAppData } from './lib/app-context';
import { navigate, useRoute } from './lib/router';
import { ToastProvider, useToast } from './components/Toast';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { CommandPalette } from './components/CommandPalette';
import { Button } from './components/ui';
import { DashboardPage } from './pages/Dashboard';
import { InvoicesPage } from './pages/Invoices';
import { InvoiceDetailPage } from './pages/InvoiceDetail';
import { InvoiceEditorPage } from './pages/InvoiceEditor';
import { CreditNotesPage } from './pages/CreditNotes';
import { ClientsPage } from './pages/Clients';
import { PaymentsPage } from './pages/Payments';
import { StatisticsPage } from './pages/Statistics';
import { ReportsPage } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { CompanyIdentityPage } from './pages/CompanyIdentity';
import { BackupsPage } from './pages/Backups';
import { WelcomePage } from './pages/Welcome';

export function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <AppRoot />
      </AppProvider>
    </ToastProvider>
  );
}

function AppRoot() {
  const { settings, appInfo, loading, error, refresh, dataVersion, bumpData, setupSkipped } = useAppData();
  const toast = useToast();
  const route = useRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    api.invoices
      .list({ status: 'overdue', pageSize: 1 })
      .then((result) => setOverdueCount(result.total))
      .catch(() => setOverdueCount(0));
  }, [dataVersion, route.pathname]);

  useEffect(() => {
    const unsubscribeRestored = window.facturepro?.on(APP_EVENTS.dataRestored, () => {
      void refresh().then(() => {
        bumpData();
        toast.info('Données restaurées', 'L’application a rechargé la sauvegarde.');
      });
    });
    const unsubscribeNew = window.facturepro?.on(APP_EVENTS.menuNewInvoice, () => navigate('/factures/nouvelle'));
    const unsubscribeSettings = window.facturepro?.on(APP_EVENTS.menuOpenSettings, () => navigate('/parametres'));
    const unsubscribeNavigate = window.facturepro?.on(APP_EVENTS.navigate, (payload) => {
      if (typeof payload === 'string') navigate(payload);
      else if (payload && typeof payload === 'object' && 'to' in payload) {
        const to = (payload as { to?: unknown }).to;
        if (typeof to === 'string') navigate(to);
      }
    });
    return () => {
      unsubscribeRestored?.();
      unsubscribeNew?.();
      unsubscribeSettings?.();
      unsubscribeNavigate?.();
    };
  }, [refresh, bumpData, toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        navigate('/factures/nouvelle');
      } else if (event.key === ',') {
        event.preventDefault();
        navigate('/parametres');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route.pathname]);

  if (loading && !settings) {
    return <Splash />;
  }

  if (error && !settings) {
    return (
      <div className="fatal-screen">
        <span className="fatal-icon">
          <AlertTriangle size={26} />
        </span>
        <h1>Impossible d'ouvrir FacturePro</h1>
        <p>{error}</p>
        <div className="fatal-actions">
          <Button icon={<RefreshCw size={15} />} onClick={() => void refresh()}>
            Réessayer
          </Button>
          <Button variant="ghost" onClick={() => void api.openLogsFolder()}>
            Consulter les journaux
          </Button>
        </div>
        <p className="fatal-hint">
          Vos données ne sont pas supprimées. Si le problème persiste, restaurez une sauvegarde depuis
          %APPDATA%/FacturePro/backups.
        </p>
      </div>
    );
  }

  if (settings && !settings.setupCompleted && !setupSkipped) {
    return <WelcomePage />;
  }

  return (
    <div className="app-shell">
      <Sidebar
        pathname={route.pathname}
        settings={settings}
        storageBytes={(appInfo?.documentsSize ?? 0) + (appInfo?.databaseSize ?? 0)}
        overdueCount={overdueCount}
      />
      <div className="main-area">
        <Topbar pathname={route.pathname} onOpenSearch={() => setPaletteOpen(true)} />
        <main>
          {/* La clé force le remontage quand on passe d'un document à un autre. */}
          <Router key={route.pathname} pathname={route.pathname} />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function Router({ pathname }: { pathname: string }) {
  if (pathname === '/') return <DashboardPage />;
  if (pathname === '/factures') return <InvoicesPage />;
  if (pathname === '/factures/nouvelle') return <InvoiceEditorPage />;
  if (/^\/factures\/[^/]+\/modifier$/.test(pathname)) return <InvoiceEditorPage />;
  if (/^\/factures\/[^/]+$/.test(pathname)) return <InvoiceDetailPage />;
  if (pathname === '/avoirs') return <CreditNotesPage />;
  if (pathname === '/clients') return <ClientsPage />;
  if (pathname === '/paiements') return <PaymentsPage />;
  if (pathname === '/statistiques') return <StatisticsPage />;
  if (pathname === '/rapports') return <ReportsPage />;
  if (pathname === '/parametres') return <SettingsPage />;
  if (pathname === '/parametres/entreprise') return <CompanyIdentityPage />;
  if (pathname === '/sauvegardes') return <BackupsPage />;
  return <NotFound />;
}

function Splash() {
  return (
    <div className="splash">
      <span className="brand-mark splash-mark">
        <Sparkles size={22} />
      </span>
      <strong>FacturePro</strong>
      <span className="splash-loader">
        <Loader2 size={16} className="spin" /> Ouverture de votre espace…
      </span>
    </div>
  );
}

function NotFound() {
  return (
    <div className="page">
      <div className="not-found">
        <span className="empty-icon">
          <SearchX size={26} />
        </span>
        <h1>Page introuvable</h1>
        <p>Cette adresse ne correspond à aucune section de FacturePro.</p>
        <Button onClick={() => navigate('/')}>Retour au tableau de bord</Button>
      </div>
    </div>
  );
}
