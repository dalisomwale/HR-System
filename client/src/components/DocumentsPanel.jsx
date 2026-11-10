import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Eye, FileSpreadsheet, FileText, Lock } from 'lucide-react';
import { can, useMe } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { Button, Notice, Section } from './ui.jsx';

const MAX_MB = 5;
const kb = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

export const HANDOVER_TEMPLATE_URL = '/api/leave/handover-template';

const KINDS = {
  SUPPORTING: {
    accept: 'application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png',
    ok: /\.(pdf|jpe?g|png)$/i,
    wrong: 'Only PDF, JPEG and PNG files can be uploaded.',
    query: '',
  },
  HANDOVER: {
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ok: /\.xlsx$/i,
    wrong: 'The handover sheet must be an Excel file (.xlsx). Use the handover template.',
    query: '?kind=handover',
  },
};

/**
 * The handover sheet (D98) and supporting documents on a request. Supporting documents only
 * appear for leave types that require one. The server decides who sees what; this only shows it.
 */
export default function DocumentsPanel({ request: r }) {
  const req = r.documentRequirement;
  const handover = r.documents.filter((d) => d.kind === 'HANDOVER');
  const supporting = r.documents.filter((d) => d.kind !== 'HANDOVER');
  return (
    <div className="grid gap-4">
      <Section
        title="Handover sheet"
        description="The handover template in Excel, filled in by the employee."
        actions={
          r.can.uploadDocument && (
            <a href={HANDOVER_TEMPLATE_URL} className="card-link">
              Download template
            </a>
          )
        }
      >
        <DocList request={r} docs={handover} kind="HANDOVER" canAdd={handover.length === 0} />
      </Section>
      {(req || supporting.length > 0) && (
        <Section
          title="Supporting documents"
          description={req ? `Required: ${req.description ?? 'a supporting document'}.` : undefined}
        >
          {req && !req.provided && (
            <div className="mb-3">
              <Notice tone="pending">No document has been provided yet.</Notice>
            </div>
          )}
          <DocList request={r} docs={supporting} kind="SUPPORTING" canAdd={Boolean(req)} />
        </Section>
      )}
    </div>
  );
}

function DocList({ request: r, docs, kind, canAdd }) {
  // HR Officers and System Administrators get View and Download on each document.
  const { data: me } = useMe();
  const isHr = can(me, 'leave.confidential');
  const qc = useQueryClient();
  const input = useRef(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const k = KINDS[kind];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leave-request', String(r.id)] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const upload = async (file) => {
    setError(null);
    if (!file) return;
    if (!k.ok.test(file.name)) {
      setError(k.wrong);
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`The file is larger than ${MAX_MB} MB.`);
      return;
    }
    setBusy('upload');
    try {
      await api.upload(`/api/documents/requests/${r.id}${k.query}`, file);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async (id) => {
    setError(null);
    setBusy(id);
    try {
      await api.post(`/api/documents/${id}/remove`);
      refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const canRemove =
    r.can.uploadDocument &&
    ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL', 'RETURNED_FOR_CORRECTION'].includes(r.status);
  const Icon = kind === 'HANDOVER' ? FileSpreadsheet : FileText;
  const viewable = kind !== 'HANDOVER';

  return (
    <div className="space-y-3">
      {docs.length === 0 && !(r.can.uploadDocument && canAdd) && (
        <p className="muted-text">
          {kind === 'HANDOVER' ? 'No handover sheet attached.' : 'No documents attached.'}
        </p>
      )}
      {docs.length > 0 && (
        <ul className="divide-y divide-rule rounded-md border border-rule">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              {d.restricted ? (
                <Lock className="size-4 shrink-0 text-muted" aria-hidden />
              ) : (
                <Icon className="size-4 shrink-0 text-muted" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                {d.restricted ? (
                  <p>Confidential document provided (visible to HR only)</p>
                ) : (
                  <a
                    href={`/api/documents/${d.id}/download`}
                    className="block truncate font-medium text-brand hover:underline"
                  >
                    {d.name}
                  </a>
                )}
                <p className="text-xs text-muted">
                  {d.uploadedBy} · {formatDateTime(d.uploadedAt)}
                  {d.sizeBytes ? ` · ${kb(d.sizeBytes)}` : ''}
                </p>
              </div>
              {isHr && !d.restricted && (
                <div className="flex shrink-0 gap-1">
                  {viewable && (
                    <a
                      href={`/api/documents/${d.id}/download?view=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-rule bg-white px-2.5 text-sm font-medium text-ink-2 transition-colors hover:border-rule-strong hover:bg-[#fafafa]"
                    >
                      <Eye className="size-4" aria-hidden /> View
                    </a>
                  )}
                  <a
                    href={`/api/documents/${d.id}/download`}
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-rule bg-white px-2.5 text-sm font-medium text-ink-2 transition-colors hover:border-rule-strong hover:bg-[#fafafa]"
                  >
                    <Download className="size-4" aria-hidden /> Download
                  </a>
                </div>
              )}
              {canRemove && !isHr && !d.restricted && (
                <Button variant="ghost" busy={busy === d.id} onClick={() => remove(d.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {r.can.uploadDocument && canAdd && (
        <div>
          <input
            ref={input}
            id={`doc-${kind}-${r.id}`}
            type="file"
            accept={k.accept}
            className="sr-only"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button variant="secondary" busy={busy === 'upload'} onClick={() => input.current?.click()}>
            {kind === 'HANDOVER' ? 'Attach handover sheet' : 'Upload a document'}
          </Button>
          <p className="mt-1 text-xs text-muted">
            {kind === 'HANDOVER'
              ? `Excel (.xlsx), up to ${MAX_MB} MB.`
              : `PDF, JPEG or PNG, up to ${MAX_MB} MB.`}
          </p>
        </div>
      )}
    </div>
  );
}
