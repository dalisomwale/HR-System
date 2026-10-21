import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Plus, Users } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
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

/** Employee management home: the whole company's people at a glance (D52). */
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
    <div className="max-w-6xl space-y-6">
      <PeopleTrail />
      <PageHeader
        title="Employee management"
        description="The central record for every member of staff, from onboarding to offboarding"
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
                <option value="">Whole company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
            {hasRole(me, 'HR_OFFICER') && (
              <ButtonLink to="/people/employees/new" variant="primary">
                <Plus className="size-4" aria-hidden /> Add employee
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
      <Stats>
        <Stat label="Active staff" value={d.headcount} to={`/people/employees${qs({ companyId })}`} />
        <Stat label="Starting in the next 30 days" value={d.counts.startingSoon} to={link('startingSoon')} />
        <Stat label="Leaving in the next 30 days" value={d.counts.leavingSoon} to={link('leavingSoon')} />
        <Stat
          label="Contracts ending in 60 days"
          value={d.counts.contractsEnding}
          to={link('contractEnding')}
        />
      </Stats>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {!companyId && d.byCompany.length > 1 && (
          <Section title="Staff by company">
            <Donut
              label="Active staff by company"
              unit="people"
              segments={d.byCompany
                .slice(0, 3)
                .map((c, i) => ({
                  key: String(c.id),
                  name: c.name,
                  value: c.count,
                  color: COLORS.series[i],
                }))
                .concat(
                  d.byCompany.length > 3
                    ? [
                        {
                          key: 'other',
                          name: 'Other companies',
                          value: d.byCompany.slice(3).reduce((s, c) => s + c.count, 0),
                          color: COLORS.other,
                        },
                      ]
                    : [],
                )}
            />
          </Section>
        )}
        <Section title="Staff by employment type">
          <Donut
            label="Active staff by employment type"
            unit="people"
            empty="No active staff yet."
            segments={typeSegments}
          />
        </Section>
        <Section title="Staff by gender">
          <GenderDonutChart bySex={d.bySex} />
        </Section>
        <Section title="Staff by department">
          <BarList
            empty="No active staff yet."
            format={(n) => `${n} ${n === 1 ? 'person' : 'people'}`}
            items={d.byDepartment.slice(0, 8).map((x) => ({
              key: `${x.id}`,
              label: x.name,
              sub: companyId ? undefined : x.company,
              value: x.count,
            }))}
          />
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Section title="Staff over the last 12 months" className="xl:col-span-2">
          <HeadcountTrend trend={d.headcountTrend} />
        </Section>
        <Section title="Length of service">
          <ServiceChart bands={d.serviceBands} />
        </Section>
      </div>

      <Section title={`Joiners and leavers, ${d.year}`} description="By start date and leaving date">
        <div className="space-y-3">
          <Legend items={series} />
          <ColumnChart
            label={`Joiners and leavers by month, ${d.year}`}
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

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <PeopleList
          title="Contracts ending soon"
          items={d.contractsEnding}
          empty="No contracts end in the next 60 days."
          when={(p) => `Ends ${formatDate(p.contractEndDate)}`}
          more={d.contractsEnding.length > 0 && link('contractEnding')}
        />
        <PeopleList
          title="Probation ending"
          items={d.probationDue}
          empty="No probation ends in the next 30 days."
          when={(p) =>
            `${PROBATION[p.probationStatus]}${p.probationEndDate ? `, ends ${formatDate(p.probationEndDate)}` : ''}`
          }
          more={d.probationDue.length > 0 && link('probation')}
        />
        <PeopleList
          title="Starting and leaving"
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

      <Section
        title="Recent changes"
        actions={
          <Link to={`/people/employees${qs({ companyId })}`} className="text-sm text-brand hover:underline">
            All employees
          </Link>
        }
      >
        {d.recentChanges.length === 0 ? (
          <p className="text-sm text-muted">No changes recorded yet.</p>
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
          <Link to={more} className="text-sm text-brand hover:underline">
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
