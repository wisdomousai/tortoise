import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

export const releaseRoutes = [
  {
    path: 'releases',
    component: () => (
      <CollectionScreen
        title="Releases"
        list={operations.releaseList}
        columns={['id', 'version', 'application', 'platform', 'files', 'publishedAt']}
        open={(row) => `/releases/${String(row.id)}`}
      />
    ),
  },
  {
    path: 'releases/$id',
    component: () => <RecordScreen title="Release" get={operations.releaseGet} />,
  },
  {
    path: 'channels',
    component: () => (
      <CollectionScreen
        title="Channels"
        list={operations.channelList}
        create={operations.channelAssign}
        columns={['id', 'release', 'assignedAt', 'assignedBy']}
      />
    ),
  },
];
