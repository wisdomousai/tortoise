import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { FilingPanel } from './node/filing-panel';
import { NodeEdit } from './node/node-edit';
import { blobUrl, Empty, Page, when } from './shared';

/** One node: where it sits, its accepted attributes with their source, captures, documents, filing. */
export function NodeScreen() {
  const { nodeId } = useParams({ strict: false }) as { nodeId: string };
  const node = useQuery(live.liveQueryOptions(operations.nodeGet, { id: nodeId }));
  if (node.error) return <p role="alert">{node.error.message}</p>;
  if (!node.data) return <p role="status">Loading node…</p>;
  const data = node.data;
  const attributes = Object.entries(data.attributes);
  return (
    <Page
      title={`${data.designation} ${data.name}`}
      description={
        <>
          {data.path.map((step) => (
            <span key={step.id}>
              <Link
                to="/structure/$nodeId"
                params={{ nodeId: step.id }}
                className="hover:underline"
              >
                {step.designation}
              </Link>
              {' / '}
            </span>
          ))}
          {data.label ?? 'No class label'}
          {data.retired && ' · retired'}
        </>
      }
      actions={data.assetId && <Badge variant="outline">EAM {data.assetId}</Badge>}
    >
      {!data.retired && <NodeEdit node={data} />}
      <section aria-labelledby="attributes" className="space-y-2">
        <h2 id="attributes" className="font-medium">
          Attributes
        </h2>
        {attributes.length ? (
          <dl className="grid gap-x-6 gap-y-1 rounded-xl border bg-card p-4 text-sm sm:grid-cols-[auto_1fr_auto]">
            {attributes.map(([name, attribute]) => (
              <div key={name} className="contents">
                <dt className="text-muted-foreground">{name}</dt>
                <dd className="font-medium">{attribute.value}</dd>
                <dd className="text-xs text-muted-foreground">
                  {attribute.captureId && (
                    <Link
                      to="/review/$captureId"
                      params={{ captureId: attribute.captureId }}
                      className="hover:underline"
                    >
                      from capture
                    </Link>
                  )}
                  {attribute.edited && ' · corrected by reviewer'}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <Empty>No accepted attributes. They come from reviewed captures.</Empty>
        )}
      </section>
      {attributes.length > 0 && !data.retired && <FilingPanel node={data} />}
      <section aria-labelledby="captures" className="space-y-2">
        <h2 id="captures" className="font-medium">
          Captures
        </h2>
        {data.captures.length ? (
          <ul className="divide-y rounded-xl border bg-card text-sm">
            {data.captures.map((capture) => (
              <li key={capture.id} className="flex items-center justify-between px-4 py-2">
                <Link
                  to="/review/$captureId"
                  params={{ captureId: capture.id }}
                  className="hover:underline"
                >
                  {capture.kind} · {when(capture.takenAt)}
                </Link>
                <Badge variant={capture.review === 'new' ? 'default' : 'secondary'}>
                  {capture.review}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No captures of this node yet.</Empty>
        )}
      </section>
      {data.documents.length > 0 && (
        <section aria-labelledby="documents" className="space-y-2">
          <h2 id="documents" className="font-medium">
            Documents
          </h2>
          <ul className="space-y-1 text-sm">
            {data.documents.map((document) => (
              <li key={document.id}>
                <a
                  href={blobUrl(document.file.digest)}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {document.title}
                </a>{' '}
                <span className="text-muted-foreground">{document.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Page>
  );
}
