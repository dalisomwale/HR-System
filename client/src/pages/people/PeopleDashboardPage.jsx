import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { can, useMe } from '../../lib/auth.jsx';
import { formatDate, formatDateTime } from '../../lib/format.js';
import { BarList, COLORS, ColumnChart, Donut, Legend } from '../../components/charts.jsx';
import { ButtonLink, LoadError, Loading, PageHeader, Section, Select } from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { EMPLOYMENT_TYPES, FIELD_LABELS, PROBATION, historyValue } from './people-ui.jsx';
import { GenderDonutChart, HeadcountTrend, ServiceChart } from './people-charts.jsx';
import PeopleTrail from './PeopleTrail.jsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Employee management home: the whole Altus Group's people at a glance (D52). */
export default function PeopleDashboardPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const companyId = params.get('companyId') ?? '';
  const q = useQuery({
    queryKey: ['people-dashboard', companyId],
    queryFn: () => api.get(`/api/people/dashboard${qs({ companyId })}`),
  });
  const companies = q.data?.companies ?? [];
  return (
    <div className="stack">
      <PeopleTrail />
      <PageHeader
        title="Employee Management"
        actions={
          <div className="flex flex-wrap gap-2">
            {companies.length > 1 && (
              <Select
                aria-label="Company"
                className="w-64"
                value={companyId}
                onChange={(e) =>
                  setParams(e.target.value ? { companyId: e.target.value } : {}, { replace: true })
                }
              >
                <option value="">Altus Group</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            {can(me, 'people.edit') && (
              <ButtonLink to="/people/employees/new" variant="primary">
                Add Employee
              </ButtonLink>
            )}
          </div>
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Body d={q.data} companyId={companyId} />
      )}
    </div>
  );
}

