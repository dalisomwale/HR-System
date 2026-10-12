import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { api } from '../../lib/api.js';
import {
  Badge,
  Button,
  ButtonLink,
  Notice,
  PageHeader,
  Section,
  Table,
  Td,
  Th,
} from '../../components/ui.jsx';

const COLUMNS = [
  ['employee_number', 'Required. Must be unique.'],
  ['first_name', 'Required.'],
  ['last_name', 'Required.'],
  ['email', 'Work email.'],
  ['job_title', ''],
  ['department_name', 'For example Credit. A new name with a new code creates the department.'],
  ['department_code', 'For example CRD. An existing code must match its department name.'],
  ['manager_employee_name', 'First and last name of an active employee or someone else in the same file.'],
  ['employment_start_date', 'Required. YYYY-MM-DD.'],
];

export default function ImportPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  const [csv, setCsv] = useState('');
  const preview = useMutation({
    mutationFn: (text) => api.post('/api/admin/employees/import/preview', { csv: text }),
  });
  const commit = useMutation({
    mutationFn: () => api.post('/api/admin/employees/import/commit', { csv }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee-options'] });
      qc.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  async function onFile(e) {
    const f = e.target.files?.[0];
    commit.reset();
    if (!f) return;
    setFile(f);
    const text = await f.text();
    setCsv(text);
    preview.mutate(text);
  }

  const result = preview.data;
  const ready = result && result.validRows === result.totalRows;

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Import employees"
        actions={
          <a
            href="/api/admin/employees/import/template"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-rule bg-white px-3.5 text-sm font-medium hover:border-muted"
          >
            <Download className="size-4" aria-hidden /> Download template
          </a>
        }
      />

      <div className="grid gap-6">
        <Section
          title="Columns"
          description="Save the spreadsheet as CSV (UTF-8). The first row must contain these column names."
        >
          <table className="w-full text-sm">
            <tbody>
              {COLUMNS.map(([c, help]) => (
                <tr key={c} className="border-b border-rule last:border-0">
                  <td className="py-1.5 pr-4 font-medium whitespace-nowrap">{c}</td>
                  <td className="py-1.5 text-muted">{help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Upload">
          <label className="block text-sm font-medium" htmlFor="csvFile">
            CSV file
          </label>
          <input
            id="csvFile"
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="mt-1 block text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-rule file:bg-white file:px-3 file:text-sm file:font-medium"
          />
          {preview.isPending && <p className="mt-3 text-sm text-muted">Checking {file?.name}…</p>}
          {preview.isError && (
            <div className="mt-4">
              <Notice tone="danger">{preview.error.message}</Notice>
            </div>
          )}
        </Section>

        {commit.isSuccess ? (
          <Notice
            tone="ok"
            title={`${commit.data.imported} employees imported${
              commit.data.departmentsCreated
                ? `, ${commit.data.departmentsCreated} new ${commit.data.departmentsCreated === 1 ? 'department' : 'departments'}`
                : ''
            }.`}
          >
            Next, link their Microsoft accounts: ask them to sign in once, then use Sign-in requests.{' '}
            <ButtonLink to="/admin/sign-in-requests" variant="ghost" className="h-auto px-1">
              Open sign-in requests
            </ButtonLink>
          </Notice>
        ) : (
          result && (
            <Section
              title={
                ready
                  ? `All ${result.totalRows} rows are ready to import`
                  : `${result.totalRows - result.validRows} of ${result.totalRows} rows need fixing`
              }
              description={
                ready
                  ? 'Check the list, then confirm.'
                  : 'Fix these rows in your spreadsheet and upload the file again.'
              }
              actions={
                ready && (
                  <Button busy={commit.isPending} onClick={() => commit.mutate()}>
                    Import {result.totalRows} employees
                  </Button>
                )
              }
            >
              {commit.isError && (
                <div className="mb-4">
                  <Notice tone="danger">{commit.error.message}</Notice>
                </div>
              )}
              {ready && result.newDepartments?.length > 0 && (
                <div className="mb-4">
                  <Notice tone="neutral" title="New departments will be created">
                    {result.newDepartments.map((d) => `${d.name} (${d.code})`).join(', ')}
                  </Notice>
                </div>
              )}
              <Table>
                <thead>
                  <tr>
                    <Th>Line</Th>
                    <Th>Employee</Th>
                    <Th>Result</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...result.rows]
                    .sort((a, b) => b.errors.length - a.errors.length || a.line - b.line)
                    .map((r) => (
                      <tr key={r.line}>
                        <Td>{r.line}</Td>
                        <Td>
                          <span className="font-medium">{r.name || 'No name'}</span>{' '}
                          <span className="text-muted">{r.employeeNumber}</span>
                        </Td>
                        <Td>
                          {r.errors.length === 0 ? (
                            <Badge tone="ok">Ready</Badge>
                          ) : (
                            <ul className="list-disc pl-4 text-danger">
                              {r.errors.map((e) => (
                                <li key={e}>{e}</li>
                              ))}
                            </ul>
                          )}
                        </Td>
                      </tr>
                    ))}
                </tbody>
              </Table>
            </Section>
          )
        )}
      </div>
    </div>
  );
}
