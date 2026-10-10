import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { PageHeader } from '../../components/ui.jsx';
import { LeaveForm } from '../../components/LeaveForm.jsx';

export default function ApplyPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const submit = async (payload, idempotencyKey) => {
    const created = await api.post('/api/leave/requests', payload, { idempotencyKey });
    qc.invalidateQueries({ queryKey: ['my-requests'] });
    qc.invalidateQueries({ queryKey: ['balances'] });
    navigate(`/leave/requests/${created.id}`, { replace: true, state: { submitted: true } });
  };
  return (
    <div className="max-w-6xl">
      <PageHeader
        title="Apply for leave"
        description="Your request goes to your manager first, then to HR for final approval."
      />
      <LeaveForm submitLabel="Submit request" onSubmit={submit} />
    </div>
  );
}
