import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { COLORS, Donut, Meter } from '../../components/charts.jsx';
import { LoadError, Loading, Section } from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { MonthlyLeaveChart, OutcomesDonut, TypeDonut } from '../home/dashboard-charts.jsx';
import { EMPLOYMENT_TYPES, PROBATION } from './people-ui.jsx';

/** "2 years 9 months" from a number of months. */
function serviceText(months) {
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [];
  if (y) parts.push(`${y} ${y === 1 ? 'year' : 'years'}`);
  if (m || !y) parts.push(`${m} ${m === 1 ? 'month' : 'months'}`);
  return parts.join(' ');
}

/** The record's Overview tab: this person's figures as charts (D66). */
export default function EmployeeOverview({ employee }) {
  const q = useQuery({
    queryKey: ['employee-overview', String(employee.id)],
    queryFn: () => api.get(`/api/people/employees/${employee.id}/overview`),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const takenThisYear = o.byType.reduce((s, t) => s + t.value, 0);
  const done = o.completeness.filter((c) => c.done).length;
  const pct = Math.round((done / o.completeness.length) * 100);

  let contract;
  if (o.contract.leavingDate) {
    contract = { value: formatDate(o.contract.leavingDate), label: 'Leaving date' };
  } else if (o.contract.endDate && o.contract.daysLeft !== null && o.contract.daysLeft >= 0) {
    contract = {
      value: `${o.contract.daysLeft} ${o.contract.daysLeft === 1 ? 'day' : 'days'}`,
      label: `Until the contract ends, ${formatDate(o.contract.endDate)}`,
    };
  } else {
    contract = {
      value: EMPLOYMENT_TYPES[o.contract.type] ?? 'Not recorded',
      label: 'Employment type',
    };
  }

  return (
    <div className="space-y-6">
      <Stats>
        <Stat
          label={o.service.started ? `With the group since ${formatDate(o.service.startDate)}` : 'Start date'}
          value={o.service.started ? serviceText(o.service.months) : formatDate(o.service.startDate)}
        />
        <Stat
          label={o.annual ? `${o.annual.leaveType} days available` : 'Annual leave'}
          value={o.annual ? o.annual.available : '—'}
        />
        <Stat label={`Days of leave taken in ${o.year}`} value={Math.round(takenThisYear * 100) / 100} />
        <Stat label={contract.label} value={contract.value} />
      </Stats>

      <Section title="Employment timeline">
        <Timeline o={o} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={o.annual ? `${o.annual.leaveType}, ${o.year}` : 'Annual leave'}>
          {o.annual ? (
            <Donut
              label="Annual leave"
              centre={o.annual.available}
              centreLabel="days available"
              segments={[
                { key: 'taken', name: 'Taken', value: o.annual.taken, color: COLORS.taken },
                {
                  key: 'waiting',
                  name: 'Waiting for a decision',
                  value: o.annual.pending,
                  color: COLORS.waiting,
                },
                {
                  key: 'available',
                  name: 'Available',
                  value: Math.max(0, o.annual.available),
                  color: COLORS.track,
                  outline: true,
                },
              ]}
            />
          ) : (
            <p className="text-sm text-muted">Annual leave is not active yet.</p>
          )}
        </Section>
        <Section
          title="Record completeness"
          description={`${done} of ${o.completeness.length} details recorded`}
        >
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{pct}%</span>
            <span className="text-sm text-muted">complete</span>
          </div>
          <div className="mt-2">
            <Meter
              label="Record completeness"
              total={o.completeness.length}
              segments={[{ key: 'done', name: 'Recorded', value: done, color: COLORS.taken }]}
              height={10}
            />
          </div>
          <ul className="mt-4 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
            {o.completeness.map((c) => (
              <li key={c.label} className="flex items-center gap-2">
                {c.done ? (
                  <Check className="size-4 shrink-0 text-ok" aria-label="Recorded" />
                ) : (
                  <X className="size-4 shrink-0 text-danger" aria-label="Missing" />
                )}
                <span className={c.done ? '' : 'text-muted'}>{c.label}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title={`Leave by month, ${o.year}`}>
        <MonthlyLeaveChart months={o.monthly} year={o.year} />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={`Days by leave type, ${o.year}`} description="Approved days">
          <TypeDonut
            label={`Approved days by leave type, ${o.year}`}
            empty={`No leave taken yet in ${o.year}.`}
            items={o.byType}
          />
        </Section>
        <Section title={`Requests for ${o.year}`} description="Where each request stands now">
          <OutcomesDonut outcomes={o.outcomes} />
        </Section>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <Fact label={o.nextLeave?.now ? 'On leave now' : 'Next leave'}>
          {o.nextLeave ? (
            <Link to={`/leave/requests/${o.nextLeave.id}`} className="text-brand hover:underline">
              {o.nextLeave.type}, {formatDate(o.nextLeave.startDate)} to {formatDate(o.nextLeave.endDate)}
            </Link>
          ) : (
            'None booked'
          )}
        </Fact>
        <Fact label="Direct reports">{o.directReports}</Fact>
        <Fact label="Changes to this record">
          {o.changes}
          {o.lastChangeAt && (
            <span className="text-xs text-muted"> · last {formatDateTime(o.lastChangeAt)}</span>
          )}
        </Fact>
      </dl>
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <div className="rounded-md border border-rule bg-white px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}

/** Start, probation end, today and contract end on one line, to scale. */
function Timeline({ o }) {
  const start = o.service.startDate;
  const end = o.contract.leavingDate ?? o.contract.endDate;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  // A permanent contract has no end: draw a year past today so today sits inside the line.
  const last =
    end && t(end) > t(o.today) ? end : new Date(t(o.today) + 365 * 864e5).toISOString().slice(0, 10);
  const span = Math.max(1, t(last) - t(start));
  const at = (d) => `${Math.min(100, Math.max(0, ((t(d) - t(start)) / span) * 100))}%`;
  const marks = [
    { key: 'start', date: start, label: 'Started', color: COLORS.taken },
    o.probation.endDate && {
      key: 'probation',
      date: o.probation.endDate,
      label: PROBATION[o.probation.status] === 'Confirmed' ? 'Probation confirmed' : 'Probation ends',
      color: COLORS.series[2],
    },
    { key: 'today', date: o.today, label: 'Today', color: '#1d2433' },
    end && {
      key: 'end',
      date: end,
      label: o.contract.leavingDate ? 'Leaving' : 'Contract ends',
      color: COLORS.waiting,
    },
  ].filter(Boolean);
  return (
    <div className="pt-2">
      <div className="relative h-3 rounded-full" style={{ background: COLORS.track }}>
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: at(o.today), background: COLORS.booked }}
          aria-hidden
        />
        {marks.map((m) => (
          <span
            key={m.key}
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
            style={{ left: at(m.date), background: m.color }}
            aria-hidden
          />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {marks.map((m) => (
          <li key={m.key} className="flex items-start gap-2">
            <span
              className="mt-1 size-2.5 shrink-0 rounded-full"
              style={{ background: m.color }}
              aria-hidden
            />
            <span>
              <span className="block text-xs text-muted">{m.label}</span>
              <span className="font-medium">{formatDate(m.date)}</span>
            </span>
          </li>
        ))}
        {!end && (
          <li className="flex items-start gap-2">
            <span className="mt-1 size-2.5 shrink-0 rounded-full bg-rule" aria-hidden />
            <span>
              <span className="block text-xs text-muted">Contract</span>
              <span className="font-medium">{EMPLOYMENT_TYPES[o.contract.type] ?? 'No end date'}</span>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
