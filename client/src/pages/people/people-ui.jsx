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
