import type { ISODate, PeriodPreset, PeriodRange } from './types';

const MONTHS_LONG = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toISODate(date: Date): ISODate {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function fromISODate(value: ISODate): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = fromISODate(value);
  return !Number.isNaN(date.getTime()) && toISODate(date) === value;
}

export function addDays(value: ISODate, days: number): ISODate {
  const date = fromISODate(value);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function addMonths(value: ISODate, months: number): ISODate {
  const date = fromISODate(value);
  const targetDay = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(targetDay, lastDay));
  return toISODate(date);
}

export function endOfMonth(value: ISODate): ISODate {
  const date = fromISODate(value);
  return toISODate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function startOfMonth(value: ISODate): ISODate {
  const date = fromISODate(value);
  return toISODate(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function startOfWeek(value: ISODate): ISODate {
  const date = fromISODate(value);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(value, diff);
}

export function startOfQuarter(value: ISODate): ISODate {
  const date = fromISODate(value);
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3;
  return toISODate(new Date(date.getFullYear(), quarterMonth, 1));
}

export function startOfYear(value: ISODate): ISODate {
  return `${value.slice(0, 4)}-01-01`;
}

export function endOfYear(value: ISODate): ISODate {
  return `${value.slice(0, 4)}-12-31`;
}

export function formatDateFR(value: ISODate | null | undefined): string {
  if (!value || !isValidISODate(value)) return '—';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

export function formatDateLongFR(value: ISODate | null | undefined): string {
  if (!value || !isValidISODate(value)) return '—';
  const date = fromISODate(value);
  return `${date.getDate()} ${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatDateTimeFR(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()} à ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatRelativeFR(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return '—';
  const diff = Date.now() - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} heure${hours > 1 ? 's' : ''}`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'hier';
  if (days < 30) return `il y a ${days} jours`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  return formatDateFR(toISODate(new Date(date)));
}

export function monthShortLabel(monthIndex: number): string {
  return MONTHS_SHORT[monthIndex] ?? '';
}

export function monthLongLabel(monthIndex: number): string {
  return MONTHS_LONG[monthIndex] ?? '';
}

export function weekdayLabel(value: ISODate): string {
  return WEEKDAYS[fromISODate(value).getDay()] ?? '';
}

export function getPeriodRange(preset: PeriodPreset, customFrom?: ISODate, customTo?: ISODate): PeriodRange {
  const today = todayISO();
  switch (preset) {
    case 'today':
      return { preset, from: today, to: today, label: "Aujourd'hui" };
    case 'week': {
      const from = startOfWeek(today);
      return { preset, from, to: addDays(from, 6), label: 'Cette semaine' };
    }
    case 'month': {
      const from = startOfMonth(today);
      return { preset, from, to: endOfMonth(today), label: 'Ce mois' };
    }
    case 'quarter': {
      const from = startOfQuarter(today);
      const date = fromISODate(from);
      const end = new Date(date.getFullYear(), date.getMonth() + 3, 0);
      return { preset, from, to: toISODate(end), label: 'Ce trimestre' };
    }
    case 'year':
      return { preset, from: startOfYear(today), to: endOfYear(today), label: 'Cette année' };
    case 'custom':
      return {
        preset,
        from: customFrom ?? today,
        to: customTo ?? today,
        label: 'Période personnalisée',
      };
    case 'all':
    default:
      return { preset: 'all', from: '2000-01-01', to: '2099-12-31', label: 'Tout' };
  }
}

/** Période précédente de même durée, pour le calcul des évolutions. */
export function previousPeriod(range: PeriodRange): PeriodRange {
  if (range.preset === 'all') return { ...range, from: '1900-01-01', to: '1900-01-01' };
  const from = fromISODate(range.from);
  const to = fromISODate(range.to);
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const prevTo = addDays(range.from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { ...range, from: prevFrom, to: prevTo };
}

export function eachMonthOfYear(year: number): { key: string; label: string; month: number }[] {
  return Array.from({ length: 12 }, (_, month) => ({
    key: `${year}-${pad2(month + 1)}`,
    label: MONTHS_SHORT[month],
    month,
  }));
}

export function lastMonths(count: number, from = todayISO()): { key: string; label: string; year: number; month: number }[] {
  const base = fromISODate(from);
  const result: { key: string; label: string; year: number; month: number }[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(base.getFullYear(), base.getMonth() - i, 1);
    result.push({
      key: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`,
      label: MONTHS_SHORT[date.getMonth()],
      year: date.getFullYear(),
      month: date.getMonth(),
    });
  }
  return result;
}

export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((fromISODate(to).getTime() - fromISODate(from).getTime()) / 86_400_000);
}

export function isAfter(a: ISODate, b: ISODate): boolean {
  return a > b;
}

export function dueDateFromTerms(issueDate: ISODate, days: number, endOfMonthRule = false): ISODate {
  const result = addDays(issueDate, Math.max(0, Math.round(days)));
  return endOfMonthRule ? endOfMonth(result) : result;
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function formatMonthYearFR(value: ISODate): string {
  if (!isValidISODate(value)) return '—';
  const date = fromISODate(value);
  return `${MONTHS_LONG[date.getMonth()]} ${date.getFullYear()}`;
}

export function monthKey(value: ISODate): string {
  return value.slice(0, 7);
}
