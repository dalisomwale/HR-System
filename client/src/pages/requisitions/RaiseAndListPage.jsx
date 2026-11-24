import { Loading, PageHeader } from '../../components/ui.jsx';
import RaisePage from './RaisePage.jsx';
import RequisitionsListPage from './RequisitionsListPage.jsx';
import { useRq } from './rq.js';

/*
 * Requisitions in one place (D139). Someone who can raise a requisition gets the raise form
 * first, then every requisition they take part in. Those who only quote for, approve, pay or
 * receive requisitions (directors, Accounts, IT, Stores) see the list on its own.
 */
export default function RaiseAndListPage() {
  const rq = useRq();
  if (rq.isPending) return <Loading />;
  if (!rq.data?.canRaise) return <RequisitionsListPage />;
  return (
    <div className="stack">
      <PageHeader
        title="Raise A Requisition"
        description="Ask for something to be bought for your department. Your requisitions and those waiting for you are below."
      />
      <RaisePage embedded />
      <RequisitionsListPage embedded />
    </div>
  );
}
