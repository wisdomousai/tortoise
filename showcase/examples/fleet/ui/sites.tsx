import { useNavigate, useParams } from '@tanstack/react-router';
import { CapabilityForm } from '@/components/capability-form';
import { CollectionScreen, RecordScreen } from '@/components/collection-screen';
import { operations } from '../contracts';

/**
 * One site: its last report, its label and channel, a remote-access request to it, and its
 * removal once it is decommissioned.
 */
function SiteScreen() {
  const { id } = useParams({ strict: false }) as { id: string };
  const navigate = useNavigate();
  return (
    <div className="space-y-8">
      <RecordScreen title="Site" get={operations.siteGet} update={operations.siteUpdate} />
      <section aria-label="Remote access" className="space-y-3">
        <h2 className="text-base font-medium">Remote access</h2>
        <p className="text-sm text-muted-foreground">
          The site forwards this to its own API and adds no credential: put a session the site
          issued in the authorization header.
        </p>
        <CapabilityForm
          capability={operations.relayRequest}
          fixed={{ site: id }}
          submitLabel="Send to site"
        />
      </section>
      <section aria-label="Remove site" className="space-y-3">
        <h2 className="text-base font-medium">Remove site</h2>
        <p className="text-sm text-muted-foreground">
          For a site that was uninstalled. Revoke its device link first, or its next report adds it
          again. The audit events it forwarded stay.
        </p>
        <CapabilityForm
          capability={operations.siteRemove}
          fixed={{ id }}
          submitLabel="Remove site"
          onCommitted={() => void navigate({ to: '/sites' })}
        />
      </section>
    </div>
  );
}

export const siteRoutes = [
  {
    path: 'sites',
    component: () => (
      <CollectionScreen
        title="Sites"
        list={operations.siteList}
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
        open={(row) => `/sites/${String(row.id)}`}
      />
    ),
  },
  { path: 'sites/$id', component: SiteScreen },
];
