import { Link, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Settings2, UserPlus, Users } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import { Badge, ButtonLink, LoadError, Loading, Notice, PageHeader, Section } from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { Figures } from './CompanyOverviewPage.jsx';
import { DepartmentStatistics, DepartmentTable } from './DepartmentOverviewPage.jsx';
import { TypeDonutChart, ServiceChart } from './people-charts.jsx';
import { TypeMeter } from './people-ui.jsx';
import PeopleTrail from './PeopleTrail.jsx';

/** One company's overview, opened from the Company menu (D55). */
export default function CompanyPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const companies = useQuery({
    queryKey: ['people-companies'],
    queryFn: () => api.get('/api/people/companies-overview'),
  });
  const departments = useQuery({
    queryKey: ['people-departments', id],
    queryFn: () => api.get(`/api/people/departments-overview${qs({ companyId: id })}`),
  });

  const back = <PeopleTrail />;
  if (companies.isPending || departments.isPending) return <Loading />;
  const failed = [companies, departments].find((q) => q.isError);
  if (failed) return <LoadError error={failed.error} onRetry={() => failed.refetch()} />;
  const c = companies.data.companies.find((x) => String(x.id) === id);
  if (!c) {
    return (
      <div className="max-w-6xl">
        {back}
        <Notice tone="neutral" title="Company not found, or it is inactive with no staff." />
      </div>
    );
  }
  const year = companies.data.year;
  const depts = [...departments.data.departments].sort((a, b) => b.headcount - a.headcount);

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        {back}
        <PageHeader
          title={c.name}
          description={c.code}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {!c.isActive && <Badge>Inactive</Badge>}
              <ButtonLink to={`/people/companies/${c.id}/employees`}>
                <Users className="size-4" aria-hidden /> Employees
              </ButtonLink>
              {hasRole(me, 'HR_OFFICER') && (
                <ButtonLink to={`/people/companies/${c.id}/employees/new`}>
                  <UserPlus className="size-4" aria-hidden /> Add employee
                </ButtonLink>
              )}
              {hasRole(me, 'HR_OFFICER') && (
                <ButtonLink to="/people/companies/manage">
                  <Settings2 className="size-4" aria-hidden /> Manage
                </ButtonLink>
              )}
            </div>
          }
        />
      </div>

      <Stats>
        <Stat label="Active staff" value={c.headcount} to={`/people/companies/${c.id}/employees`} />
        <Stat label="Departments" value={c.departments.length} />
        <Stat
          label="On probation"
          value={c.onProbation}
          to={`/people/companies/${c.id}/employees?filter=probation`}
        />
        <Stat
          label="Contracts ending in 60 days"
          value={c.contractsEnding}
          to={`/people/companies/${c.id}/employees?filter=contractEnding`}
        />
      </Stats>

      <Section title="At a glance">
        <TypeMeter byType={c.byType} />
        <Figures
          items={[
            ['Managers', c.managers],
            [`Joined in ${year}`, c.joinedThisYear],
            [`Left in ${year}`, c.leftThisYear],
            ['Average service', c.headcount ? `${c.averageServiceYears} yrs` : '—'],
            ['No line manager', c.noManager],
            ['Without a department', departments.data.withoutDepartment],
          ]}
        />
      </Section>

      {depts.length > 0 ? (
        <>
          <DepartmentStatistics departments={depts} year={year} companyId={id} />
          <DepartmentTable departments={depts} year={year} companyId={id} />
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Employment type">
            <TypeDonutChart byType={c.byType} />
          </Section>
          <Section title="Length of service">
            <ServiceChart
              bands={[
                { key: 'lt1', label: 'Under 1 year', count: c.serviceBands.lt1 },
                { key: 'y1to2', label: '1 to 2 years', count: c.serviceBands.y1to2 },
                { key: 'y2to5', label: '2 to 5 years', count: c.serviceBands.y2to5 },
                { key: 'y5to10', label: '5 to 10 years', count: c.serviceBands.y5to10 },
                { key: 'gt10', label: 'Over 10 years', count: c.serviceBands.gt10 },
              ]}
            />
          </Section>
        </div>
      )}
    </div>
  );
}
