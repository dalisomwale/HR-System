import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { FileSpreadsheet, Filter, Loader2 } from 'lucide-react';
import { PERIODS, exportTable, headings, periodRange, rowDates } from '../lib/table-tools.js';

const cx = (...c) => c.filter(Boolean).join(' ');

// Button classes, the same as in the Altus Inventory System (.btn, .btn-primary, …).
const BUTTON = {
  primary: 'btn btn-primary',
  secondary: 'btn',
  danger: 'btn btn-danger-outline',
  dangerSolid: 'btn btn-danger',
  ghost: 'btn btn-ghost',
};

export function Button({ variant = 'primary', size, busy = false, className, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || busy}
      className={cx(BUTTON[variant], size === 'sm' && 'btn-sm', className)}
    >
      {busy && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function ButtonLink({ to, variant = 'secondary', size, className, children }) {
  return (
    <Link to={to} className={cx(BUTTON[variant], size === 'sm' && 'btn-sm', className)}>
      {children}
    </Link>
  );
}

/** Page title on the left, buttons (or the date) on the right. */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="page-header">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-sub">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Today's date, as shown at the right of a dashboard's title. */
export function TodayDate() {
  return (
    <span className="page-date">
      {new Intl.DateTimeFormat('en-GB', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Lusaka',
      }).format(new Date())}
    </span>
  );
}

/** A card with a small uppercase heading, as on the inventory dashboard. */
export function Section({ title, description, actions, children, className }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <div className="card-head">
          <div className="min-w-0">
            {title && <h2>{title}</h2>}
            {description && actions && <p className="card-hint">{description}</p>}
          </div>
          {actions ?? (description && <span className="card-hint">{description}</span>)}
        </div>
      )}
      {children}
    </section>
  );
}

