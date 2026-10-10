import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FileText, Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { formatDateTime } from '../lib/format.js';
import { Button, Notice, Section } from './ui.jsx';

const MAX_MB = 5;
const kb = (n) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

/** Supporting documents on a request. The server decides who sees what; this only shows it. */
export default function DocumentsPanel({ request: r }) {
  const qc = useQueryClient();
  const input = useRef(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const req = r.documentRequirement;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['leave-request', String(r.id)] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const upload = async (file) => {
    setError(null);
    if (!file) return;
    if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
      setError('Only PDF, JPEG and PNG files can be uploaded.');
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`The file is larger than ${MAX_MB} MB.`);
      return;
    }
    setBusy('upload');
    try {
      await api.upload(`/api/documents/requests/${r.id}`, file);
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

  if (!r.documents.length && !req && !r.can.uploadDocument) return null;
  const canRemove =
    r.can.uploadDocument &&
    ['PENDING_MANAGER_APPROVAL', 'PENDING_HR_APPROVAL', 'RETURNED_FOR_CORRECTION'].includes(r.status);

  return (
    <Section
      title="Supporting documents"
      description={req ? `Required: ${req.description ?? 'a supporting document'}.` : undefined}
    >
      <div className="space-y-3">
        {req && !req.provided && <Notice tone="pending">No document has been provided yet.</Notice>}
        {r.documents.length > 0 && (
          <ul className="divide-y divide-rule rounded-md border border-rule">
            {r.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                {d.restricted ? (
                  <Lock className="size-4 shrink-0 text-muted" aria-hidden />
                ) : (
                  <FileText className="size-4 shrink-0 text-muted" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  {d.restricted ? (
                    <p>Medical document provided (visible to HR only)</p>
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
                {canRemove && !d.restricted && (
                  <Button variant="ghost" busy={busy === d.id} onClick={() => remove(d.id)}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {r.can.uploadDocument && (
          <div>
            <input
              ref={input}
              id={`doc-${r.id}`}
              type="file"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              className="sr-only"
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <Button variant="secondary" busy={busy === 'upload'} onClick={() => input.current?.click()}>
              Upload a document
            </Button>
            <p className="mt-1 text-xs text-muted">PDF, JPEG or PNG, up to {MAX_MB} MB.</p>
          </div>
        )}
      </div>
    </Section>
  );
}