function Body({ d, companyId }) {
  const link = (filter) => `/people/employees${qs({ filter, companyId })}`;
  const series = [
    { key: 'joined', name: 'Joined', color: COLORS.taken },
    { key: 'left', name: 'Left', color: COLORS.waiting },
  ];
  const typeSegments = [
    ...['PERMANENT', 'FIXED_TERM', 'TEMPORARY'].map((t, i) => ({
      key: t,
      name: EMPLOYMENT_TYPES[t],
      value: d.byType.find((x) => x.type === t)?.count ?? 0,
      color: COLORS.series[i],
    })),
    {
      key: 'none',
      name: 'Not recorded',
      value: d.byType.find((x) => x.type == null)?.count ?? 0,
      color: COLORS.other,
    },
  ].filter((s) => s.value > 0);

  return (
    <>
      <Stats color>
        <Stat label="Active Staff" value={d.headcount} to={`/people/employees${qs({ companyId })}`} />
        <Stat label="Starting In The Next 30 Days" value={d.counts.startingSoon} to={link('startingSoon')} />
        <Stat label="Leaving In The Next 30 Days" value={d.counts.leavingSoon} to={link('leavingSoon')} />
        <Stat
          label="Contracts Ending In 60 Days"
          value={d.counts.contractsEnding}
          to={link('contractEnding')}
        />
      </Stats>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Section title="Staff By Employment Type">
          <Donut
            label="Active Staff By Employment Type"
            unit="people"
            empty="No active staff yet."
            segments={typeSegments}
          />
        </Section>
        <Section title="Staff By Gender">
          <GenderDonutChart bySex={d.bySex} />
        </Section>
        {/* Altus Group: staff by company. One company: staff by department (D90). */}
        {companyId ? (
          <Section title="Staff By Department">
            <BarList
              empty="No active staff yet."
              format={(n) => `${n} ${n === 1 ? 'person' : 'people'}`}
              items={d.byDepartment.slice(0, 8).map((x) => ({
                key: `${x.id}`,
                label: x.name,
                value: x.count,
              }))}
            />
          </Section>
        ) : (
          <Section title="Staff By Company">
            <BarList
              empty="No active staff yet."
              format={(n) => `${n} ${n === 1 ? 'person' : 'people'}`}
              items={d.byCompany.map((c) => ({
                key: `${c.id}`,
                label: c.name,
                value: c.count,
                to: c.id ? `/people/companies/${c.id}` : undefined,
              }))}
            />
          </Section>
        )}
      </div>

      {companyId ? (
        <div className="grid gap-4 xl:grid-cols-3">
          <Section title="Staff Over The Last 12 Months" className="xl:col-span-2">
            <HeadcountTrend trend={d.headcountTrend} />
          </Section>
          <Section title="Length Of Service">
            <ServiceChart bands={d.serviceBands} />
          </Section>
        </div>
      ) : null}

      <div className={companyId ? '' : 'grid gap-4 xl:grid-cols-3'}>
        {!companyId && (
          <Section title="Length Of Service">
            <ServiceChart bands={d.serviceBands} />
          </Section>
        )}
        <Section
          title={`Joiners And Leavers, ${d.year}`}
          description="By start date and leaving date"
          className={companyId ? undefined : 'xl:col-span-2'}
        >
          <div className="space-y-3">
            <Legend items={series} />
            <ColumnChart
              label={`Joiners And Leavers By Month, ${d.year}`}
              unit="people"
              whole
              grouped
              series={series}
              data={d.monthly.map((m) => ({
                key: m.month,
                tick: MONTHS[m.month - 1],
                title: `${LONG[m.month - 1]} ${d.year}`,
                joined: m.joined,
                left: m.left,
              }))}
            />
          </div>
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <PeopleList
          title="Contracts Ending Soon"
          items={d.contractsEnding}
          empty="No contracts end in the next 60 days."
          when={(p) => `Ends ${formatDate(p.contractEndDate)}`}
          more={d.contractsEnding.length > 0 && link('contractEnding')}
        />
        <PeopleList
          title="Probation Ending"
          items={d.probationDue}
          empty="No probation ends in the next 30 days."
          when={(p) =>
            `${PROBATION[p.probationStatus]}${p.probationEndDate ? `, ends ${formatDate(p.probationEndDate)}` : ''}`
          }
          more={d.probationDue.length > 0 && link('probation')}
        />
        <PeopleList
          title="Starting And Leaving"
          items={[
            ...d.startingSoon.map((p) => ({ ...p, kind: 'start' })),
            ...d.leavingSoon.map((p) => ({ ...p, kind: 'leave' })),
          ]}
          empty="Nobody starts or leaves in the next 30 days."
          when={(p) =>
            p.kind === 'start' ? `Starts ${formatDate(p.startDate)}` : `Leaves ${formatDate(p.endDate)}`
          }
        />
      </div>

      {companyId && (
        <Section
          title="Recent Changes"
          actions={
            <Link to={`/people/employees${qs({ companyId })}`} className="card-link">
              All employees
            </Link>
          }
        >
          {d.recentChanges.length === 0 ? (
            <p className="muted-text">No changes recorded yet.</p>
          ) : (
            <ol className="divide-y divide-rule text-sm">
              {d.recentChanges.map((h) => (
                <li key={h.id} className="flex gap-3 py-2.5">
                  <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0">
                    <p>
                      <Link
                        to={`/people/employees/${h.employeeId}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {h.employee}
                      </Link>
                      {': '}
                      {change(h)}
                    </p>
                    <p className="text-xs text-muted">
                      {h.by} · {formatDateTime(h.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}
    </>
  );
}

function change(h) {
  if (h.event === 'CREATED') return 'record created';
  if (h.event === 'DEACTIVATED') return 'marked as left';
  if (h.event === 'REACTIVATED') return 'made active again';
  const label = (FIELD_LABELS[h.field] ?? h.field).toLowerCase();
  const to = historyValue(h.field, h.to);
  return to ? `${label} set to ${to}` : `${label} cleared`;
}

function PeopleList({ title, items, empty, when, more }) {
  return (
    <Section
      title={title}
      actions={
        more ? (
          <Link to={more} className="card-link">
            All
          </Link>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Users className="size-4" aria-hidden /> {empty}
        </p>
      ) : (
        <ul className="divide-y divide-rule text-sm">
          {items.slice(0, 6).map((p) => (
            <li key={`${p.kind ?? ''}${p.id}`} className="py-2">
              <Link to={`/people/employees/${p.id}`} className="font-medium text-brand hover:underline">
                {p.name}
              </Link>
              <p className="text-xs text-muted">{[p.jobTitle, p.department].filter(Boolean).join(' · ')}</p>
              <p className="text-xs">{when(p)}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
