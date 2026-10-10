import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api, downloadFile, qs } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import {
  Button,
  EmptyState,
  Field,
  Input,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';

const thisYear = new Date().getFullYear();
const FILTER_KEYS = [
  'from',
  'to',
  'year',
  'employeeId',
  'departmentId',
  'leaveTypeId',
  'status',
  'entryType',
];

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const list = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/api/reports') });
  const selected = params.get('report');
  const applied = useMemo(
    () => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])),
    [params],
  );

  if (list.isPending) return <Loading />;
  if (list.isError) return <LoadError error={list.error} onRetry={() => list.refetch()} />;
  const { items, options, scope } = list.data;
  const report = items.find((r) => r.id === selected) ?? items[0];

  const choose = (id) => setParams({ report: id });
  const apply = (filters) =>
    setParams(
      Object.fromEntries(Object.entries({ report: report.id, ...filters }).filter(([, v]) => v !== '')),
    );

  return (
    <div className="max-w-7xl">
      <PageHeader
        title="Reports"
        description={
          scope === 'HR'
            ? 'Company-wide reports. Times are Lusaka time. Exports are recorded in the audit log.'
            : 'Reports on the people you manage. Times are Lusaka time. Exports are recorded in the audit log.'
        }
      />
      <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Reports" className="self-start rounded-md border border-rule bg-white py-2">
          <ul>
            {items.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => choose(r.id)}
                  aria-current={r.id === report.id ? 'page' : undefined}
                  className={`block w-full border-l-[3px] px-3 py-1.5 text-left text-sm ${
                    r.id === report.id
                      ? 'border-brand bg-brand-soft font-medium text-brand'
                      : 'border-transparent hover:bg-canvas'
                  }`}
                >
                  {r.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <ReportView key={report.id} report={report} options={options} applied={applied} onApply={apply} />
      </div>
    </div>
  );
}

function Filters({ report, options, applied, onApply }) {
  const [v, setV] = useState(applied);
  const has = (f) => report.filters.includes(f);
  const set = (k) => (e) => setV((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onApply(v);
      }}
      className="grid gap-3 rounded-md border border-rule bg-white p-4 sm:grid-cols-2 xl:grid-cols-4"
    >
      {has('from') && (
        <Field id="from" label="From" optional>
          <Input id="from" type="date" value={v.from} onChange={set('from')} />
        </Field>
      )}
      {has('to') && (
        <Field id="to" label="To" optional>
          <Input id="to" type="date" value={v.to} onChange={set('to')} />
        </Field>
      )}
      {has('year') && (
        <Field id="year" label="Year">
          <Select id="year" value={v.year || String(thisYear)} onChange={set('year')}>
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {has('employee') && (
        <Field id="employeeId" label="Employee">
          <Select id="employeeId" value={v.employeeId} onChange={set('employeeId')}>
            <option value="">Everyone</option>
            {options.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {has('department') && options.departments.length > 0 && (
        <Field id="departmentId" label="Department">
          <Select id="departmentId" value={v.departmentId} onChange={set('departmentId')}>
            <option value="">All departments</option>
            {options.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {has('leaveType') && (
        <Field id="leaveTypeId" label="Leave type">
          <Select id="leaveTypeId" value={v.leaveTypeId} onChange={set('leaveTypeId')}>
            <option value="">All leave types</option>
            {options.leaveTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {has('status') && (
        <Field id="status" label="Status">
          <Select id="status" value={v.status} onChange={set('status')}>
            <option value="">All statuses</option>
            {options.statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {has('entryType') && (
        <Field id="entryType" label="Entry">
          <Select id="entryType" value={v.entryType} onChange={set('entryType')}>
            <option value="">All entries</option>
            {options.entryTypes.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-4">
        <Button type="submit">Run report</Button>
        <Button
          variant="ghost"
          onClick={() => {
            const blank = Object.fromEntries(FILTER_KEYS.map((k) => [k, '']));
            setV(blank);
            onApply(blank);
          }}
        >
          Clear filters
        </Button>
      </div>
    </form>
  );
}

function cell(c, value) {
  if (value === null || value === undefined || value === '') return '';
  if (c.type === 'date') return formatDate(value);
  return String(value);
}

function ReportView({ report, options, applied, onApply }) {
  const query = Object.fromEntries(Object.entries(applied).filter(([, v]) => v !== ''));
  const q = useQuery({
    queryKey: ['report', report.id, query],
    queryFn: () => api.get(`/api/reports/${report.id}${qs(query)}`),
  });
  const exportUrl = (format) => `/api/reports/${report.id}/export${qs({ ...query, format })}`;

  return (
    <div className="min-w-0 space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{report.title}</h2>
        <p className="mt-0.5 max-w-3xl text-sm text-muted">{report.description}</p>
      </div>
      <Filters report={report} options={options} applied={applied} onApply={onApply} />
      {q.isPending ? (
        <Loading label="Running report" />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {q.data.total} {q.data.total === 1 ? 'row' : 'rows'}
              {q.data.truncated && `; showing the first ${q.data.rows.length}. Export to get them all.`}
            </p>
            {q.data.total > 0 && <ExportButtons url={exportUrl} />}
          </div>
          {q.data.total === 0 ? (
            <div className="rounded-md border border-rule bg-white">
              <EmptyState title="No records found for these filters." />
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  {q.data.columns.map((c) => (
                    <Th key={c.key} className={c.type === 'number' ? 'text-right' : ''}>
                      {c.label}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {q.data.rows.map((r, i) => (
                  <tr key={i}>
                    {q.data.columns.map((c) => (
                      <Td
                        key={c.key}
                        className={
                          c.type === 'number'
                            ? 'text-right whitespace-nowrap'
                            : c.type === 'date' ||
                                [
                                  'reference',
                                  'employeeNumber',
                                  'at',
                                  'submitted',
                                  'managerDecided',
                                  'hrDecided',
                                ].includes(c.key)
                              ? 'whitespace-nowrap'
                              : ''
                        }
                      >
                        {cell(c, r[c.key])}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {report.id === 'ten-days' && (
            <Notice tone="neutral">
              Counts working days. Whether the policy's “10 consecutive days” means working or calendar days
              is for HR to confirm (decision D37).
            </Notice>
          )}
        </>
      )}
    </div>
  );
}

function ExportButtons({ url }) {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const run = async (format) => {
    setBusy(format);
    setError(null);
    try {
      await downloadFile(url(format));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-sm text-danger">{error}</span>}
      <Button variant="secondary" busy={busy === 'xlsx'} onClick={() => run('xlsx')}>
        <Download className="size-4" aria-hidden /> Excel
      </Button>
      <Button variant="secondary" busy={busy === 'csv'} onClick={() => run('csv')}>
        <Download className="size-4" aria-hidden /> CSV
      </Button>
    </div>
  );
}
