import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, type Tier } from '../api/client';
import { TIER_LABEL, TIER_MEANING, TIER_VAR, humanize } from '../lib/format';
import { Icon } from './Icon';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' ? 'h-8 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' && 'bg-brand text-white hover:opacity-90 dark:text-slate-900',
        variant === 'secondary' && 'border border-line bg-surface-1 text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-ink-2 hover:bg-surface-2',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        className,
      )}
    />
  );
}

export function Card({ title, subtitle, actions, children, className, pad = true }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx('rounded-lg border border-line bg-surface-1', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-2 border-b border-line px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, crumbs }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { to: string; label: string }[] }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && (
          <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-ink-3" aria-label="Breadcrumb">
            {crumbs.map((c) => (
              <span key={c.to} className="flex items-center gap-1">
                <Link className="hover:text-brand hover:underline" to={c.to}>{c.label}</Link>
                <span aria-hidden>›</span>
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-sm text-ink-2">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Kpi({ label, value, hint, tone, to }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' | 'bad'; to?: string }) {
  const inner = (
    <>
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="num mt-1 text-2xl font-semibold text-ink">{value}</div>
      {hint && (
        <div className="mt-1 flex items-center gap-1 text-xs text-ink-2">
          {tone && <StatusDot tone={tone} />}
          {hint}
        </div>
      )}
    </>
  );
  const cls = 'block rounded-lg border border-line bg-surface-1 px-4 py-3';
  return to ? <Link to={to} className={cx(cls, 'hover:border-brand')}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

const TONE = { good: 'var(--good)', warn: 'var(--warning)', bad: 'var(--critical)' };
export function StatusDot({ tone }: { tone: 'good' | 'warn' | 'bad' }) {
  const glyph = tone === 'good' ? '✓' : tone === 'warn' ? '!' : '×';
  return (
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] font-bold text-white" style={{ background: TONE[tone] }} aria-hidden>
      {glyph}
    </span>
  );
}

export function TierBadge({ tier, label }: { tier: Tier | null | undefined; label?: string | null }) {
  if (!tier) return <span className="text-ink-3">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink" title={TIER_MEANING[tier]}>
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TIER_VAR[tier] }} aria-hidden />
      {label ?? TIER_LABEL[tier]}
      {label && <span className="text-ink-3">· {TIER_LABEL[tier]}</span>}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  SUBMITTED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  VERIFIED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  RETURNED: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  OPEN: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  IN_INTERVENTION: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  RESOLVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  IDENTIFIED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  PLANNED: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',
  ONGOING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  COMPLETED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  FOR_MONITORING: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  REASSESSMENT_REQUIRED: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200',
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={cx('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-700')}>{humanize(status)}</span>;
}

export function Badge({ children, tone = 'slate' }: { children: ReactNode; tone?: 'slate' | 'blue' | 'amber' | 'red' | 'green' }) {
  const t = {
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200',
    amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
    red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
    green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  }[tone];
  return <span className={cx('inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', t)}>{children}</span>;
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block text-sm', className)}>
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const withWidth = (cls?: string) => (cls && /(^|\s)w-/.test(cls) ? '' : 'w-full');
const inputCls = 'h-9 rounded-md border border-line bg-surface-1 px-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none';
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, withWidth(p.className), p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...p} className={cx(inputCls, 'h-auto w-full py-2', p.className)} />;
export function Select({ options, placeholder, className, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string | number; label: string }[]; placeholder?: string }) {
  return (
    <select {...p} className={cx(inputCls, withWidth(className), 'pr-8', className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Modal({ open, onClose, title, children, footer, wide, locked }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean; locked?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onClose={onClose}
      onCancel={(e) => locked && e.preventDefault()}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-surface-1 p-0 text-ink shadow-xl backdrop:bg-black/40', wide ? 'max-w-4xl' : 'max-w-lg')}
    >
      {open && (
        <>
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 id={id} className="text-base font-semibold">{title}</h2>
            {!locked && <button className="rounded p-1 text-ink-3 hover:bg-surface-2" onClick={onClose} aria-label="Close">✕</button>}
          </header>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </>
      )}
    </dialog>
  );
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-ink-3" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-brand" />
      {label}
    </div>
  );
}

export function Empty({ title, children, icon = 'inbox' }: { title: string; children?: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
      <Icon name={icon} className="mb-2 h-6 w-6 text-ink-3" />
      <div className="text-sm font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-xs text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as ApiError;
  const details = Array.isArray(e.details) ? (e.details as { message?: string; path?: string; field?: string; learnerId?: number; row?: number; label?: string; details?: string[] }[]) : null;
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" role="alert">
      <div className="font-medium">{e.message ?? 'Something went wrong'}</div>
      {details && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          {details.slice(0, 12).map((d, i) => (
            <li key={i}>
              {typeof d === 'string' ? d : `${d.row ? `Row ${d.row}: ` : ''}${d.label ?? d.message ?? ''}${d.details?.length ? ` — ${d.details.slice(0, 5).join(', ')}${d.details.length > 5 ? '…' : ''}` : ''}`}
            </li>
          ))}
          {details.length > 12 && <li>…and {details.length - 12} more</li>}
        </ul>
      )}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: ReactNode;
  render?: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

export function Table<T>({ columns, rows, rowKey, onRowClick, empty = 'No records', dense }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string | number; onRowClick?: (r: T) => void; empty?: ReactNode; dense?: boolean }) {
  if (!rows.length) return <Empty title={typeof empty === 'string' ? empty : 'No records'}>{typeof empty === 'string' ? null : empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-ink-3">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cx('whitespace-nowrap px-3 font-medium', dense ? 'py-1.5' : 'py-2', c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={rowKey(r)}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cx('border-b border-line last:border-0', onRowClick && 'cursor-pointer hover:bg-surface-2')}
            >
              {columns.map((c) => (
                <td key={c.key} className={cx('px-3 align-top text-ink', dense ? 'py-1.5' : 'py-2', c.align === 'right' && 'num text-right', c.align === 'center' && 'text-center', c.className)}>
                  {c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  if (pages <= 1) return <div className="px-3 py-2 text-xs text-ink-3">{total} record{total === 1 ? '' : 's'}</div>;
  return (
    <div className="flex items-center justify-between px-3 py-2 text-xs text-ink-3">
      <span>{total.toLocaleString()} records</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx('-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm', value === t.value ? 'border-brand font-medium text-brand' : 'border-transparent text-ink-2 hover:text-ink')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div className={cx('flex gap-2 rounded-md border px-3 py-2 text-xs', tone === 'info' ? 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100' : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100')}>
      <Icon name={tone === 'info' ? 'info' : 'alert'} className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
