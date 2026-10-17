import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

export const auditRoutes = [
  {
    path: 'audit',
    component: () => (
      <CollectionScreen
        title="Audit events"
        list={operations.auditEventList}
        columns={['site', 'seq', 'kind', 'at']}
        open={(row) => `/audit/${encodeURIComponent(String(row.id))}`}
      />
    ),
  },
  {
    path: 'audit/$id',
    component: () => <RecordScreen title="Audit event" get={operations.auditEventGet} />,
  },
];
