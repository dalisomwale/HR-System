import { useQuery } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { COLORS, Donut, Meter } from '../../components/charts.jsx';
import { LoadError, Loading, Section } from '../../components/ui.jsx';
import { MonthlyLeaveChart, OutcomesDonut, TypeDonut } from '../home/dashboard-charts.jsx';

/**
 * The record's Overview tab, also My profile's (D66, D70): this person's leave as charts, and
 * how complete their record is. Laid out as the inventory dashboard: the wide chart beside the
 * donut, two donuts side by side, with the record's completeness first.
 */
export default function EmployeeOverview({ employee, source }) {
  // My profile passes its own address; HR reads the record by ID (D70).
  const url = source ?? `/api/people/employees/${employee.id}/overview`;
  const q = useQuery({
    queryKey: ['employee-overview', url],
    queryFn: () => api.get(url),
  });
  if (q.isPending) return <Loading />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data;
  const done = o.completeness.filter((c) => c.done).length;
  const pct = Math.round((done / o.completeness.length) * 100);

  return (
    <div className="stack">
      <Section
        title="Record completeness"
        description={`${done} of ${o.completeness.length} details recorded`}
      >
        <div className="flex items-baseline gap-2">
          <span className="font-head text-[1.75rem] leading-tight font-bold text-brand tabular-nums">
            {pct}%
          </span>
          <span className="muted-text">complete</span>
        </div>
        <div className="mt-2">
          <Meter
            label="Record completeness"
            total={o.completeness.length}
            segments={[{ key: 'done', name: 'Recorded', value: done, color: COLORS.taken }]}
            height={10}
          />
        </div>
        <ul className="mt-4 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-4">
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

      <div className="grid-2 wide-left">
        <Section title={`Leave by month, ${o.year}`}>
          <MonthlyLeaveChart months={o.monthly} year={o.year} />
        </Section>
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
            <p className="muted-text">Annual leave is not active yet.</p>
          )}
        </Section>
      </div>

      <div className="grid-2">
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
    </div>
  );
}
