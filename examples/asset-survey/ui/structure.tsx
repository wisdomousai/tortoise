import { useQuery } from '@tanstack/react-query';
import { approvalOperations } from '@agent-native/contracts';
import { ApprovalReview } from '@/components/approval-review';
import { CollectionTree } from '@/components/collection-tree';
import { Badge } from '@/components/ui/badge';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { NodeForm } from './structure/node-form';

type Row = { depth: number } & Record<string, unknown>;

/** What a node has gathered: accepted attributes and the EAM asset it was filed as. */
function NodeBadges({ row }: { row: Row }) {
  const attributes = Object.keys((row.attributes as object | undefined) ?? {}).length;
  const retired = row.assetStatus === 'retired';
  return (
    <>
      {row.label ? (
        <span className="text-xs text-muted-foreground">{String(row.label)}</span>
      ) : null}
      <span className="text-sm">{String(row.name)}</span>
      {attributes > 0 && <Badge variant="secondary">{attributes} attributes</Badge>}
      {row.assetId ? (
        <Badge variant={retired ? 'destructive' : 'outline'}>
          {String(row.assetId)}
          {retired ? ' retired in EAM' : ''}
        </Badge>
      ) : null}
    </>
  );
}

/**
 * The site structure depth first, the form that adds a node, and the node creations an agent
 * requested from a schematic or plan, each waiting for a manager.
 */
export function StructureScreen() {
  const tree = useQuery(live.liveQueryOptions(operations.tree, {}));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CollectionTree
        title="Structure"
        tree={operations.tree}
        open={(row) => `/structure/${String(row.id)}`}
        aside={(row) => <NodeBadges row={row} />}
        empty="No nodes yet. Add the plant or a first bay below."
      />
      <NodeForm parents={tree.data?.items ?? []} />
      <ApprovalReview
        title="Requested nodes"
        list={approvalOperations.approvalList}
        approve={approvalOperations.approvalApprove}
        reject={approvalOperations.approvalReject}
        describe={(approval) =>
          `${String(approval.input.designation ?? '')} ${String(approval.input.name ?? '')}`.trim()
        }
      />
    </div>
  );
}
