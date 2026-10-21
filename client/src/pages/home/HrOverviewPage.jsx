import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import { LoadError, Loading, PageHeader, Section, Select, Table, Td, Th } from '../../components/ui.jsx';
import { RequestList, Stat, Stats, Waiting } from './dashboard-ui.jsx';
import { BarList } from '../../components/charts.jsx';
import { LeaveTypeChart, OutcomesDonut, PeopleOffChart, TypeDonut } from './dashboard-charts.jsx';

export default function HrOverviewPage() {
  const [params, setParams] = useSearchParams();
  const companyId = params.get('companyId') ?? '';
  const q = useQuery({
    queryKey: ['dashboard', 'hr', companyId],
    queryFn: () => api.get(`/api/dashboard/hr${companyId ? `?companyId=${companyId}` : ''}`),
  });
  const companies = q.data?.companies ?? [];
  const { data: me } = useMe();
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={hasRole(me, 'HR_OFFICER') ? 'HR overview' : 'Group overview'}
        actions={
          companies.length > 0 && (
            <Select
              aria-label="Company"
              className="w-72"
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
          )
        }
      />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <Body d={q.data} />
      )}
    </div>
  );
}

function Body({ d }) {
  const { data: me } = useMe();
  // Directors see the same figures but do not approve, so the approval queue is not linked.
  const approvals = me.roles.includes('HR_OFFICER') ? '/hr/approvals' : undefined;
  const ex = d.exceptions;
  return (
    <>
      <Stats cols={3}>
        <Stat label="Waiting for HR" value={d.awaitingHr.length} to={approvals} />
        <Stat label="Overdue" value={ex.overdue} tone="danger" />
        <Stat label="On leave today" value={d.onLeave.length} />
      </Stats>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title={`Requests for ${d.charts.year}`} description="Where each request stands now">
          <OutcomesDonut outcomes={d.charts.outcomes} />
        </Section>
        <Section title={`Days taken by leave type, ${d.charts.year}`} description="Approved days">
          <TypeDonut
            label={`Approved days by leave type, ${d.charts.year}`}
            empty={`No approved leave yet in ${d.charts.year}.`}
            items={d.charts.byType}
          />
        </Section>
      </div>

      <Section title="Who is off in the next 30 days">
        <PeopleOffChart daily={d.charts.offDaily} />
      </Section>

      <Section title={`Leave taken by month, ${d.charts.year}`} description="Approved days by leave type">
        <LeaveTypeChart byType={d.charts.monthlyByType} year={d.charts.year} />
      </Section>

      <Section title="Waiting for final approval">
        <RequestList
          items={d.awaitingHr}
          yourTurn={approvals ? 'PENDING_HR_APPROVAL' : undefined}
          showEmployee
          showCompany={!d.companyId}
          empty="Nothing is waiting for HR."
          extra={(r) => <Waiting r={r} />}
        />
      </Section>

      <Section title="On leave today">
        <RequestList
          items={d.onLeave}
          showEmployee
          showCompany={!d.companyId}
          empty="Nobody is on leave today."
        />
      </Section>

      {!d.companyId && d.utilisation.companies.length > 1 && (
        <Section title={`Annual leave taken by company, ${d.utilisation.year}`}>
          <Table>
            <thead>
              <tr>
                <Th>Company</Th>
                <Th className="text-right">Staff</Th>
                <Th className="text-right">Days approved</Th>
                <Th className="text-right">Per person</Th>
              </tr>
            </thead>
            <tbody>
              {d.utilisation.companies.map((c) => (
                <tr key={c.company}>
                  <Td>{c.company}</Td>
                  <Td className="text-right">{c.headcount}</Td>
                  <Td className="text-right">{c.annualDaysApproved}</Td>
                  <Td className="text-right">{c.perPerson}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}

      <Section title={`Annual leave taken by department, ${d.utilisation.year}`}>
        {d.utilisation.rows.length === 0 ? (
          <p className="text-sm text-muted">No active employees.</p>
        ) : (
          <div className="space-y-5">
            <div className="max-w-2xl">
              <p className="mb-3 text-xs text-muted">Annual leave days approved per person</p>
              <BarList
                format={(n) => `${n} days`}
                items={[...d.utilisation.rows]
                  .sort((a, b) => b.perPerson - a.perPerson)
                  .map((u) => ({
                    key: `${u.company}|${u.department}`,
                    label: u.department,
                    sub: d.companyId ? `${u.headcount} staff` : `${u.company} · ${u.headcount} staff`,
                    value: u.perPerson,
                  }))}
              />
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Department</Th>
                  <Th className="text-right">Staff</Th>
                  <Th className="text-right">Days approved</Th>
                  <Th className="text-right">Per person</Th>
                </tr>
              </thead>
              <tbody>
                {d.utilisation.rows.map((u) => (
                  <tr key={`${u.company}|${u.department}`}>
                    <Td>
                      {u.department}
                      {!d.companyId && <p className="text-xs text-muted">{u.company}</p>}
                    </Td>
                    <Td className="text-right">{u.headcount}</Td>
                    <Td className="text-right">{u.annualDaysApproved}</Td>
                    <Td className="text-right">{u.perPerson}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Section>
    </>
  );
}
