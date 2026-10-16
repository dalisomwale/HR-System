import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { dateRange, days } from '../../lib/leave.js';
import { Badge, Input, LoadError, Loading, PageHeader, Table, Td, Th } from '../../components/ui.jsx';
import { Stats } from './dashboard-ui.jsx';

/*
 * Department members for managers (D49): everyone in their department and anyone reporting to
 * them. Leave is shown by dates only, never by type, so private leave stays private.
 */

const FILTERS = [
  ['all', 'Members'],
  ['in', 'At work today'],
  ['away', 'On leave today'],
  ['soon', 'Leave in the next 30 days'],
];

export default function MembersPage() {
  const q = useQuery({ queryKey: ['members'], queryFn: () => api.get('/api/dashboard/members') });
  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Department members" description={q.data?.department ?? undefined} />
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
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const s = d.summary;
  const counts = { all: s.members, in: s.atWorkToday, away: s.onLeaveToday, soon: s.leaveNext30Days };

  const rows = d.members.filter((m) => {
    if (filter === 'in' && m.today.onLeave) return false;
    if (filter === 'away' && !m.today.onLeave) return false;
    if (filter === 'soon' && !m.leaveSoon) return false;
    const term = search.trim().toLowerCase();
    return (
      !term ||
      [m.name, m.employeeNumber, m.jobTitle, m.email].some((v) => v && v.toLowerCase().includes(term))
    );
  });

  return (
    <>
      <Stats>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-md border bg-white px-4 py-3 text-left hover:border-muted ${
              filter === key ? 'border-brand ring-1 ring-brand' : 'border-rule'
            }`}
          >
            <p className="text-2xl font-semibold">{counts[key]}</p>
            <p className="mt-0.5 text-sm text-muted">{label}</p>
          </button>
        ))}
      </Stats>

      <Input
        aria-label="Search members"
        placeholder="Search by name, employee number, job title or email"
        className="max-w-md"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{d.members.length ? 'Nobody matches.' : 'No members yet.'}</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Contact</Th>
              <Th>Today</Th>
              <Th className="text-right">Annual leave available</Th>
              <Th className="text-right">Taken in {d.year}</Th>
              <Th className="text-right">Pending requests</Th>
              <Th>Next leave</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <Td>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted">
                    {[m.jobTitle, m.employeeNumber].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-xs text-muted">
                    {m.reportsToYou ? 'Reports to you' : m.lineManager ? `Reports to ${m.lineManager}` : ''}
                    {m.startDate ? ` · Since ${formatDate(m.startDate)}` : ''}
                  </p>
                </Td>
                <Td>
                  {m.email && (
                    <a href={`mailto:${m.email}`} className="block text-brand hover:underline">
                      {m.email}
                    </a>
                  )}
                  {m.mobilePhone && (
                    <a href={`tel:${m.mobilePhone.replace(/[^+0-9]/g, '')}`} className="block text-muted">
                      {m.mobilePhone}
                    </a>
                  )}
                  {!m.email && !m.mobilePhone && <span className="text-muted">—</span>}
                </Td>
                <Td>
                  {m.today.onLeave ? (
                    <>
                      <Badge tone="pending">{m.today.halfDay ? 'Half day leave' : 'On leave'}</Badge>
                      <p className="mt-0.5 text-xs text-muted">Until {formatDate(m.today.until)}</p>
                    </>
                  ) : (
                    <Badge tone="ok">At work</Badge>
                  )}
                </Td>
                <Td className="text-right">{m.annual ? days(m.annual.available) : '—'}</Td>
                <Td className="text-right">{m.takenThisYear}</Td>
                <Td className="text-right">{m.pendingRequests}</Td>
                <Td>
                  {m.nextLeave ? (
                    <>
                      <p>{dateRange(m.nextLeave)}</p>
                      <p className="text-xs text-muted">{days(m.nextLeave.chargeableDays)}</p>
                    </>
                  ) : (
                    <span className="text-muted">None booked</span>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
