import { forwardRef, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

const cx = (...c) => c.filter(Boolean).join(' ');

const BUTTON = {
  primary: 'bg-brand text-white hover:bg-brand-strong border border-brand',
  secondary: 'bg-white text-ink border border-rule hover:border-muted',
  danger: 'bg-white text-danger border border-danger/40 hover:bg-danger-bg',
  ghost: 'bg-transparent text-brand border border-transparent hover:bg-brand-soft',
};

export function Button({ variant = 'primary', busy = false, className, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium whitespace-nowrap',
        'disabled:cursor-not-allowed disabled:opacity-60',
        BUTTON[variant],
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant = 'secondary', className, children }) {
  return (
    <Link
      to={to}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium whitespace-nowrap',
        BUTTON[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-rule pb-4">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, description, actions, children, className }) {
  return (
    <section className={cx('rounded-md border border-rule bg-white', className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-4 border-b border-rule px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

// Full width unless the caller sets a width.
const width = (className) => (/(^|\s)w-/.test(className ?? '') ? '' : 'w-full');
const inputBase =
  'h-9 rounded-md border bg-white px-3 text-sm text-ink placeholder:text-muted/70 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:bg-canvas';

export const Input = forwardRef(function Input({ invalid, className, ...props }, ref) {
  return (
    <input
      ref={ref}
      {...props}
      className={cx(inputBase, width(className), invalid ? 'border-danger' : 'border-rule', className)}
    />
  );
});

export const Select = forwardRef(function Select({ invalid, className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      {...props}
      className={cx(
        inputBase,
        width(className),
        'pr-8',
        invalid ? 'border-danger' : 'border-rule',
        className,
      )}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ invalid, className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={cx(
        inputBase,
        width(className),
        'h-auto min-h-20 py-2',
        invalid ? 'border-danger' : 'border-rule',
        className,
      )}
    />
  );
});

/** Label, control, hint and error, wired together for screen readers. */
export function Field({ id, label, hint, error, optional, children, className }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const STATUS = {
  ok: 'bg-ok-bg text-ok',
  pending: 'bg-pending-bg text-pending',
  danger: 'bg-danger-bg text-danger',
  neutral: 'bg-neutral-bg text-neutral',
  brand: 'bg-brand-soft text-brand',
};
export function Badge({ tone = 'neutral', children }) {
  return (
    <span
      className={cx('inline-flex items-center rounded-sm px-1.5 py-0.5 text-xs font-medium', STATUS[tone])}
    >
      {children}
    </span>
  );
}

export function Notice({ tone = 'neutral', title, children }) {
  const Icon = tone === 'ok' ? CheckCircle2 : AlertCircle;
  const colors = {
    ok: 'border-ok/30 bg-ok-bg text-ok',
    danger: 'border-danger/30 bg-danger-bg text-danger',
    pending: 'border-pending/30 bg-pending-bg text-pending',
    neutral: 'border-rule bg-white text-ink',
  }[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('flex gap-3 rounded-md border px-4 py-3 text-sm', colors)}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
    </div>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}…
    </div>
  );
}

/** Shown when a query fails: says what happened and offers a retry. */
export function LoadError({ error, onRetry }) {
  return (
    <Notice tone="danger" title="This information could not be loaded.">
      <p>{error?.message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-medium underline">
          Try again
        </button>
      )}
    </Notice>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Table({ children }) {
  return (
    <div className="overflow-x-auto rounded-md border border-rule bg-white">
      <table className="w-full border-collapse text-left text-sm [&_tbody_tr:last-child>td]:border-b-0">
        {children}
      </table>
    </div>
  );
}
export const Th = ({ children, className }) => (
  <th
    scope="col"
    className={cx('border-b border-rule bg-canvas px-3 py-2 text-xs font-semibold text-muted', className)}
  >
    {children}
  </th>
);
export const Td = ({ children, className }) => (
  <td className={cx('border-b border-rule px-3 py-2.5 align-top', className)}>{children}</td>
);

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** Two-column definition list for record details. */
export function Details({ items }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[12rem_1fr]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="font-medium">
            {value || <span className="font-normal text-muted">Not recorded</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Map server field errors onto react-hook-form fields; returns any message left over. */
export function applyServerErrors(err, setError, fieldNames) {
  let unmatched = null;
  for (const f of err?.fields ?? []) {
    if (fieldNames.includes(f.path)) setError(f.path, { type: 'server', message: capitalise(f.message) });
    else unmatched = unmatched ?? f.message;
  }
  return err?.fields?.length ? unmatched : err?.message;
}
const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Confirmation dialog on the native <dialog> element: focus is trapped while open, Escape and
 * the Cancel button close it, and focus returns to the button that opened it.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
  tone = 'primary',
}) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-lg border border-rule bg-white p-6 text-ink backdrop:bg-ink/40"
    >
      <h2 id="confirm-title" className="text-lg font-semibold">
        {title}
      </h2>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
          Cancel
        </Button>
        <Button variant={tone} busy={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

/**
 * Horizontal tabs. `tabs` is [{ id, label, count? }]; the caller renders the active panel.
 * Arrow keys move between tabs.
 */
export function Tabs({ tabs, active, onChange, label }) {
  const move = (dir) => {
    const i = tabs.findIndex((t) => t.id === active);
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    onChange(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={label}
      className="mb-6 flex gap-1 overflow-x-auto border-b border-rule"
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') move(1);
        if (e.key === 'ArrowLeft') move(-1);
      }}
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cx(
              '-mb-px border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap',
              selected ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            {t.label}
            {t.count != null && <span className="ml-1.5 font-normal text-muted">({t.count})</span>}
          </button>
        );
      })}
    </div>
  );
}
