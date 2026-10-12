import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { PageHeader } from '../../components/ui.jsx';
import { LeaveForm } from '../../components/LeaveForm.jsx';

export default function ApplyPage() {
  const navigate = useNavigate();
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
    qc.invalidateQueries({ queryKey: ['my-requests'] });
    qc.invalidateQueries({ queryKey: ['balances'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    navigate(`/leave/requests/${created.id}`, {
      replace: true,
      state: { submitted: true, uploaded: files.length - uploadFailed.length, uploadFailed },
    });
  };
  return (
    <div className="max-w-6xl">
      <PageHeader title="Apply for leave" />
      <LeaveForm submitLabel="Submit request" onSubmit={submit} />
    </div>
  );
}
