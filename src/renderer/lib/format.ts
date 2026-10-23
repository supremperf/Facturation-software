import { formatDateFR, formatDateTimeFR, formatDateLongFR, formatRelativeFR } from '@shared/dates';
import { formatEuros, formatPercentFromBp, formatQuantity } from '@shared/money';

export {
  formatDateFR,
  formatDateTimeFR,
  formatDateLongFR,
  formatRelativeFR,
  formatEuros,
  formatPercentFromBp,
  formatQuantity,
};

/**
 * L'interface utilise une espace insécable classique (U+00A0) comme séparateur
 * de milliers : la fine insécable produite par Intl est trop étroite avec la
 * police Inter et les montants paraissent collés. Les PDF conservent leur
 * propre normalisation.
 */
const uiSpaces = (value: string): string => value.replace(/\u202f/g, '\u00a0');

export const euro = (cents: number): string => uiSpaces(formatEuros(cents));
export const euroNoSymbol = (cents: number): string => uiSpaces(formatEuros(cents, { withSymbol: false }));
export const euroSigned = (cents: number): string => uiSpaces(formatEuros(cents, { signed: true }));
export const percent = (bp: number): string => uiSpaces(formatPercentFromBp(bp));

export function euroCompact(cents: number): string {
  const value = cents / 100;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value / 1_000_000)}\u00a0M€`;
  }
  if (abs >= 10_000) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value / 1000)}\u00a0k€`;
  }
  return uiSpaces(formatEuros(cents));
}

export function numberFR(value: number, maximumFractionDigits = 0): string {
  return uiSpaces(new Intl.NumberFormat('fr-FR', { maximumFractionDigits }).format(value));
}

export function initials(name: string): string {
  const parts = name
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${numberFR(count)} ${count > 1 ? pluralForm ?? `${singular}s` : singular}`;
}

export function daysLabel(days: number): string {
  if (days === 0) return "aujourd'hui";
  if (days === 1) return 'demain';
  if (days === -1) return 'hier';
  return days > 0 ? `dans ${days} jours` : `il y a ${Math.abs(days)} jours`;
}

export function truncate(value: string, max = 60): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: index === 0 ? 0 : 1 }).format(value)} ${units[index]}`;
}

export function compareDelta(current: number, previous: number): {
  value: number;
  label: string;
  direction: 'up' | 'down' | 'flat';
} {
  if (previous === 0) {
    return current === 0
      ? { value: 0, label: 'stable', direction: 'flat' }
      : { value: 100, label: 'nouveau', direction: 'up' };
  }
  const delta = ((current - previous) / Math.abs(previous)) * 100;
  const direction = delta > 0.05 ? 'up' : delta < -0.05 ? 'down' : 'flat';
  const label = `${delta > 0 ? '+' : ''}${new Intl.NumberFormat('fr-FR', {
    maximumFractionDigits: 1,
  }).format(delta)}\u00a0%`;
  return { value: delta, label, direction };
}

export function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    draft: 'Brouillon',
    issued: 'Émise',
    sent: 'Envoyée',
    partial: 'Partiellement payée',
    paid: 'Payée',
    overdue: 'En retard',
    cancelled: 'Annulée',
  };
  return labels[value] ?? value;
}
