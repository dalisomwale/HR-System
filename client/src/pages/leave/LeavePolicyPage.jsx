import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../../lib/api.js';
import { EmptyState, LoadError, Loading, PageHeader } from '../../components/ui.jsx';

/*
 * The leave types open to you, in plain words (D130): what each is for and what it needs,
 * with a link to apply. Opened from "View Leave Policy" on the leave balances.
 */
export default function LeavePolicyPage() {
  const q = useQuery({ queryKey: ['leave-types'], queryFn: () => api.get('/api/leave/types') });
  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Leave Policy"
        description="The leave you can take, what each type is for and what it needs."
      />
      {q.isPending && <Loading />}
      {q.isError && <LoadError error={q.error} onRetry={q.refetch} />}
      {q.data &&
        (q.data.items.length === 0 ? (
          <div className="card p-0">
            <EmptyState title="No Leave Types Are Active Yet" />
          </div>
        ) : (
          <ul className="divide-y divide-rule rounded-md border border-rule bg-white shadow-card">
            {q.data.items.map((t) => {
              const needs = [
                t.dayBasis === 'CALENDAR_DAYS' ? 'Counted in calendar days' : 'Counted in working days',
                t.allowHalfDay ? 'Half days allowed' : null,
                t.minNoticeDays ? `Apply at least ${t.minNoticeDays} days before` : null,
                t.documentRequired ? t.documentDescription || 'A supporting document is needed' : null,
                t.handoverRequired ? 'A handover is needed' : null,
                t.reasonRequired ? 'A reason is needed' : null,
              ].filter(Boolean);
              return (
                <li
                  key={t.id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="min-w-0">
                    <h2 className="font-head text-base font-semibold text-ink">{t.name}</h2>
                    {t.description && <p className="mt-1 text-sm text-muted">{t.description}</p>}
                    {needs.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {needs.map((n) => (
                          <li key={n} className="rounded-sm bg-canvas px-2 py-0.5 text-xs text-ink">
                            {n}
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.notAvailableReason && (
                      <p className="mt-2 text-xs text-pending">{t.notAvailableReason}</p>
                    )}
                  </div>
                  {!t.notAvailableReason && (
                    <Link to={`/leave/apply?type=${t.id}`} className="btn btn-secondary btn-sm shrink-0">
                      Apply Leave
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
