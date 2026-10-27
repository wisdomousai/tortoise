import type { ComponentType } from 'react';
import { FlaskConical } from 'lucide-react';
import { useParams } from '@tanstack/react-router';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { requestOperations } from '../contracts';

/** A panel an application adds below one test request, such as publishing or a suggested method. */
export type RequestSection = ComponentType<{ id: string }>;

function RequestScreen({ sections }: { sections: readonly RequestSection[] }) {
  const { id } = useParams({ strict: false }) as { id: string };
  return (
    <div className="space-y-8">
      <RecordScreen
        title="Test request"
        get={requestOperations.requestGet}
        update={requestOperations.requestUpdate}
      />
      {sections.map((Section, index) => (
        <Section key={index} id={id} />
      ))}
    </div>
  );
}

/**
 * The test request list and the test request screen. An application that composes the lab
 * requests module spreads these into its own screens and passes `sections` to add panels to the
 * request screen.
 */
export function requestRoutes(options: { sections?: readonly RequestSection[] } = {}) {
  const sections = options.sections ?? [];
  return [
    {
      path: 'requests',
      component: () => (
        <CollectionScreen
          title="Test requests"
          list={requestOperations.requestList}
          create={requestOperations.requestSubmit}
          columns={['specimen', 'method', 'requester']}
          open={(row) => `/requests/${String(row.id)}`}
        />
      ),
    },
    { path: 'requests/$id', component: () => <RequestScreen sections={sections} /> },
  ];
}

export const requestNavigation = [{ to: '/requests', label: 'Test requests', icon: FlaskConical }];
export const requestCapabilityScreens = [{ prefix: 'test-request.', to: '/requests' }];
