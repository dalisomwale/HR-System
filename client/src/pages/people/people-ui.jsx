import { useParams } from 'react-router';
import { Badge } from '../../components/ui.jsx';
import { formatDate } from '../../lib/format.js';

/** Shared labels and small pieces for the Employee management module (D52). */

export const EMPLOYMENT_TYPES = {
  PERMANENT: 'Permanent',
  FIXED_TERM: 'Fixed-term contract',
  TEMPORARY: 'Temporary',
};

export const PROBATION = {
  ON_PROBATION: 'On probation',
  EXTENDED: 'Probation extended',
  CONFIRMED: 'Confirmed',
};

export const FIELD_LABELS = {
  employeeNumber: 'Employee number',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Work email',
  jobTitle: 'Job title',
  sex: 'Sex',
  companyId: 'Company',
  departmentId: 'Department',
  lineManagerId: 'Line manager',
  workScheduleId: 'Working schedule',
  employmentStartDate: 'Start date',
  employmentEndDate: 'End date',
  employmentType: 'Employment type',
  contractEndDate: 'Contract end',
  probationEndDate: 'Probation end',
  probationStatus: 'Probation',
  payGrade: 'Pay grade',
};

const DATE_FIELDS = new Set([
  'employmentStartDate',
  'employmentEndDate',
  'contractEndDate',
  'probationEndDate',
]);
const ENUMS = {
  employmentType: EMPLOYMENT_TYPES,
  probationStatus: PROBATION,
  sex: { FEMALE: 'Female', MALE: 'Male' },
};

/** A history value as people read it. */
export function historyValue(field, value) {
  if (value == null || value === '') return null;
  if (DATE_FIELDS.has(field)) return formatDate(value);
  return ENUMS[field]?.[value] ?? value;
}

export function Initials({ first, last, size = 'sm' }) {
  const text = `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
  const box = size === 'lg' ? 'size-14 text-lg' : 'size-9 text-xs';
  return (
    <span
      aria-hidden
      className={`flex ${box} shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand`}
    >
      {text}
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** The one status that matters most for a person right now. */
export function StatusBadge({ e }) {
  if (e.status !== 'ACTIVE') return <Badge>Left</Badge>;
  const t = today();
  if (e.employmentStartDate > t)
    return <Badge tone="brand">Starts {formatDate(e.employmentStartDate)}</Badge>;
  if (e.employmentEndDate && e.employmentEndDate >= t)
    return <Badge tone="neutral">Leaving {formatDate(e.employmentEndDate)}</Badge>;
  if (e.contractEndDate && e.contractEndDate >= t && e.contractEndDate <= inDays(60))
    return <Badge tone="pending">Contract ends {formatDate(e.contractEndDate)}</Badge>;
  if (e.probationStatus === 'ON_PROBATION' || e.probationStatus === 'EXTENDED')
    return <Badge tone="brand">{PROBATION[e.probationStatus]}</Badge>;
  return <Badge tone="ok">Active</Badge>;
}

const TYPE_PARTS = [
  { key: 'PERMANENT', name: 'Permanent', color: '#2a3fbf' },
  { key: 'FIXED_TERM', name: 'Fixed-term', color: '#eb6834' },
  { key: 'TEMPORARY', name: 'Temporary', color: '#1baf7a' },
  { key: 'NONE', name: 'Not recorded', color: '#a3aab8' },
];

/** Staff split by employment type: one bar with the counts beneath it. */
export function TypeMeter({ byType, compact = false }) {
  const parts = TYPE_PARTS.map((p) => ({ ...p, value: byType?.[p.key] ?? 0 }));
  const total = parts.reduce((s, p) => s + p.value, 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div
        className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded bg-[#eceef7]"
        role="img"
        aria-label={`Employment type: ${shown.map((p) => `${p.name} ${p.value}`).join(', ') || 'none'}`}
      >
        {total > 0 &&
          shown.map((p) => (
            <div
              key={p.key}
              title={`${p.name}: ${p.value}`}
              style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            />
          ))}
      </div>
      {!compact && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {shown.map((p) => (
            <li key={p.key} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-sm"
                style={{ background: p.color }}
              />
              {p.name} <span className="font-semibold text-ink">{p.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Where an employee's record sits in the path (D62): inside the company or department page it
 * was opened from, so the path carries on (… › Altus Capital Limited › Add employee), or under
 * Employees otherwise. Returns the base to put `/employees/:id` after.
 */
export function useEmployeeBase() {
  const { companyId, departmentId } = useParams();
  if (companyId) return `/people/companies/${companyId}`;
  if (departmentId) return `/people/departments/${departmentId}`;
  return '/people';
}
