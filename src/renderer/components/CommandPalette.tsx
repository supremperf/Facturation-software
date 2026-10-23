import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  Building2,
  DatabaseBackup,
  FileMinus2,
  FilePlus2,
  FileText,
  Plus,
  Search,
  Settings2,
  Users,
} from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { useDebounced } from '../lib/hooks';
import { navigate } from '../lib/router';
import type { GlobalSearchResults } from '@shared/types';

const QUICK_ACTIONS = [
  { label: 'Créer une facture', to: '/factures/nouvelle', icon: FilePlus2, keywords: 'nouvelle facture creer' },
  { label: 'Créer un avoir', to: '/avoirs?action=new', icon: FileMinus2, keywords: 'avoir credit note' },
  { label: 'Ajouter un client', to: '/clients?action=new', icon: Users, keywords: 'client nouveau' },
  { label: 'Statistiques', to: '/statistiques', icon: FileText, keywords: 'stats chiffre affaires' },
  { label: 'Sauvegardes', to: '/sauvegardes', icon: DatabaseBackup, keywords: 'sauvegarde backup' },
  { label: 'Paramètres', to: '/parametres', icon: Settings2, keywords: 'reglages configuration' },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query, 220);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setError(null);
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open || debounced.trim().length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    api
      .search(debounced.trim())
      .then((data) => {
        if (!cancelled) {
          setResults(data);
          setCursor(0);
          setError(null);
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, open]);

  if (!open) return null;

  const trimmed = query.trim().toLowerCase();
  const quick = trimmed
    ? QUICK_ACTIONS.filter(
        (action) => action.label.toLowerCase().includes(trimmed) || action.keywords.includes(trimmed),
      )
    : QUICK_ACTIONS.slice(0, 4);

  const flatResults: { to: string; label: string; detail: string }[] = [
    ...(results?.invoices.map((invoice) => ({
      to: `/factures/${invoice.id}`,
      label: invoice.number ?? 'Brouillon',
      detail: `${invoice.clientName} · ${invoice.detail}`,
    })) ?? []),
    ...(results?.clients.map((client) => ({
      to: `/clients?focus=${client.id}`,
      label: client.name,
      detail: client.detail,
    })) ?? []),
  ];

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const total = quick.length + flatResults.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((value) => (total ? (value + 1) % total : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((value) => (total ? (value - 1 + total) % total : 0));
    } else if (event.key === 'Enter') {
      const action = quick[cursor] ?? (cursor >= quick.length ? flatResults[cursor - quick.length] : null);
      if (action) go(action.to);
    }
  };

  return createPortal(
    <div
      className="palette-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="presentation"
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Recherche globale">
        <div className="palette-input">
          <Search size={18} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Rechercher un client, une facture, une action…"
            aria-label="Recherche globale"
          />
          <kbd>Échap</kbd>
        </div>
        <div className="palette-body">
          {error ? <p className="palette-error">{error}</p> : null}
          {quick.length > 0 ? (
            <div className="palette-section">
              <p className="palette-label">Actions rapides</p>
              {quick.map((action, index) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    className={`palette-row ${cursor === index ? 'is-active' : ''}`.trim()}
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(action.to)}
                  >
                    <span className="palette-icon">
                      <Icon size={16} />
                    </span>
                    <span className="palette-main">{action.label}</span>
                    <ArrowRight size={14} className="palette-arrow" />
                  </button>
                );
              })}
            </div>
          ) : null}

          {flatResults.length > 0 ? (
            <div className="palette-section">
              <p className="palette-label">Résultats</p>
              {flatResults.map((result, index) => {
                const position = quick.length + index;
                return (
                  <button
                    key={`${result.to}-${index}`}
                    type="button"
                    className={`palette-row ${cursor === position ? 'is-active' : ''}`.trim()}
                    onMouseEnter={() => setCursor(position)}
                    onClick={() => go(result.to)}
                  >
                    <span className="palette-icon">
                      {result.to.startsWith('/factures') ? <FileText size={16} /> : <Building2 size={16} />}
                    </span>
                    <span className="palette-main">
                      <strong>{result.label}</strong>
                      <small>{result.detail}</small>
                    </span>
                    <ArrowRight size={14} className="palette-arrow" />
                  </button>
                );
              })}
            </div>
          ) : null}

          {query.trim().length >= 2 && flatResults.length === 0 && quick.length === 0 ? (
            <div className="palette-empty">
              <p>Aucun résultat pour « {query.trim()} ».</p>
              <span>Essayez un numéro de facture, un nom de client ou une action.</span>
            </div>
          ) : null}

          {query.trim().length < 2 ? (
            <p className="palette-tip">
              La recherche couvre les clients, les factures et les avoirs.
            </p>
          ) : null}
        </div>
        <footer className="palette-footer">
          <span>
            <Plus size={12} /> Actions
          </span>
          <span>↑ ↓ naviguer</span>
          <span>↵ ouvrir</span>
          <span>Échap fermer</span>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
