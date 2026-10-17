import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useCommand } from '@agent-native/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { live, transport } from '@/lib/session';
import { operations } from '../contracts';
import { NodeForm } from './structure/node-form';
import { Empty, ErrorText, Page, quietly } from './shared';

/** The site structure depth first, with proposed nodes waiting for a manager. */
export function StructureScreen() {
  const tree = useQuery(live.liveQueryOptions(operations.tree, {}));
  const accept = useCommand(transport, operations.nodeAccept);
  const nodes = tree.data?.nodes ?? [];
  return (
    <Page
      title="Structure"
      description="Reference designations of the site (IEC 81346, KKS, ANSI device numbers). Field assignments cover subtrees of it."
    >
      <NodeForm parents={nodes.filter((node) => node.source !== 'proposed')} />
      <ErrorText error={tree.error?.message ?? accept.error} />
      {nodes.length ? (
        <ul aria-label="Structure" className="divide-y rounded-xl border bg-card">
          {nodes.map((node) => (
            <li
              key={node.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 pr-3"
              style={{ paddingLeft: `${0.75 + node.depth * 1.25}rem` }}
            >
              <div className="min-w-0">
                <Link
                  to="/structure/$nodeId"
                  params={{ nodeId: node.id }}
                  className="font-mono text-sm font-medium hover:underline"
                >
                  {node.designation}
                </Link>
                <span className="ml-2 text-sm">{node.name}</span>
                {node.label && (
                  <span className="ml-2 text-xs text-muted-foreground">{node.label}</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {Object.keys(node.attributes).length > 0 && (
                  <Badge variant="secondary">
                    {Object.keys(node.attributes).length} attributes
                  </Badge>
                )}
                {node.assetId && (
                  <Badge variant={node.assetStatus === 'retired' ? 'destructive' : 'outline'}>
                    {node.assetId}
                    {node.assetStatus === 'retired' ? ' retired in EAM' : ''}
                  </Badge>
                )}
                {node.source === 'proposed' && (
                  <>
                    <Badge variant="outline">Proposed</Badge>
                    <Button
                      size="sm"
                      disabled={accept.pending}
                      onClick={() => quietly(accept.execute({ id: node.id }))}
                    >
                      Accept {node.designation}
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        tree.data && <Empty>No nodes yet. Add the plant or a first bay above.</Empty>
      )}
    </Page>
  );
}
