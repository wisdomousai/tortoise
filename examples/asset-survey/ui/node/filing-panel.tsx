import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@agent-native/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { live, transport } from '@/lib/session';
import { eamAssets, operations } from '../../contracts';
import { ErrorText, quietly, when } from '../shared';

/**
 * File a node into the EAM. The search is live: a match is updated with its asset ID, and a new
 * asset is created only when nothing matches. A node already filed updates its own asset.
 */
export function FilingPanel({
  node,
}: {
  node: {
    id: string;
    designation: string;
    assetId?: string;
    attributes: Record<string, { value: string }>;
  };
}) {
  const [q, setQ] = useState(node.attributes.serial?.value ?? node.designation);
  const search = useQuery(live.remoteQueryOptions(eamAssets.search, { q }));
  const filings = useQuery(live.liveQueryOptions(operations.filingList, { nodeId: node.id }));
  const file = useCommand(transport, operations.filingFile);
  const pending = filings.data?.items.some((filing) => filing.sync === 'pending');
  const unavailable = search.data?.source.status === 'unavailable';
  return (
    <section aria-labelledby="filing" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 id="filing" className="font-medium">
        Filing in the EAM
      </h2>
      {node.assetId ? (
        <Button
          disabled={file.pending || pending}
          onClick={() => void quietly(file.execute({ nodeId: node.id }))}
        >
          Update {node.assetId}
        </Button>
      ) : (
        <>
          <Input
            aria-label="Search the EAM"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          {unavailable && (
            <p role="alert" className="text-sm text-amber-700">
              The EAM is not answering. File once it is back, so no duplicate asset is created.
            </p>
          )}
          <ul aria-label="EAM matches" className="divide-y text-sm">
            {(search.data?.items ?? []).map((asset) => (
              <li
                key={asset.externalId}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span>
                  <span className="font-mono">{asset.externalId}</span> {asset.designation} ·{' '}
                  {asset.name}
                  {asset.serial && (
                    <span className="text-muted-foreground"> · serial {asset.serial}</span>
                  )}
                  {asset.nodeId && (
                    <span className="text-muted-foreground"> · already filed from the survey</span>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={file.pending || pending}
                  onClick={() =>
                    void quietly(file.execute({ nodeId: node.id, assetId: asset.externalId }))
                  }
                >
                  Update {asset.externalId}
                </Button>
              </li>
            ))}
          </ul>
          {search.data && !unavailable && (
            <Button
              disabled={file.pending || pending}
              onClick={() => void quietly(file.execute({ nodeId: node.id }))}
            >
              {search.data.items.length ? 'None of these: create an asset' : 'Create an asset'}
            </Button>
          )}
        </>
      )}
      <ErrorText error={file.error} />
      <ul aria-label="Filings" className="space-y-1 text-sm">
        {(filings.data?.items ?? []).map((filing) => (
          <li key={filing.id} className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                filing.sync === 'rejected'
                  ? 'destructive'
                  : filing.sync === 'accepted'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {filing.sync === 'accepted'
                ? `Filed as ${filing.sorRef}`
                : filing.sync === 'rejected'
                  ? 'Refused'
                  : 'Sending to the EAM'}
            </Badge>
            <span className="text-muted-foreground">
              {when(filing.filedAt)}
              {filing.rejection && ` · ${filing.rejection.message}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
