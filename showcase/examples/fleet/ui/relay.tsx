import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

export const relayRoutes = [
  {
    path: 'relay',
    component: () => (
      <CollectionScreen
        title="Remote access"
        list={operations.relayList}
        columns={['site', 'method', 'path', 'status', 'response', 'requestedAt']}
        open={(row) => `/relay/${String(row.id)}`}
      />
    ),
  },
  {
    path: 'relay/$id',
    component: () => <RecordScreen title="Relay request" get={operations.relayGet} />,
  },
];
