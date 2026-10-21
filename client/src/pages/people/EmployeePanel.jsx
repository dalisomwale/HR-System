import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Pencil, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import { Badge, Button, LoadError, Loading } from '../../components/ui.jsx';
import { EmployeeDetails, EmployeeForm } from './EmployeeRecordPage.jsx';
import { EMPLOYMENT_TYPES, Initials, StatusBadge } from './people-ui.jsx';

/**
 * One employee in a panel over the page (D59): their details, and for HR Officers the form to
 * change them, so a department or company page never has to be left to look at or edit someone.
 */
export default function EmployeePanel({ employeeId, onClose, onSaved, base = '/people' }) {
  const { data: me } = useMe();
  const canEdit = hasRole(me, 'HR_OFFICER');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const heading = useRef(null);
  const q = useQuery({
    queryKey: ['employee', String(employeeId)],
    queryFn: () => api.get(`/api/people/employees/${employeeId}`),
  });

  useEffect(() => {
    setEditing(false);
    setSaved(false);
  }, [employeeId]);
  // Escape closes; the page behind stays still while the panel is open.
  useEffect(() => {
    const close = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', close);
      document.body.style.overflow = '';
    };
  }, [onClose]);
  useEffect(() => {
    if (q.isSuccess) heading.current?.focus();
  }, [q.isSuccess, employeeId]);

  const e = q.data;
  return (
    <>
      <button type="button" aria-label="Close" className="fixed inset-0 z-40 bg-ink/30" onClick={onClose} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={e ? `${e.firstName} ${e.lastName}` : 'Employee'}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-rule bg-canvas shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-rule bg-white px-4 py-4 sm:px-6">
          {e && <Initials first={e.firstName} last={e.lastName} size="lg" />}
          <div className="min-w-0 flex-1">
            {e && (
              <>
                <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
                  {e.firstName} {e.lastName}
                </h2>
                <p className="text-sm text-muted">
                  {[e.jobTitle, e.department, e.employeeNumber].filter(Boolean).join(' · ')}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusBadge e={e} />
                  {e.employmentType && <Badge tone="neutral">{EMPLOYMENT_TYPES[e.employmentType]}</Badge>}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {q.isPending ? (
            <Loading />
          ) : q.isError ? (
            <LoadError error={q.error} onRetry={() => q.refetch()} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {canEdit && !editing && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setSaved(false);
                      setEditing(true);
                    }}
                  >
                    <Pencil className="size-4" aria-hidden /> Edit details
                  </Button>
                )}
                <Link
                  to={`${base}/employees/${e.id}`}
                  className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-brand hover:underline"
                >
                  <ExternalLink className="size-4" aria-hidden /> Full record
                </Link>
              </div>
              {editing ? (
                <EmployeeForm
                  employee={e}
                  onDone={() => {
                    setEditing(false);
                    setSaved(true);
                    onSaved?.();
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <EmployeeDetails employee={e} saved={saved} />
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
