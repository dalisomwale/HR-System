import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import { api } from '../../lib/api.js';
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
} from '../../components/ui.jsx';
import { TypeMeter } from './people-ui.jsx';

/** Each company in the group side by side (D53). */
export default function CompanyOverviewPage() {
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['people-companies'],
    queryFn: () => api.get('/api/people/companies-overview'),
  });
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title="Company overview"
        description="Every company in the group, side by side"
        actions={
          hasRole(me, 'HR_OFFICER') && (
            <ButtonLink to="/people/companies/manage">
              <Settings2 className="size-4" aria-hidden /> Manage companies
            </ButtonLink>
          )
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data.companies.length === 0 ? (
        <div className="rounded-md border border-rule bg-white">
          <EmptyState title="No companies yet." />
        </div>
      ) : (
        <>
          {q.data.withoutCompany > 0 && (
            <Notice
              tone="pending"
              title={`${q.data.withoutCompany} active ${q.data.withoutCompany === 1 ? 'person has' : 'people have'} no company set.`}
            >
              <Link to="/people/employees?companyId=none" className="underline">
                See who
              </Link>
            </Notice>
          )}
          <div className="grid gap-6 xl:grid-cols-2">
            {q.data.companies.map((c) => (
              <CompanyCard key={c.id} c={c} year={q.data.year} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function CompanyCard({ c, year }) {
  return (
    <Section
      title={c.name}
      description={c.isActive ? c.code : `${c.code} · inactive`}
      actions={
        <Link
          to={`/people/employees?companyId=${c.id}`}
          className="text-sm whitespace-nowrap text-brand hover:underline"
        >
          Employees
        </Link>
      }
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <p>
          <span className="text-3xl font-semibold tabular-nums">{c.headcount}</span>{' '}
          <span className="text-sm text-muted">active staff</span>
        </p>
        <div className="min-w-56 flex-1">
          <TypeMeter byType={c.byType} />
        </div>
      </div>
      <Figures
        items={[
          ['Departments', c.departments.length],
          ['Managers', c.managers],
          ['On probation', c.onProbation],
          ['Contracts ending in 60 days', c.contractsEnding],
          [`Joined in ${year}`, c.joinedThisYear],
          [`Left in ${year}`, c.leftThisYear],
          ['Average service', c.headcount ? `${c.averageServiceYears} yrs` : '—'],
          ['No line manager', c.noManager],
        ]}
      />
      <h3 className="mt-5 mb-3 text-sm font-semibold">Staff by department</h3>
      <BarList
        empty="No staff in a department yet."
        format={(n) => `${n} ${n === 1 ? 'person' : 'people'}`}
        items={c.departments.slice(0, 6).map((d) => ({
          key: String(d.id),
          label: d.name,
          value: d.count,
          to: `/people/departments?companyId=${c.id}`,
        }))}
      />
    </Section>
  );
}

export function Figures({ items }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md bg-canvas px-3 py-2">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
