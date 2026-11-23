import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { PageHeader } from '../../components/ui.jsx';
import { LeaveForm } from '../../components/LeaveForm.jsx';

export default function ApplyPage() {
  const navigate = useNavigate();
  // "Apply Leave" on a leave balance opens the form with that leave type chosen (?type=).
  const [params] = useSearchParams();
  const type = params.get('type');
  const initial = useMemo(() => (/^\d+$/.test(type ?? '') ? { leaveTypeId: type } : undefined), [type]);
  const qc = useQueryClient();
  const submit = async (payload, idempotencyKey, files = []) => {
    const created = await api.post('/api/leave/requests', payload, { idempotencyKey });
    // The request exists now; a file that fails to upload can be added from the request page.
    const uploadFailed = [];
    for (const file of files) {
      try {
        await api.upload(`/api/documents/requests/${created.id}`, file);
      } catch (err) {
        uploadFailed.push(`${file.name}: ${err.message}`);
      }
    }
    const uploaded = files.length - uploadFailed.length;
    qc.invalidateQueries({ queryKey: ['my-requests'] });
    qc.invalidateQueries({ queryKey: ['balances'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    navigate(`/leave/requests/${created.id}`, {
      replace: true,
      state: { submitted: true, uploaded, uploadFailed },
    });
  };
  return (
    <div className="max-w-6xl">
      <PageHeader title="Apply For Leave" />
      <LeaveForm initial={initial} submitLabel="Submit Request" onSubmit={submit} />
    </div>
  );
}
