import { useEffect, useRef, type ReactNode } from 'react';
import { RISK_LEVELS, riskLabel, type RiskLevel } from '../../core/db/schema';
import { Icon } from './Icon';

// ------------------------------------------------------------- Card

export function Card({
  title,
  icon,
  action,
  children,
  className = '',
}: {
  title?: string;
  icon?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card card--pad ${className}`}>
      {(title || action) && (
        <header className="card__header">
          {title && (
            <div className="card__title">
              {icon && <Icon name={icon} size={15} />}
              {title}
            </div>
          )}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// ------------------------------------------------------------ Badge

export type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red' | 'plum' | 'outline';

export function Badge({
  tone = 'neutral',
  icon,
  children,
}: {
  tone?: BadgeTone;
  icon?: string;
  children: ReactNode;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

/**
 * Risk indicator — always icon + text label, never color alone
 * (accessibility requirement from the spec).
 */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const tone: BadgeTone =
    level === 'acute' || level === 'high'
      ? 'red'
      : level === 'moderate'
        ? 'amber'
        : level === 'low'
          ? 'green'
          : 'outline';
  const icon = level === 'acute' || level === 'high' ? 'alert' : 'shield';
  return (
    <Badge tone={tone} icon={icon}>
      Risk: {riskLabel(level)}
    </Badge>
  );
}

export function riskDescription(level: RiskLevel): string {
  return RISK_LEVELS.find((r) => r.value === level)?.description ?? '';
}

// ------------------------------------------------------------ Modal

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  narrow,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  narrow?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${narrow ? 'modal--narrow' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <h2 className="modal__title">{title}</h2>
        {subtitle && <p className="modal__subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Field

export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="field">
      <span className="field__label">
        {label}
        {required && <span aria-hidden="true" style={{ color: 'var(--red)' }}> *</span>}
      </span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

// -------------------------------------------------------- EmptyState

export function EmptyState({
  icon = 'file',
  title,
  children,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">
        <Icon name={icon} size={24} />
      </div>
      <strong style={{ color: 'var(--ink-soft)' }}>{title}</strong>
      {children}
    </div>
  );
}
