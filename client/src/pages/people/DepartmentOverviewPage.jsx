import { Link, useSearchParams } from 'react-router';
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
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { TypeMeter } from './people-ui.jsx';
import {
  MovesByGroup,
  ServiceChart,
  TypeDonutChart,
  TypesByGroup,
  shortName,
  sumBands,
  sumTypes,
} from './people-charts.jsx';

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
                <option value="">Whole group</option>
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
      <Statistics departments={sorted} year={d.year} companyId={companyId} />

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
              to: `/people/employees?departmentId=${x.id}`,
            }))}
          />
        </div>
      </Section>

      <Section
        title="Department figures"
        description={`Joined and left are for ${d.year}; contracts ending are the next 60 days`}
      >
        <Table>
          <thead>
            <tr>
              <Th>Department</Th>
              <Th className="text-right">Staff</Th>
              <Th>Employment type</Th>
              <Th className="text-right">Managers</Th>
              <Th className="text-right">On probation</Th>
              <Th className="text-right">Contracts ending</Th>
              <Th className="text-right">Joined</Th>
              <Th className="text-right">Left</Th>
              <Th className="text-right">Average service</Th>
              <Th className="text-right">No manager</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((x) => (
              <tr key={x.id}>
                <Td>
                  <Link
                    to={`/people/employees?departmentId=${x.id}`}
                    className="font-medium text-brand hover:underline"
                  >
                    {x.name}
                  </Link>
                  {!companyId && <p className="text-xs text-muted">{x.company ?? 'No company'}</p>}
                  {!x.isActive && <p className="text-xs text-muted">Inactive</p>}
                </Td>
                <Td className="text-right font-semibold">{x.headcount}</Td>
                <Td className="min-w-32">
                  <TypeMeter byType={x.byType} compact />
                </Td>
                <Td className="text-right">{x.managers}</Td>
                <Td className="text-right">{x.onProbation}</Td>
                <Td className={`text-right ${x.contractsEnding ? 'font-semibold text-pending' : ''}`}>
                  {x.contractsEnding}
                </Td>
                <Td className="text-right">{x.joinedThisYear}</Td>
                <Td className="text-right">{x.leftThisYear}</Td>
                <Td className="text-right whitespace-nowrap">
                  {x.headcount ? `${x.averageServiceYears} yrs` : '—'}
                </Td>
                <Td className={`text-right ${x.noManager ? 'font-semibold text-pending' : ''}`}>
                  {x.noManager}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {[
            ['#2a3fbf', 'Permanent'],
            ['#eb6834', 'Fixed-term'],
            ['#1baf7a', 'Temporary'],
            ['#a3aab8', 'Not recorded'],
          ].map(([c, n]) => (
            <span key={n} className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: c }} />
              {n}
            </span>
          ))}
        </div>
      </Section>
    </>
  );
}

function Statistics({ departments, year, companyId }) {
  // The twelve largest departments keep the charts readable; the table below has them all.
  const top = departments.filter((x) => x.headcount > 0 || x.joinedThisYear || x.leftThisYear).slice(0, 12);
  const groups = top.map((x) => ({
    key: String(x.id),
    tick: shortName(x),
    title: companyId ? x.name : `${x.name}, ${x.company ?? 'No company'}`,
    byType: x.byType,
    joined: x.joinedThisYear,
    left: x.leftThisYear,
  }));
  const scope = companyId ? 'This company' : 'Whole group';
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Section title="Employment type by department" description="Active staff, largest departments">
        <TypesByGroup groups={groups} label="Active staff in each department by employment type" />
      </Section>
      <Section title="Employment type" description={scope}>
        <TypeDonutChart byType={sumTypes(departments)} />
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
