import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, newActionKey, qs } from '../../lib/api.js';
import { formatDateTime } from '../../lib/format.js';
import {
  Button,
  Field,
  Input,
  LoadError,
  Loading,
  Section,
  Select,
  Table,
  Td,
  Th,
  applyServerErrors,
} from '../../components/ui.jsx';
import { BalanceCards } from '../leave/MyLeavePage.jsx';

const thisYear = new Date().getFullYear();
const ENTRY_LABELS = {
  OPENING: 'Opening balance',
  ACCRUAL: 'Accrual',
  ENTITLEMENT: 'Entitlement',
  DEDUCTION: 'Leave taken',
  REVERSAL: 'Returned',
  ADJUSTMENT: 'Adjustment',
  CARRY_FORWARD_IN: 'Carried forward',
  CARRY_FORWARD_OUT: 'Carried out',
  CARRY_FORWARD_EXPIRY: 'Carry-forward expired',
};

/** HR Officer view of one employee's balances, ledger and adjustments. */
export default function EmployeeBalances({ employeeId }) {
  const [year, setYear] = useState(thisYear);
  const q = useQuery({
    queryKey: ['hr-balances', String(employeeId), year],
    queryFn: () => api.get(`/api/hr/employees/${employeeId}/balances${qs({ year })}`),
  });
  return (
    <Section
      title="Leave balances"
      description="Every change is a ledger entry with a reason; entries are never edited or deleted."
      actions={
        <Select
          aria-label="Year"
          className="w-28"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      }
    >
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div className="space-y-6">
          <BalanceCards items={q.data.items} />
          <AdjustmentForm
            employeeId={employeeId}
            year={year}
            types={q.data.items.filter((b) => b.kind === 'BALANCE').map((b) => b.leaveType)}
          />
          <div>
            <h3 className="mb-2 text-sm font-semibold">Ledger {year}</h3>
            {q.data.ledger.length === 0 ? (
              <p className="text-sm text-muted">No entries for {year}.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Leave type</Th>
                    <Th>Entry</Th>
                    <Th className="text-right">Days</Th>
                    <Th>Reason</Th>
                    <Th>By</Th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.ledger.map((l) => (
                    <tr key={l.id}>
                      <Td>{formatDateTime(l.at)}</Td>
                      <Td>{l.leaveType}</Td>
                      <Td>{ENTRY_LABELS[l.entryType] ?? l.entryType}</Td>
                      <Td className={`text-right ${l.amount < 0 ? 'text-danger' : ''}`}>
                        {l.amount > 0 ? `+${l.amount}` : l.amount}
                      </Td>
                      <Td>{l.reason}</Td>
                      <Td>{l.by}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function AdjustmentForm({ employeeId, year, types }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState(null);
  const [key, setKey] = useState(newActionKey);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: { leaveTypeId: types[0]?.id ?? '', kind: 'OPENING', amount: '', reason: '' },
  });
  if (!types.length) return null;

  const onSubmit = async (v) => {
    setMessage(null);
    try {
      await api.post(
        '/api/hr/balances',
        {
          employeeId,
          year,
          leaveTypeId: Number(v.leaveTypeId),
          kind: v.kind,
          amount: Number(v.amount),
          reason: v.reason,
        },
        { idempotencyKey: key },
      );
      setKey(newActionKey());
      reset({ ...v, amount: '', reason: '' });
      setMessage({ tone: 'ok', text: 'Recorded.' });
      qc.invalidateQueries({ queryKey: ['hr-balances', String(employeeId)] });
    } catch (err) {
      setKey(newActionKey());
      const left = applyServerErrors(err, setError, ['leaveTypeId', 'kind', 'amount', 'reason']);
      if (left) setMessage({ tone: 'danger', text: left });
    }
  };
  const err = (f) => errors[f]?.message;
  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="grid gap-3 rounded-md bg-canvas p-3 sm:grid-cols-4"
    >
      <p className="text-sm font-medium sm:col-span-4">Record an opening balance or adjustment for {year}</p>
      <Field id="adj-type" label="Leave type">
        <Select id="adj-type" {...register('leaveTypeId')}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="adj-kind" label="Kind">
        <Select id="adj-kind" {...register('kind')}>
          <option value="OPENING">Opening balance</option>
          <option value="ADJUSTMENT">Adjustment</option>
        </Select>
      </Field>
      <Field id="adj-amount" label="Days" error={err('amount')} hint="Negative to reduce.">
        <Input
          id="adj-amount"
          inputMode="decimal"
          invalid={!!err('amount')}
          {...register('amount', { required: 'Required' })}
        />
      </Field>
      <Field id="adj-reason" label="Reason" error={err('reason')}>
        <Input id="adj-reason" invalid={!!err('reason')} {...register('reason', { required: 'Required' })} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-4">
        <Button type="submit" busy={isSubmitting}>
          Record
        </Button>
        {message && (
          <span className={message.tone === 'ok' ? 'text-sm text-ok' : 'text-sm text-danger'}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}
