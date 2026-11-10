import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, Upload } from 'lucide-react';
import { api } from '../../lib/api.js';
import { Badge, Button, Notice, Section, Table, Td, Th } from '../../components/ui.jsx';

const COLUMNS = [
  ['employee_number', 'Required. Must be unique.'],
  ['first_name', 'Required.'],
  ['last_name', 'Required.'],
  ['email', 'Work email.'],
  ['job_title', ''],
  ['company_name', 'Required, or give company_code. The group company the person works for.'],
  [
    'company_code',
    'An existing code must match its company name. A new code with a name creates the company.',
  ],
  [
    'department_name',
    'For example Credit. A new name with a new code creates the department in that company.',
  ],
  ['department_code', 'For example CRD. Codes are matched within the company.'],
  ['manager_employee_name', 'First and last name of someone you report to.'],
  ['employment_start_date', 'Required. YYYY-MM-DD.'],
];

/** Upload, check and import a CSV of employees. Also shown on Add employee (D69). */
export function ImportEmployees() {
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  // { csv } for a CSV file, { xlsx } (base64) for an Excel workbook (D78).
  const [upload, setUpload] = useState(null);
  const [fileError, setFileError] = useState(null);
  const preview = useMutation({
    mutationFn: (body) => api.post('/api/admin/employees/import/preview', body),
  });
  const commit = useMutation({
    mutationFn: (skipInvalid) =>
      api.post('/api/admin/employees/import/commit', { ...upload, skipInvalid: skipInvalid === true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee-options'] });
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['companies'] });
    },
  });

  async function onFile(e) {
    const f = e.target.files?.[0];
    // Clear the field so choosing the same file again, after fixing it, checks it again.
    e.target.value = '';
    commit.reset();
    if (!f) return;
    setFile(f);
    setFileError(null);
    preview.reset();
    const name = f.name.toLowerCase();
    let body;
    if (name.endsWith('.xlsx')) {
      body = { xlsx: await toBase64(f) };
    } else if (name.endsWith('.xls')) {
      setUpload(null);
      setFileError(
        'Old Excel files (.xls) cannot be read. In Excel use Save As and choose Excel Workbook (.xlsx).',
      );
      return;
    } else {
      body = { csv: await f.text() };
    }
    setUpload(body);
    preview.mutate(body);
  }

  const result = preview.data;
  const ready = result && result.validRows === result.totalRows;

  return (
    <div className="grid gap-4">
      <Section
        title="Columns"
        description="Upload an Excel workbook (.xlsx) or a CSV file. The first row must contain these column names; in Excel, only the first sheet is read."
        actions={
          <div className="flex flex-wrap gap-2">
            {[
              ['xlsx', 'Excel template'],
              ['csv', 'CSV template'],
            ].map(([format, label]) => (
              <a
                key={format}
                href={`/api/admin/employees/import/template${format === 'xlsx' ? '?format=xlsx' : ''}`}
                className="inline-flex h-9 items-center gap-2 rounded-sm border border-rule bg-white px-3.5 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors hover:border-rule-strong hover:bg-[#fafafa]"
              >
                <Download className="size-4" aria-hidden /> {label}
              </a>
            ))}
          </div>
        }
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
        <div className="flex flex-wrap items-center gap-3">
          <label
            htmlFor="csvFile"
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-brand px-4 text-sm font-medium text-white hover:bg-brand/90 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand"
          >
            <Upload className="size-4" aria-hidden />{' '}
            {file ? 'Choose another file' : 'Upload Excel or CSV file'}
            <input
              id="csvFile"
              type="file"
              accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onFile}
              className="sr-only"
            />
          </label>
          <span className="muted-text">{file ? file.name : 'No file chosen yet'}</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          The file is checked first. Nothing is saved until you confirm the import.
        </p>
        {fileError && (
          <div className="mt-4">
            <Notice tone="danger">{fileError}</Notice>
          </div>
        )}
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
          title={`${commit.data.imported} ${commit.data.imported === 1 ? 'employee' : 'employees'} imported${[
            [commit.data.companiesCreated, 'company', 'companies'],
            [commit.data.departmentsCreated, 'department', 'departments'],
          ]
            .filter(([n]) => n)
            .map(([n, one, many]) => `, ${n} new ${n === 1 ? one : many}`)
            .join('')}.`}
        >
          {commit.data.skipped > 0 &&
            `${commit.data.skipped} ${commit.data.skipped === 1 ? 'row was' : 'rows were'} left out; fix ${commit.data.skipped === 1 ? 'it' : 'them'} and import just ${commit.data.skipped === 1 ? 'that row' : 'those rows'} later. `}
          {commit.data.managersLeftBlank > 0 &&
            `${commit.data.managersLeftBlank} ${commit.data.managersLeftBlank === 1 ? 'person has' : 'people have'} no manager yet, because their manager was in a row left out. `}
          They can now sign in with Microsoft. Each account links to its record by the work email.
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
                : result.validRows > 0
                  ? 'Fix these rows in your spreadsheet and upload it again, or import the rows that are ready now and add the rest later.'
                  : 'Fix these rows in your spreadsheet and upload the file again.'
            }
            actions={
              ready ? (
                <Button busy={commit.isPending} onClick={() => commit.mutate(false)}>
                  Import {result.totalRows} employees
                </Button>
              ) : (
                result.validRows > 0 && (
                  <Button variant="secondary" busy={commit.isPending} onClick={() => commit.mutate(true)}>
                    Import the {result.validRows} ready {result.validRows === 1 ? 'row' : 'rows'}
                  </Button>
                )
              )
            }
          >
            {commit.isError && (
              <div className="mb-4">
                <Notice tone="danger">{commit.error.message}</Notice>
              </div>
            )}
            {ready && result.newCompanies?.length > 0 && (
              <div className="mb-4">
                <Notice tone="neutral" title="New companies will be created">
                  {result.newCompanies.map((c) => `${c.name} (${c.code})`).join(', ')}
                </Notice>
              </div>
            )}
            {ready && result.newDepartments?.length > 0 && (
              <div className="mb-4">
                <Notice tone="neutral" title="New departments will be created">
                  {result.newDepartments.map((d) => `${d.name} (${d.code}) in ${d.company}`).join(', ')}
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
  );
}

/** A file's bytes as base64, for sending an Excel workbook in JSON. */
async function toBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}
