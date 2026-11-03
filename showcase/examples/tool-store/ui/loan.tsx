import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

/** Loans are read-only here: `tool.check-out` and `tool.return` on the tool screen write them. */
export const loanRoutes = [
  {
    path: 'loans',
    component: () => (
      <CollectionScreen
        title="Loans"
        list={operations.loanList}
        open={(row) => `/loans/${String(row.id)}`}
      />
    ),
  },
  {
    path: 'loans/$id',
    component: () => <RecordScreen title="Loan" get={operations.loanGet} />,
  },
];
