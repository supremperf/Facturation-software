import {
  BarChart3,
  Building2,
  ChevronRight,
  CreditCard,
  DatabaseBackup,
  FileMinus2,
  FilePlus2,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Settings2,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { SIDEBAR_SECTIONS, companyDisplayName } from '@shared/constants';
import type { AppSettings } from '@shared/types';
import { Link } from '../lib/router';
import { humanFileSize } from '../lib/format';
import { Avatar, ProgressBar } from './ui';

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  invoices: FileText,
  create: FilePlus2,
  credit: FileMinus2,
  clients: Users,
  payments: CreditCard,
  stats: BarChart3,
  reports: FolderKanban,
  settings: Settings2,
  company: Building2,
  backup: DatabaseBackup,
};

function isActive(target: string, pathname: string): boolean {
  if (target === '/') return pathname === '/';
  if (target === '/factures') {
    return pathname === '/factures' || (pathname.startsWith('/factures/') && !pathname.startsWith('/factures/nouvelle'));
  }
  if (target === '/parametres') return pathname === '/parametres';
  return pathname === target || pathname.startsWith(`${target}/`);
}

export function Sidebar({
  pathname,
  settings,
  storageBytes,
  overdueCount,
}: {
  pathname: string;
  settings: AppSettings | null;
  storageBytes: number;
  overdueCount: number;
}) {
  const company = settings ? companyDisplayName(settings) || 'Votre entreprise' : 'FacturePro';
  // La forme juridique n'est pas toujours renseignée (entreprise individuelle) :
  // on affiche alors l'identifiant légal, jamais un libellé alarmant.
  const role =
    settings?.business.legalForm ||
    (settings?.business.siren ? `SIREN ${settings.business.siren}` : 'Configuration à compléter');
  const storagePercent = Math.min(100, (storageBytes / (40 * 1024 * 1024)) * 100);

  return (
    <aside className="sidebar" aria-label="Navigation principale">
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden="true">
          <Sparkles size={20} strokeWidth={2.1} />
        </span>
        <div className="brand-text">
          <strong>FacturePro</strong>
          <span>Édition 2026</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {SIDEBAR_SECTIONS.map((section) => (
          <div key={section.id}>
            <p className="nav-section-label">{section.label}</p>
            <div className="nav-list">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon] ?? FileText;
                const active = isActive(item.to, pathname);
                return (
                  <Link key={item.to} to={item.to} className={`nav-item ${active ? 'is-active' : ''}`.trim()}>
                    <Icon size={17} strokeWidth={1.9} />
                    <span>{item.label}</span>
                    {item.to === '/factures' && overdueCount > 0 ? (
                      <span className="nav-badge" title={`${overdueCount} facture(s) en retard`}>
                        {overdueCount}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="storage-card">
          <div className="storage-head">
            <span>Stockage local</span>
            <strong>{humanFileSize(storageBytes)}</strong>
          </div>
          <ProgressBar value={storageBytes} max={40 * 1024 * 1024} />
          <p>Données conservées sur ce poste, sans cloud.</p>
        </div>
        <Link to="/parametres/entreprise" className="sidebar-user" title="Identité de l'entreprise">
          <Avatar name={company} size={34} />
          <span className="user-meta">
            <strong>{company}</strong>
            <span>{role}</span>
          </span>
          <ChevronRight size={15} />
        </Link>
      </div>
    </aside>
  );
}
