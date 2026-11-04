import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import { BarList } from '../../components/charts.jsx';
import {
  ButtonLink,
  EmptyState,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Select,
} from '../../components/ui.jsx';
import {
  GenderByGroup,
  GenderDonutChart,
  MovesByGroup,
  ServiceChart,
  TypeDonutChart,
  TypesByGroup,
  shortName,
  sumBands,
  sumSex,
  sumTypes,
} from './people-charts.jsx';
import PeopleTrail from './PeopleTrail.jsx';

/** Every department, compared on the same figures (D53). */
export default function DepartmentOverviewPage() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const companyId = params.get('companyId') ?? '';
  const q = useQuery({
    queryKey: ['people-departments', companyId],
    queryFn: () => api.get(`/api/people/departments-overview${qs({ companyId })}`),
  });
  const companies = q.data?.companies ?? [];
  return (
    <div className="max-w-7xl space-y-6">
      <PeopleTrail />
      <PageHeader
        title="Department overview"
        description="Every department compared on the same figures"
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
            {hasRole(me, 'HR_OFFICER') && (
              <ButtonLink to="/people/departments/manage">
                <Settings2 className="size-4" aria-hidden /> Manage departments
              </ButtonLink>
            )}
          </div>
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.departments.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title="No departments yet." />
        </div>
      ) : (
        <Body d={q.data} companyId={companyId} />
      )}
    </div>
  );
}

function Body({ d, companyId }) {
  const sorted = [...d.departments].sort((a, b) => b.headcount - a.headcount);
  return (
    <>
      {d.withoutDepartment > 0 && (
        <Notice
          tone="pending"
          title={`${d.withoutDepartment} active ${d.withoutDepartment === 1 ? 'person has' : 'people have'} no department set.`}
        />
      )}
      <DepartmentStatistics departments={sorted} year={d.year} companyId={companyId} />

      <Section title="Staff by department">
        <div className="max-w-3xl">
          <BarList
            empty="No active staff yet."
            format={(n) => `${n} ${n === 1 ? 'person' : 'people'}`}
            items={sorted.map((x) => ({
              key: String(x.id),
              label: x.name,
              sub: companyId ? undefined : x.company,
              value: x.headcount,
              to: `/people/departments/${x.id}`,
            }))}
          />
        </div>
      </Section>
    </>
  );
}

export function DepartmentStatistics({ departments, year, companyId }) {
  // The twelve largest departments keep the charts readable; the table below has them all.
  const top = departments.filter((x) => x.headcount > 0 || x.joinedThisYear || x.leftThisYear).slice(0, 12);
  const groups = top.map((x) => ({
    key: String(x.id),
    tick: shortName(x),
    title: companyId ? x.name : `${x.name}, ${x.company ?? 'No company'}`,
    byType: x.byType,
    bySex: x.bySex,
    joined: x.joinedThisYear,
    left: x.leftThisYear,
  }));
  const scope = companyId ? 'This company' : 'Altus Group';
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Employment type by department" description="Active staff, largest departments">
        <TypesByGroup groups={groups} label="Active staff in each department by employment type" />
      </Section>
      <Section title="Employment type" description={scope}>
        <TypeDonutChart byType={sumTypes(departments)} />
      </Section>
      <Section title="Gender by department" description="Active staff, largest departments">
        <GenderByGroup groups={groups} label="Active staff in each department by gender" />
      </Section>
      <Section title="Gender" description={scope}>
        <GenderDonutChart bySex={sumSex(departments)} />
      </Section>
      <Section title={`Joined and left in ${year}`} description="By department">
        <MovesByGroup groups={groups} label={`Joined and left in ${year} by department`} />
      </Section>
      <Section title="Length of service" description={scope}>
        <ServiceChart bands={sumBands(departments)} />
      </Section>
    </div>
  );
}
