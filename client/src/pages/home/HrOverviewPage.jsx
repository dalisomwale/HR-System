import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import { LoadError, Loading, PageHeader, Section, Select, Table, Td, Th } from '../../components/ui.jsx';
import { RequestList, Stat, Stats, Waiting } from './dashboard-ui.jsx';

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
              <option value="">Whole group</option>
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
  const isAdmin = me.roles.includes('HR_ADMIN');
  // Directors see the same figures but do not approve, so the approval queue is not linked.
  const approvals = me.roles.includes('HR_OFFICER') ? '/hr/approvals' : undefined;
  const ex = d.exceptions;
  const configIssues =
    ex.unconfirmedTypes.length + ex.accrualUnconfirmed.length + ex.unconfirmedSettings.length;
  return (
    <>
      <Stats>
        <Stat label="Waiting for HR" value={d.awaitingHr.length} to={approvals} />
        <Stat label="With managers" value={d.withManagers.length} to={approvals} />
        <Stat label="Overdue" value={ex.overdue} tone="danger" />
        <Stat label="On leave today" value={d.onLeave.length} />
      </Stats>

      <Section title="Exceptions">
        <ul className="divide-y divide-rule text-sm">
          <Exception
            ok={ex.held.length === 0}
            title={
              ex.held.length
                ? `${ex.held.length} ${ex.held.length === 1 ? 'request is' : 'requests are'} held: the manager is no longer active`
                : 'No requests held without an approver'
            }
          >
            {ex.held.length > 0 && (
              <RequestList items={ex.held} showEmployee showCompany={!d.companyId} empty="" />
            )}
            {ex.held.length > 0 && (
              <p className="mt-1 text-muted">
                Update the employee’s manager, or set up a delegation under Administration → Delegations.
              </p>
            )}
          </Exception>
          <Exception
            ok={ex.missingDocuments.count === 0}
            title={
              ex.missingDocuments.count
                ? `${ex.missingDocuments.count} ${ex.missingDocuments.count === 1 ? 'request is' : 'requests are'} missing a required document`
                : 'No required documents missing'
            }
          >
            {ex.missingDocuments.count > 0 && (
              <RequestList
                items={ex.missingDocuments.items}
                showEmployee
                showCompany={!d.companyId}
                empty=""
              />
            )}
          </Exception>
          <Exception
            ok={configIssues === 0}
            title={configIssues ? 'Policy settings still to confirm' : 'All policy settings confirmed'}
          >
            {configIssues > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-muted">
                {ex.accrualUnconfirmed.map((n) => (
                  <li key={n}>{n}: accrual rule not confirmed, so accrual will not run.</li>
                ))}
                {ex.unconfirmedTypes.map((t) => (
                  <li key={t.name}>
                    {t.name}: {t.reason.toLowerCase()}
                  </li>
                ))}
                {ex.unconfirmedSettings.length > 0 && (
                  <li>
                    {ex.unconfirmedSettings.length} workflow settings use defaults that HR has not confirmed.
                  </li>
                )}
              </ul>
            )}
            {configIssues > 0 && isAdmin && (
              <p className="mt-1">
                <Link to="/admin/leave-types" className="text-brand underline">
                  Leave types
                </Link>{' '}
                ·{' '}
                <Link to="/admin/settings" className="text-brand underline">
                  Workflow settings
                </Link>
              </p>
            )}
          </Exception>
          <Exception
            ok={ex.failedEmails === 0}
            title={
              ex.failedEmails
                ? `${ex.failedEmails} ${ex.failedEmails === 1 ? 'email' : 'emails'} could not be sent`
                : 'No failed emails'
            }
          >
            {ex.failedEmails > 0 && isAdmin && (
              <Link to="/admin/emails?status=PROBLEMS" className="text-brand underline">
                Review and resend
              </Link>
            )}
          </Exception>
        </ul>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Waiting for final approval">
          <RequestList
            items={d.awaitingHr}
            showEmployee
            showCompany={!d.companyId}
            empty="Nothing is waiting for HR."
            extra={(r) => <Waiting r={r} />}
          />
        </Section>
        <Section title="With managers">
          <RequestList
            items={d.withManagers}
            showEmployee
            showCompany={!d.companyId}
            empty="Nothing is with managers."
            extra={(r) => <Waiting r={r} />}
          />
        </Section>
      </div>

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

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={`Annual leave taken by department, ${d.utilisation.year}`}>
          {d.utilisation.rows.length === 0 ? (
            <p className="text-sm text-muted">No active employees.</p>
          ) : (
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
          )}
        </Section>
        <Section
          title="Carried-forward days expiring"
          description={
            d.carryForward.expiry
              ? `Unused carried-forward annual leave lapses after ${formatDate(d.carryForward.expiry)}.`
              : 'No carried-forward days are due to expire this year.'
          }
        >
          {d.carryForward.items.length === 0 ? (
            <p className="text-sm text-muted">Nobody has unused carried-forward days.</p>
          ) : (
            <ul className="divide-y divide-rule text-sm">
              {d.carryForward.items.map((c) => (
                <li key={c.employeeId} className="flex justify-between py-2">
                  <span>{c.name}</span>
                  <span className="text-muted">
                    {c.unused} of {c.carried} days unused
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}

function Exception({ ok, title, children }) {
  return (
    <li className="py-2.5">
      <p className="flex items-start gap-2">
        <span
          aria-hidden
          className={`mt-1.5 inline-block size-2 shrink-0 rounded-full ${ok ? 'bg-ok' : 'bg-pending'}`}
        />
        <span className={ok ? 'text-muted' : 'font-medium'}>{title}</span>
      </p>
      {children && <div className="mt-1.5 pl-4">{children}</div>}
    </li>
  );
}
