import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, UserPlus, Users } from 'lucide-react';
import { api, qs } from '../../lib/api.js';
import { hasRole, useMe } from '../../lib/auth.jsx';
import { formatDate } from '../../lib/format.js';
import {
  Badge,
  Button,
  ButtonLink,
  Field,
  Input,
  Select,
  LoadError,
  Loading,
  Notice,
  PageHeader,
  Section,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';
import { Stat, Stats } from '../home/dashboard-ui.jsx';
import { Figures } from './CompanyOverviewPage.jsx';
import { GenderDonutChart, ServiceChart, TypeDonutChart } from './people-charts.jsx';
import { EMPLOYMENT_TYPES, Initials, StatusBadge, TypeMeter } from './people-ui.jsx';
import { EmployeeForm } from './EmployeeRecordPage.jsx';
import EmployeePanel from './EmployeePanel.jsx';
import PeopleTrail from './PeopleTrail.jsx';

const BANDS = [
  ['lt1', 'Under 1 year'],
  ['y1to2', '1 to 2 years'],
  ['y2to5', '2 to 5 years'],
  ['y5to10', '5 to 10 years'],
  ['gt10', 'Over 10 years'],
];

/** One department's overview and its people, opened from the Departments menu (D56). */
export default function DepartmentPage() {
  const { id } = useParams();
  const { data: me } = useMe();
  const canEdit = hasRole(me, 'HR_OFFICER');
  // Adding someone or editing the department happens here, in a panel under the header.
  const [panel, setPanel] = useState(null);
  const [added, setAdded] = useState(null);
  // The person open in the side panel, if any.
  const [viewing, setViewing] = useState(null);
  const qc = useQueryClient();
  useEffect(() => {
    setPanel(null);
    setAdded(null);
    setViewing(null);
  }, [id]);
  const overview = useQuery({
    queryKey: ['people-departments', ''],
    queryFn: () => api.get('/api/people/departments-overview'),
  });
  const people = useQuery({
    queryKey: ['employees', { departmentId: id, status: 'ACTIVE', pageSize: 500 }],
    queryFn: () =>
      api.get(`/api/people/employees${qs({ departmentId: id, status: 'ACTIVE', pageSize: 500 })}`),
  });

  const back = <PeopleTrail />;
  if (overview.isPending) return <Loading />;
  if (overview.isError) return <LoadError error={overview.error} onRetry={() => overview.refetch()} />;
  const d = overview.data.departments.find((x) => String(x.id) === id);
  if (!d) {
    return (
      <div className="max-w-6xl">
        {back}
        <Notice tone="neutral" title="Department not found, or it is inactive with no staff." />
      </div>
    );
  }
  const year = overview.data.year;

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        {back}
        <PageHeader
          title={d.name}
          description={
            <>
              {d.code}
              {d.company && (
                <>
                  {' · '}
                  <Link to={`/people/companies/${d.companyId}`} className="text-brand hover:underline">
                    {d.company}
                  </Link>
                </>
              )}
            </>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {!d.isActive && <Badge>Inactive</Badge>}
              <Button
                variant="secondary"
                onClick={() =>
                  document.getElementById('department-people')?.scrollIntoView({ behavior: 'smooth' })
                }
              >
                <Users className="size-4" aria-hidden /> Employees
              </Button>
              {canEdit && (
                <>
                  <Button
                    variant={panel === 'add' ? 'primary' : 'secondary'}
                    aria-expanded={panel === 'add'}
                    onClick={() => {
                      setAdded(null);
                      setPanel(panel === 'add' ? null : 'add');
                    }}
                  >
                    <UserPlus className="size-4" aria-hidden /> Add employee
                  </Button>
                  <Button
                    variant={panel === 'edit' ? 'primary' : 'secondary'}
                    aria-expanded={panel === 'edit'}
                    onClick={() => setPanel(panel === 'edit' ? null : 'edit')}
                  >
                    <Pencil className="size-4" aria-hidden /> Edit department
                  </Button>
                </>
              )}
            </div>
          }
        />
      </div>

      {added && (
        <Notice tone="ok" title={`${added.name} was added to ${d.name}.`}>
          <Link to={`/people/employees/${added.id}`} className="underline">
            Open their record
          </Link>
        </Notice>
      )}
      {panel === 'add' && (
        <EmployeeForm
          isNew
          title={`Add an employee to ${d.name}`}
          defaults={{
            departmentId: String(d.id),
            companyId: d.companyId ? String(d.companyId) : '',
          }}
          onCancel={() => setPanel(null)}
          onCreated={(newId, values) => {
            setPanel(null);
            setAdded({ id: newId, name: `${values.firstName} ${values.lastName}` });
            qc.invalidateQueries({ queryKey: ['people-departments'] });
            qc.invalidateQueries({ queryKey: ['people-companies'] });
          }}
        />
      )}
      {panel === 'edit' && (
        <EditDepartment
          d={d}
          onDone={() => {
            setPanel(null);
            qc.invalidateQueries({ queryKey: ['people-departments'] });
            qc.invalidateQueries({ queryKey: ['people-companies'] });
            qc.invalidateQueries({ queryKey: ['people-organisation'] });
            qc.invalidateQueries({ queryKey: ['departments'] });
          }}
          onCancel={() => setPanel(null)}
        />
      )}

      <Stats>
        <Stat label="Active staff" value={d.headcount} to={`/people/employees?departmentId=${d.id}`} />
        <Stat label="Managers" value={d.managers} />
        <Stat
          label="On probation"
          value={d.onProbation}
          to={`/people/employees?departmentId=${d.id}&filter=probation`}
        />
        <Stat
          label="Contracts ending in 60 days"
          value={d.contractsEnding}
          to={`/people/employees?departmentId=${d.id}&filter=contractEnding`}
        />
      </Stats>

      <Section title="At a glance">
        <TypeMeter byType={d.byType} />
        <Figures
          items={[
            [`Joined in ${year}`, d.joinedThisYear],
            [`Left in ${year}`, d.leftThisYear],
            ['Average service', d.headcount ? `${d.averageServiceYears} yrs` : '—'],
            ['No line manager', d.noManager],
          ]}
        />
      </Section>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <Section title="Employment type">
          <TypeDonutChart byType={d.byType} />
        </Section>
        <Section title="Gender">
          <GenderDonutChart bySex={d.bySex} />
        </Section>
        <Section title="Length of service">
          <ServiceChart bands={BANDS.map(([key, label]) => ({ key, label, count: d.serviceBands[key] }))} />
        </Section>
      </div>

      <Section
        title="People"
        description="Everyone active in this department. Select a name to see or edit their details."
        className="scroll-mt-20"
      >
        <span id="department-people" />
        {people.isPending ? (
          <Loading />
        ) : people.isError ? (
          <LoadError error={people.error} onRetry={() => people.refetch()} />
        ) : people.data.items.length === 0 ? (
          <p className="text-sm text-muted">Nobody in this department yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Job title</Th>
                <Th>Line manager</Th>
                <Th>Type</Th>
                <Th>Started</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {people.data.items.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Initials first={e.firstName} last={e.lastName} />
                      <button
                        type="button"
                        onClick={() => setViewing(e.id)}
                        className="text-left font-medium text-brand hover:underline"
                      >
                        {e.firstName} {e.lastName}
                      </button>
                    </div>
                  </Td>
                  <Td>{e.jobTitle ?? <span className="text-muted">Not set</span>}</Td>
                  <Td>{e.lineManager ?? <span className="text-muted">None</span>}</Td>
                  <Td>{EMPLOYMENT_TYPES[e.employmentType] ?? <span className="text-muted">Not set</span>}</Td>
                  <Td className="whitespace-nowrap">{formatDate(e.employmentStartDate)}</Td>
                  <Td>
                    <StatusBadge e={e} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      {viewing && (
        <EmployeePanel
          employeeId={viewing}
          base={`/people/departments/${d.id}`}
          onClose={() => setViewing(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['employees'] });
            qc.invalidateQueries({ queryKey: ['people-departments'] });
            qc.invalidateQueries({ queryKey: ['people-companies'] });
          }}
        />
      )}
    </div>
  );
}

/** Name, code and status of the department, edited in place (D57). */
function EditDepartment({ d, onDone, onCancel }) {
  const [form, setForm] = useState({ name: d.name, code: d.code, isActive: d.isActive });
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/admin/departments/${d.id}`, {
        name: form.name,
        code: form.code,
        isActive: form.isActive,
      }),
    onSuccess: onDone,
  });
  return (
    <Section title={`Edit ${d.name}`} description={d.company ?? undefined}>
      <form
        className="grid gap-4 sm:grid-cols-3 lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field id="editDeptName" label="Name">
          <Input
            id="editDeptName"
            value={form.name}
            maxLength={120}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </Field>
        <Field id="editDeptCode" label="Code">
          <Input
            id="editDeptCode"
            value={form.code}
            maxLength={20}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            required
          />
        </Field>
        <Field id="editDeptStatus" label="Status">
          <Select
            id="editDeptStatus"
            value={form.isActive ? 'active' : 'inactive'}
            onChange={(e) => setForm({ ...form, isActive: e.target.value === 'active' })}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
        </Field>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
          <Button type="submit" busy={save.isPending}>
            Save changes
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={save.isPending}>
            Cancel
          </Button>
          {save.isError && <span className="text-sm text-danger">{save.error.message}</span>}
        </div>
      </form>
    </Section>
  );
}
