import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { STATUS_META } from '@shared/constants';
import type { EffectiveStatus } from '@shared/types';
import { centsToEuroInput, parseEuroToCents } from '@shared/money';
import { compareDelta } from '../lib/format';

/* ------------------------------------------------------------------ */
/* Boutons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  trailingIcon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  trailingIcon,
  block,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${block ? 'btn-block' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="spin" /> : icon}
      {children ? <span>{children}</span> : null}
      {trailingIcon}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button type="button" className={`icon-btn ${className}`.trim()} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Structure                                                           */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return <Tag className={`card ${className}`.trim()}>{children}</Tag>;
}

export function CardHeader({
  title,
  subtitle,
  actions,
  icon: Icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <header className="card-header">
      <div className="card-heading">
        {Icon ? (
          <span className="card-icon">
            <Icon size={17} />
          </span>
        ) : null}
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="card-actions">{actions}</div> : null}
    </header>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function SectionHeading({ title, hint, actions }: { title: string; hint?: string; actions?: ReactNode }) {
  return (
    <div className="section-heading">
      <div>
        <h3>{title}</h3>
        {hint ? <p>{hint}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badges & états                                                      */
/* ------------------------------------------------------------------ */

export function StatusBadge({ status, size = 'md' }: { status: EffectiveStatus; size?: 'sm' | 'md' }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span
      className={`badge badge-${size}`}
      style={{ color: meta.color, background: meta.background, borderColor: `${meta.color}33` }}
    >
      <span className="badge-dot" style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
}) {
  return <span className={`badge badge-tone-${tone}`}>{children}</span>;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? 'empty-compact' : ''}`.trim()}>
      <span className="empty-icon">
        <Icon size={compact ? 20 : 26} strokeWidth={1.7} />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = 'Chargement…', height }: { label?: string; height?: number }) {
  return (
    <div className="loading-block" style={height ? { minHeight: height } : undefined}>
      <Loader2 size={20} className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function InlineError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="inline-error">
      <AlertCircle size={18} />
      <div>
        <strong>Impossible de charger les données</strong>
        <p>{message}</p>
      </div>
      {onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          Réessayer
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Champs de formulaire                                                */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  error,
  required,
  children,
  htmlFor,
  className = '',
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <div className={`field ${className}`.trim()}>
      <label htmlFor={htmlFor} className="field-label">
        {label}
        {required ? <span className="required">*</span> : null}
      </label>
      {children}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className = '', invalid, ...rest }, ref) {
    return <input ref={ref} className={`input ${invalid ? 'input-invalid' : ''} ${className}`.trim()} {...rest} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className = '', ...rest }, ref) {
    return <textarea ref={ref} className={`input textarea ${className}`.trim()} {...rest} />;
  },
);

export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select-wrap">
      <select className={`input select ${className}`.trim()} {...rest}>
        {children}
      </select>
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={`switch-row ${disabled ? 'is-disabled' : ''}`.trim()}>
      <div>
        <label htmlFor={id} className="switch-label">
          {label}
        </label>
        {hint ? <p className="switch-hint">{hint}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={`switch ${checked ? 'is-on' : ''}`.trim()}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

export function MoneyInput({
  value,
  onChange,
  id,
  placeholder = '0,00',
  disabled,
  ariaLabel,
}: {
  value: number;
  onChange: (cents: number) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => centsToEuroInput(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(centsToEuroInput(value));
  }, [value, focused]);

  const commit = () => {
    const cents = parseEuroToCents(text);
    if (cents === null) {
      setText(centsToEuroInput(value));
      return;
    }
    const safe = Math.max(0, cents);
    onChange(safe);
    setText(centsToEuroInput(safe));
  };

  return (
    <span className="money-input">
      <input
        id={id}
        aria-label={ariaLabel}
        className="input input-number"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
      />
      <span className="suffix">€</span>
    </span>
  );
}

export function PercentInput({
  valueBp,
  onChange,
  disabled,
  ariaLabel,
}: {
  valueBp: number;
  onChange: (bp: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(() => (valueBp / 100).toString().replace('.', ','));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText((valueBp / 100).toString().replace('.', ','));
  }, [valueBp, focused]);
  return (
    <span className="money-input">
      <input
        aria-label={ariaLabel}
        className="input input-number"
        inputMode="decimal"
        value={text}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          setFocused(false);
          const parsed = Number.parseFloat(text.replace(',', '.'));
          if (!Number.isFinite(parsed)) {
            setText((valueBp / 100).toString().replace('.', ','));
            return;
          }
          onChange(Math.max(0, Math.round(parsed * 100)));
        }}
      />
      <span className="suffix">%</span>
    </span>
  );
}

export function QuantityInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(() => String(value).replace('.', ','));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(String(value).replace('.', ','));
  }, [value, focused]);
  return (
    <input
      className="input input-number"
      inputMode="decimal"
      aria-label="Quantité"
      value={text}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        setFocused(false);
        const parsed = Number.parseFloat(text.replace(',', '.'));
        const safe = Number.isFinite(parsed) ? Math.max(0, parsed) : value;
        onChange(safe);
        setText(String(safe).replace('.', ','));
      }}
    />
  );
}

export function SearchField({
  value,
  onChange,
  placeholder = 'Rechercher…',
  ariaLabel = 'Rechercher',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <span className="search-field">
      <Search size={16} />
      <input
        className="input"
        type="search"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Effacer la recherche">
          <X size={14} />
        </button>
      ) : null}
    </span>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: string; icon?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`segmented segmented-${size}`} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={`segmented-item ${value === option.value ? 'is-active' : ''}`.trim()}
          onClick={() => onChange(option.value)}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={`tab ${value === tab.value ? 'is-active' : ''}`.trim()}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {typeof tab.count === 'number' ? <span className="tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fenêtres modales                                                    */
/* ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <IconButton label="Fermer" onClick={onClose} className="modal-close" autoFocus>
            <X size={18} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  danger = false,
  loading = false,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="confirm-text">{description}</p>
      {children}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Tableaux / pagination                                               */
/* ------------------------------------------------------------------ */

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (totalPages <= 1) {
    return <p className="pagination-total">{total} résultat{total > 1 ? 's' : ''}</p>;
  }
  return (
    <div className="pagination">
      <p className="pagination-total">
        Page {page} sur {totalPages} · {total} résultat{total > 1 ? 's' : ''}
      </p>
      <div className="pagination-actions">
        <IconButton label="Page précédente" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton label="Page suivante" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Indicateurs                                                         */
/* ------------------------------------------------------------------ */

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  delta,
  sparkline,
  tone = 'accent',
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  delta?: { current: number; previous: number };
  sparkline?: ReactNode;
  tone?: 'accent' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const change = delta ? compareDelta(delta.current, delta.previous) : null;
  return (
    <Card className={`kpi-card kpi-${tone}`}>
      <div className="kpi-top">
        <span className="kpi-icon">
          <Icon size={18} />
        </span>
        {change ? (
          <span className={`kpi-delta kpi-delta-${change.direction}`} title="Comparaison avec la période précédente">
            {change.direction === 'up' ? '↗' : change.direction === 'down' ? '↘' : '→'} {change.label}
          </span>
        ) : null}
      </div>
      <p className="kpi-label">{label}</p>
      <p className="kpi-value">{value}</p>
      {hint ? <p className="kpi-hint">{hint}</p> : null}
      {sparkline ? <div className="kpi-sparkline">{sparkline}</div> : null}
    </Card>
  );
}

export function ProgressBar({ value, max, tone = 'accent' }: { value: number; max: number; tone?: string }) {
  const ratio = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div className={`progress-fill progress-${tone}`} style={{ width: `${ratio}%` }} />
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {initials || '?'}
    </span>
  );
}

export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
