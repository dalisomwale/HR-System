import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Settings2, Users } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  ButtonLink,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { Figures } from './CompanyOverviewPage.jsx';
import { ServiceChart, TypeDonutChart } from './people-charts.jsx';
import { EMPLOYMENT_TYPES, Initials, StatusBadge, TypeMeter } from './people-ui.jsx';

const BANDS = [
  ['lt1', 'Under 1 year'],
  ['y1to2', '1 to 2 years'],
  ['y2to5', '2 to 5 years'],
  ['y5to10', '5 to 10 years'],
  ['gt10', 'Over 10 years'],
];

/** One department's overview and its people, opened from the Departments menu (D56). */
export default function DepartmentPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const overview = useQuery({
    queryKey: ['people-departments', ''],
    queryFn: () => api.get('/api/people/departments-overview'),
  });
  const people = useQuery({
    queryKey: ['employees', { departmentId: id, status: 'ACTIVE', pageSize: 500 }],
    queryFn: () =>
      api.get(`/api/people/employees${qs({ departmentId: id, status: 'ACTIVE', pageSize: 500 })}`),
  });

  const back = (
    <Link
      to="/people/departments"
      className="mb-3 inline-flex items-center gap-1 text-sm text-brand hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden /> Department overview
    </Link>
  );
  if (overview.isPending) return <Loading />;
  if (overview.isError) return <LoadError error={overview.error} onRetry={() => overview.refetch()} />;
  const d = overview.data.departments.find((x) => String(x.id) === id);
  if (!d) {
    return (
      <div className="max-w-6xl">
        {back}
        <Notice tone="neutral" title="Department not found, or it is inactive with no staff." />
      </div>
    );
  }
  const year = overview.data.year;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        {back}
        <PageHeader
          title={d.name}
          description={
            <>
              {d.code}
              {d.company && (
                <>
                  {' · '}
                  <Link to={`/people/companies/${d.companyId}`} className="text-brand hover:underline">
                    {d.company}
                  </Link>
                </>
              )}
            </>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {!d.isActive && <Badge>Inactive</Badge>}
              <ButtonLink to={`/people/employees?departmentId=${d.id}`}>
                <Users className="size-4" aria-hidden /> Employees
              </ButtonLink>
              {hasRole(me, 'HR_OFFICER') && (
                <ButtonLink to="/people/departments/manage">
                  <Settings2 className="size-4" aria-hidden /> Manage
                </ButtonLink>
              )}
            </div>
          }
        />
      </div>

      <Stats>
        <Stat label="Active staff" value={d.headcount} to={`/people/employees?departmentId=${d.id}`} />
        <Stat label="Managers" value={d.managers} />
        <Stat
          label="On probation"
          value={d.onProbation}
          to={`/people/employees?departmentId=${d.id}&filter=probation`}
        />
        <Stat
          label="Contracts ending in 60 days"
          value={d.contractsEnding}
          to={`/people/employees?departmentId=${d.id}&filter=contractEnding`}
        />
      </Stats>

      <Section title="At a glance">
        <TypeMeter byType={d.byType} />
        <Figures
          items={[
            [`Joined in ${year}`, d.joinedThisYear],
            [`Left in ${year}`, d.leftThisYear],
            ['Average service', d.headcount ? `${d.averageServiceYears} yrs` : '—'],
            ['No line manager', d.noManager],
          ]}
        />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Employment type">
          <TypeDonutChart byType={d.byType} />
        </Section>
        <Section title="Length of service">
          <ServiceChart bands={BANDS.map(([key, label]) => ({ key, label, count: d.serviceBands[key] }))} />
        </Section>
      </div>

      <Section title="People" description="Everyone active in this department">
        {people.isPending ? (
          <Loading />
        ) : people.isError ? (
          <LoadError error={people.error} onRetry={() => people.refetch()} />
        ) : people.data.items.length === 0 ? (
          <p className="text-sm text-muted">Nobody in this department yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Job title</Th>
                <Th>Line manager</Th>
                <Th>Type</Th>
                <Th>Started</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {people.data.items.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Initials first={e.firstName} last={e.lastName} />
                      <Link
                        to={`/people/employees/${e.id}`}
                        className="font-medium text-brand hover:underline"
                      >
                        {e.firstName} {e.lastName}
                      </Link>
                    </div>
                  </Td>
                  <Td>{e.jobTitle ?? <span className="text-muted">Not set</span>}</Td>
                  <Td>{e.lineManager ?? <span className="text-muted">None</span>}</Td>
                  <Td>{EMPLOYMENT_TYPES[e.employmentType] ?? <span className="text-muted">Not set</span>}</Td>
                  <Td className="whitespace-nowrap">{formatDate(e.employmentStartDate)}</Td>
                  <Td>
                    <StatusBadge e={e} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
    </div>
  );
}
