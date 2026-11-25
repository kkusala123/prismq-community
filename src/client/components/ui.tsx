import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, AlertCircle, CheckCircle2, Info, AlertTriangle, Loader2, X } from 'lucide-react';

export const INPUT_CLS =
  'h-10 w-full rounded-lg border border-[#D8DEE8] bg-white px-3 text-base text-[#1E293B] placeholder:text-[#909399] transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15 disabled:bg-slate-50 disabled:text-slate-500 sm:h-9 sm:text-sm';

export const SELECT_CLS =
  'h-10 rounded-lg border border-[#D8DEE8] bg-white px-3 text-base text-[#1E293B] transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15 sm:h-9 sm:text-sm';

export const TEXTAREA_CLS =
  'w-full rounded-lg border border-[#D8DEE8] bg-white p-3 text-base text-[#1E293B] placeholder:text-[#909399] transition focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/15 disabled:bg-slate-50 sm:text-sm';

export const LABEL_CLS = 'mb-1.5 block text-xs font-semibold text-[#606266]';

/* -------------------- PageHeader -------------------- */
interface PageHeaderProps {
  title: React.ReactNode;
  description?: string;
  backTo?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  backTo,
  backLabel = '返回',
  actions,
}) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      {backTo && (
        <Link
          to={backTo}
          className="mb-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[#606266] transition hover:text-brand-600"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {backLabel}
        </Link>
      )}
      <h1 className="text-xl font-bold tracking-tight text-[#303133] sm:text-2xl">{title}</h1>
      {description && <p className="mt-1 text-xs leading-relaxed text-[#606266]">{description}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
  </div>
);

/* -------------------- Card -------------------- */
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  padding = 'md',
  ...rest
}) => {
  const padMap = {
    none: '',
    sm: 'p-3.5 sm:p-4',
    md: 'p-4 sm:p-5',
    lg: 'p-4 sm:p-6',
  };
  return (
    <div
      className={`rounded-xl border border-[#E6E9EF] bg-white shadow-card ${padMap[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}> = ({ title, subtitle, action, icon }) => (
  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[#F0F2F5] pb-3">
    <div className="flex items-center gap-2 min-w-0">
      {icon && <span className="shrink-0 text-brand-600">{icon}</span>}
      <div className="min-w-0">
        <h2 className="truncate text-sm font-bold text-[#303133] sm:text-base">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[#909399]">{subtitle}</p>}
      </div>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

/* -------------------- Button -------------------- */
type ButtonVariant = 'primary' | 'outline' | 'secondary' | 'ghost' | 'danger' | 'success' | 'ai';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 border border-transparent shadow-sm',
  outline: 'bg-white text-brand-600 border border-brand-600 hover:bg-brand-50',
  secondary:
    'bg-white text-[#303133] border border-[#DCDFE6] hover:border-brand-400 hover:text-brand-600',
  ghost: 'bg-transparent text-[#606266] border border-transparent hover:bg-[#F5F7FA] hover:text-[#303133]',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 border border-transparent shadow-sm',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 border border-transparent shadow-sm',
  ai: 'bg-indigo-600 text-white hover:bg-indigo-700 border border-transparent shadow-sm',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs rounded-lg gap-1.5',
  md: 'h-9 px-4 text-xs rounded-lg gap-1.5',
  lg: 'h-10 px-5 text-sm rounded-lg gap-2',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    disabled={disabled || loading}
    className={`inline-flex items-center justify-center font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
    {...rest}
  >
    {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> : icon}
    {children}
  </button>
);

/* -------------------- Badge -------------------- */
type BadgeTone = 'neutral' | 'brand' | 'success' | 'danger' | 'warning' | 'ai';

const BADGE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-[#F4F6F9] text-[#606266] border-[#E4E7ED]',
  brand: 'bg-brand-50 text-brand-700 border-brand-200/80',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  warning: 'bg-amber-50 text-amber-800 border-amber-200',
  ai: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export const Badge: React.FC<{
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}> = ({ tone = 'neutral', children, className = '' }) => (
  <span
    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${BADGE_CLASSES[tone]} ${className}`}
  >
    {children}
  </span>
);

/* -------------------- StatCard -------------------- */
export const StatCard: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ReactNode;
  valueClassName?: string;
  to?: string;
}> = ({ label, value, hint, icon, valueClassName = 'text-[#303133]', to }) => {
  const inner = (
    <div className="flex h-full flex-col justify-between rounded-lg border border-[#EBEEF5] bg-white p-4 shadow-card transition hover:border-brand-300">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#606266]">{label}</span>
        {icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50/70">
            {icon}
          </span>
        )}
      </div>
      <div className={`mt-2.5 text-2xl font-bold tracking-tight tabular-nums ${valueClassName}`}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-[#909399]">{hint}</div>}
    </div>
  );
  return to ? (
    <Link to={to} className="block h-full">
      {inner}
    </Link>
  ) : (
    inner
  );
};

/* -------------------- Tabs -------------------- */
export interface TabItem<T extends string = string> {
  key: T;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export function Tabs<T extends string>({
  items,
  activeKey,
  onChange,
  className = '',
}: {
  items: TabItem<T>[];
  activeKey: T;
  onChange: (key: T) => void;
  className?: string;
}) {
  return (
    <div className={`inline-flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100/80 p-1 ${className}`}>
      {items.map((item) => {
        const active = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
              active
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {item.icon}
            <span>{item.label}</span>
            {item.badge !== undefined && (
              <span
                className={`rounded-md px-1.5 py-0.2 text-[10px] tabular-nums ${
                  active ? 'bg-brand-50 text-brand-700' : 'bg-slate-200/80 text-slate-600'
                }`}
              >
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------- Alert -------------------- */
const ALERT_CLASSES = {
  info: 'border-brand-200 bg-brand-50 text-brand-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-rose-200 bg-rose-50 text-rose-800',
};

const ALERT_ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

export const Alert: React.FC<{
  tone?: 'info' | 'success' | 'warning' | 'error';
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}> = ({ tone = 'info', children, action, className = '' }) => {
  const Icon = ALERT_ICONS[tone];
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-xs leading-relaxed ${ALERT_CLASSES[tone]} ${className}`}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

/* -------------------- EmptyState -------------------- */
export const EmptyState: React.FC<{
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}> = ({ icon, title, description, action }) => (
  <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
    {icon && <div className="mb-3 text-slate-300">{icon}</div>}
    <p className="text-sm font-semibold text-slate-700">{title}</p>
    {description && <p className="mt-1 max-w-sm text-xs text-slate-500">{description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/* -------------------- Modal -------------------- */
export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, maxWidthClass = 'max-w-lg', children }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`max-h-[90dvh] w-full ${maxWidthClass} flex flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-xl sm:rounded-2xl`}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 sm:px-6 sm:py-4">
          <h3 className="text-base font-bold text-slate-900">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="pb-safe overflow-y-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
};