/** Headline figures: a row of four (or three) large numbers; `color` gives solid coloured tiles. */
export function KpiRow({ children, cols = 4, color = false }) {
  return <div className={cx('kpi-row', cols === 3 && 'cols-3', color && 'colored')}>{children}</div>;
}
export function Kpi({ label, value, unit, note, to, tone, small }) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div
        className={cx(
          'kpi-value',
          small && 'small',
          tone === 'bad' && 'is-bad',
          tone === 'warn' && 'is-warn',
        )}
      >
        {value}
        {unit && <span className="kpi-unit"> {unit}</span>}
      </div>
      {note && <div className="kpi-note">{note}</div>}
    </>
  );
  const box = cx('kpi', tone === 'bad' && 'kpi-bad', tone === 'warn' && 'kpi-warn');
  return to ? (
    <Link to={to} className={box}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** Big solid-colour shortcut buttons. tone: stock (navy), receive (green), issue (orange), request (gold), reports (teal). */
export function ActionTiles({ children }) {
  return <div className="action-tiles">{children}</div>;
}
export function ActionTile({ to, icon: Icon, title, desc, badge, tone = 'stock', off = false }) {
  const body = (
    <>
      <span className="at-icon">
        <Icon aria-hidden />
      </span>
      <span className="flex flex-col items-center gap-px">
        <span className="at-title">{title}</span>
        {desc && <span className="at-desc">{desc}</span>}
      </span>
      {badge && <span className="at-badge">{badge}</span>}
    </>
  );
  return off ? (
    <div className={cx('action-tile is-off')} aria-disabled="true">
      {body}
    </div>
  ) : (
    <Link to={to} className={cx('action-tile', `tone-${tone}`)}>
      {body}
    </Link>
  );
}

export const Input = forwardRef(function Input({ invalid, className, ...props }, ref) {
  return <input ref={ref} {...props} className={cx('field', invalid && 'is-invalid', className)} />;
});

export const Select = forwardRef(function Select({ invalid, className, children, ...props }, ref) {
  return (
    <select ref={ref} {...props} className={cx('field', invalid && 'is-invalid', className)}>
      {children}
    </select>
  );
});

export const Textarea = forwardRef(function Textarea({ invalid, className, ...props }, ref) {
  return <textarea ref={ref} {...props} className={cx('field', invalid && 'is-invalid', className)} />;
});

/** Label, control, hint and error, wired together for screen readers. */
export function Field({ id, label, hint, error, optional, children, className }) {
  return (
    <div className={cx('form-group', className)}>
      <label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-muted">(optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

// Alerts, and the navy-edged note for neutral messages.
const NOTICE = {
  ok: 'alert alert-success',
  danger: 'alert alert-danger',
  pending: 'alert alert-warning',
  neutral: 'info-note',
};
export function Notice({ tone = 'neutral', title, children }) {
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={NOTICE[tone]}>
      {title && <p className="alert-title">{title}</p>}
      {children && <div>{children}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="flex items-center gap-2 py-10 text-[0.9rem] text-muted" role="status">
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
        <button type="button" onClick={onRetry} className="mt-1 font-semibold underline">
          Try again
        </button>
      )}
    </Notice>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children && <p className="mx-auto max-w-md">{children}</p>}
      {action && <div className="mt-3 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** The inventory system's funnel button with a menu of periods. */
export function PeriodFilter({ value, onChange }) {
  const ref = useRef(null);
  const label = PERIODS.find(([k]) => k === value)?.[1] ?? 'All time';
  const pick = (k) => {
    onChange(k);
    ref.current?.removeAttribute('open');
  };
  return (
    <details ref={ref} className="period-filter">
      <summary
        className="period-btn"
        title="Filter by time period"
        aria-label={`Filter by time period: ${label}`}
      >
        <Filter aria-hidden />
        <span>{label}</span>
      </summary>
      <div className="period-menu" role="menu">
        {PERIODS.map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="menuitemradio"
            aria-checked={k === value}
            className={k === value ? 'active' : ''}
            onClick={() => pick(k)}
          >
            {l}
          </button>
        ))}
      </div>
    </details>
  );
}

/**
 * Data table in a card, with the period filter and Export to Excel above it (on every table).
 * The period applies to each row's data-date, or to the first column that shows dates; tables
 * without dates get the export only. On phones each row stacks into a card (see .rtable in
 * styles.css): the column headings are copied onto each cell as data-label after every render.
 * `stack={false}` keeps a real grid that scrolls sideways instead; `tools={false}` hides the bar;
 * `title` names the Excel file (the page title otherwise). `onExport` is the page's own server
 * export, used for All time so every row is included, not only those loaded on screen.
 */
export function Table({ children, stack = true, tools = true, title, onExport }) {
  const ref = useRef(null);
  const [period, setPeriod] = useState('all');
  const [dated, setDated] = useState(false);
  const [shown, setShown] = useState(null); // [visible, total] when filtered
  const [exportError, setExportError] = useState(null);
  const doExport = async () => {
    setExportError(null);
    try {
      if (onExport && period === 'all') await onExport();
      else exportTable(ref.current, title);
    } catch (err) {
      setExportError(err?.message ?? 'The export failed.');
    }
  };
  useLayoutEffect(() => {
    const table = ref.current;
    if (!table) return;
    if (stack) {
      const heads = headings(table);
      for (const row of table.querySelectorAll('tbody tr')) {
        let col = 0;
        for (const cell of row.children) {
          const span = Number(cell.getAttribute('colspan') ?? 1);
          const label = span === 1 ? heads[col] : '';
          if (label) cell.setAttribute('data-label', label);
          else {
            cell.removeAttribute('data-label');
            if (span === 1 && col > 0) cell.classList.add('rtable-actions');
          }
          col += span;
        }
      }
    }
    if (!tools) return;
    // The period filter: hide rows outside it. Rows without a date stay visible.
    const dates = rowDates(table);
    if (dated !== dates.size > 0) setDated(dates.size > 0);
    const range = periodRange(period);
    let total = 0;
    let visible = 0;
    for (const tr of table.querySelectorAll('tbody > tr')) {
      const d = dates.get(tr);
      const out = Boolean(range && d && (d < range[0] || d > range[1]));
      tr.hidden = out;
      if (dates.size && !tr.querySelector('[colspan]')) {
        total += 1;
        if (!out) visible += 1;
      }
    }
    const next = range ? [visible, total] : null;
    if (JSON.stringify(next) !== JSON.stringify(shown)) setShown(next);
  });
  return (
    <div className="card table-card">
      {tools && (
        <div className="table-tools">
          {shown && (
            <span className="table-count">
              {shown[0]} of {shown[1]} shown
            </span>
          )}
          {dated && <PeriodFilter value={period} onChange={setPeriod} />}
          {exportError && <span className="text-[0.8rem] text-danger">{exportError}</span>}
          <button type="button" className="btn-excel" onClick={doExport}>
            <FileSpreadsheet aria-hidden />
            Export to Excel
          </button>
        </div>
      )}
      <div className="table-container">
        <table ref={ref} className={cx('data-table', stack && 'rtable')}>
          {children}
        </table>
      </div>
      {shown && shown[0] === 0 && (
        <p className="empty-state py-6">Nothing in this period. Choose another period above.</p>
      )}
    </div>
  );
}
export const Th = ({ children, className }) => (
  <th scope="col" className={className}>
    {children}
  </th>
);
export const Td = ({ children, className }) => <td className={className}>{children}</td>;

export function Pagination({ page, pageSize, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mt-3 flex items-center justify-between text-[0.88rem] text-muted">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/** Label-over-value pairs for record details, two across. */
export function Details({ items }) {
  return (
    <dl className="detail-list">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value || <span className="not-set">Not recorded</span>}</dd>
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
      className="confirm-box"
    >
      <h2 id="confirm-title" className="confirm-title">
        {title}
      </h2>
      {children && <div className="confirm-text">{children}</div>}
      <div className="confirm-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy} autoFocus>
          Cancel
        </Button>
        <Button variant={tone === 'danger' ? 'dangerSolid' : tone} busy={busy} onClick={onConfirm}>
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
      className="pill-tabs mb-[18px] border-0 bg-transparent p-0"
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
            className="pill-tab"
          >
            {t.label}
            {t.count != null && <span className="count">({t.count})</span>}
          </button>
        );
      })}
    </div>
  );
}
