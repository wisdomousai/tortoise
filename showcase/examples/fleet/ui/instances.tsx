import { useNavigate, useParams } from '@tanstack/react-router';
import { CapabilityForm } from '@/components/capability-form';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

/**
 * One instance: its last report, its label and channel, a remote-access request to it, and its
 * removal once it is decommissioned.
 */
function InstanceScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  return (
    <div className="space-y-8">
      <RecordScreen
        title="Instance"
        get={operations.instanceGet}
        update={operations.instanceUpdate}
      />
      <section aria-label="Remote access" className="space-y-3">
        <h2 className="text-base font-medium">Remote access</h2>
        <p className="text-sm text-muted-foreground">
          The instance forwards this to its own API and adds no credential: put a session the
          instance issued in the authorization header.
        </p>
        <CapabilityForm
          capability={operations.relayRequest}
          fixed={{ instance: id }}
          submitLabel="Send to instance"
        />
      </section>
      <section aria-label="Remove instance" className="space-y-3">
        <h2 className="text-base font-medium">Remove instance</h2>
        <p className="text-sm text-muted-foreground">
          For an instance that was uninstalled. Revoke its device link first, or its next report
          adds it again. The audit events it forwarded stay.
        </p>
        <CapabilityForm
          capability={operations.instanceRemove}
          fixed={{ id }}
          submitLabel="Remove instance"
          onCommitted={() => void navigate({ to: '/instances' })}
        />
      </section>
    </div>
  );
}

export const instanceRoutes = [
  {
    path: 'instances',
    component: () => (
      <CollectionScreen
        title="Instances"
        list={operations.instanceList}
        columns={[
          'id',
          'label',
          'application',
          'channel',
          'staged',
          'lastSeenAt',
          'pending',
          'held',
          'bestBefore',
        ]}
        open={(row) => `/instances/${String(row.id)}`}
      />
    ),
  },
  { path: 'instances/$id', component: InstanceScreen },
];
