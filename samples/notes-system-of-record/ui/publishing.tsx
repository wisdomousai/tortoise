import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CollectionScreen } from '@/components/collection-screen';
import { ReconciliationReview } from '@/components/reconciliation-review';
import { client, live } from '@/lib/session';
import { publishingOperations, type Publication } from '../contracts';

/** Added below the base sample's note screen: where this note's publication stands. */
export function PublishSection({ id }: { id: string }) {
  const query = useQuery({
    ...live.liveQueryOptions(publishingOperations.publicationGet, { id } as never),
    retry: false,
  });
  const publication = query.error ? undefined : (query.data as Publication | undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const publish = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await client.command(publishingOperations.publicationPublish, { id } as never);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Publishing" className="space-y-3">
      <h2 className="text-base font-medium">Publishing</h2>
      {publication ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={publication.sync === 'rejected' ? 'destructive' : 'secondary'}>
            {publication.sync}
          </Badge>
          {publication.sorRef && <span>Publisher id {publication.sorRef}</span>}
          {publication.rejection && <span>{publication.rejection.message}</span>}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Not published.</p>
      )}
      <Button
        variant="outline"
        disabled={busy || publication?.sync === 'pending'}
        onClick={() => void publish()}
      >
        {publication ? 'Publish again' : 'Publish'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ReconciliationReview
        title="Held publication"
        list={publishingOperations.reconciliationList}
        resolve={publishingOperations.reconciliationResolve}
        resource={`publication:${id}`}
      />
    </section>
  );
}

const clock = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Delivery counts and when the change feed last ran. */
function PublisherStatus() {
  const { data } = useQuery(live.liveQueryOptions(publishingOperations.publisherStatus, {}));
  if (!data) return null;
  return (
    <section
      aria-label="Delivery"
      className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-card px-5 py-3.5 text-sm"
    >
      <span>
        <strong className="tabular-nums">{data.pending}</strong> pending
      </span>
      <span>
        <strong className="tabular-nums">{data.accepted}</strong> accepted
      </span>
      <span>
        <strong className="tabular-nums">{data.rejected}</strong> rejected
      </span>
      <span className="text-muted-foreground sm:ml-auto">
        {data.lastSyncAt !== undefined
          ? `Site notes synced ${clock(data.lastSyncAt)}`
          : 'Site notes not synced yet'}
      </span>
    </section>
  );
}

/** Delivery status, every publication, and every held one waiting for a person. */
export function Publications() {
  return (
    <div className="space-y-8">
      <PublisherStatus />
      <CollectionScreen
        title="Publications"
        list={publishingOperations.publicationList}
        open={(row) => `/notes/${String(row.id)}`}
      />
      <ReconciliationReview
        title="Held publications"
        list={publishingOperations.reconciliationList}
        resolve={publishingOperations.reconciliationResolve}
        target="publisher"
      />
    </div>
  );
}
