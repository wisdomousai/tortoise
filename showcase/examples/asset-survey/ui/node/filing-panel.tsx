import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCommand } from '@tortoise/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { live, transport } from '@/lib/session';
import { eamAssets, operations } from '../../contracts';
import { ErrorText, filingLabel, quietly, when } from '../shared';

/**
 * File a node into the EAM or export it to the site's export directory. The EAM search is live:
 * a match is updated with its asset ID, and a new asset is created only when nothing matches. A
 * node already filed updates its own asset. The export is independent of the EAM.
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
  const exportNode = useCommand(transport, operations.filingExport);
  const withdraw = useCommand(transport, operations.filingWithdraw);
  const waiting = (target: string) =>
    filings.data?.items.some((filing) => filing.target === target && filing.sync === 'pending');
  const pending = waiting('eam');
  const unavailable = search.data?.source.status === 'unavailable';
  return (
    <section aria-labelledby="filing" className="space-y-3 rounded-xl border bg-card p-4">
      <h2 id="filing" className="font-medium">
        Filing
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
              The EAM is not responding. File once it is back, so no duplicate asset is created.
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
      <Button
        variant="outline"
        disabled={exportNode.pending || waiting('export')}
        onClick={() => void quietly(exportNode.execute({ nodeId: node.id }))}
      >
        Export to the export directory
      </Button>
      <ErrorText error={exportNode.error} />
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
              {filingLabel(filing)}
            </Badge>
            <span className="text-muted-foreground">
              {filing.withdraws ? 'withdrawal · ' : ''}
              {when(filing.filedAt)}
              {filing.rejection && ` · ${filing.rejection.message}`}
            </span>
            {filing.target === 'eam' &&
              filing.sync === 'accepted' &&
              !filing.withdraws &&
              !filing.withdrawnBy && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={withdraw.pending}
                  onClick={() => void quietly(withdraw.execute({ id: filing.id }))}
                >
                  Withdraw from the EAM
                </Button>
              )}
          </li>
        ))}
      </ul>
      <ErrorText error={withdraw.error} />
    </section>
  );
}
