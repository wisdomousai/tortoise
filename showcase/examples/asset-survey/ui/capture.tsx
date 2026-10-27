import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useCommand } from '@agent-native/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { live, transport } from '@/lib/session';
import { operations } from '../contracts';
import { LinkOrDiscard } from './capture/link-or-discard';
import { ProposalForm } from './capture/proposal-form';
import { ValuesForm } from './capture/values-form';
import { blobUrl, ErrorText, Page, quietly, when } from './shared';

type Region = { x: number; y: number; width: number; height: number };

/** One capture: its photos beside what the model read, for a person to check and accept. */
export function CaptureScreen() {
  const { captureId } = useParams({ strict: false }) as { captureId: string };
  const capture = useQuery(live.liveQueryOptions(operations.captureGet, { id: captureId }));
  const request = useCommand(transport, operations.extractionCreate);
  const [highlight, setHighlight] = useState<{ digest: string; region?: Region }>();
  if (capture.error) return <p role="alert">{capture.error.message}</p>;
  if (!capture.data) return <p role="status">Loading capture…</p>;
  const data = capture.data;
  const extraction = data.extraction;
  const open = data.review === 'new';
  return (
    <Page
      title={`${data.kind} ${data.node ? `of ${data.node.designation}` : '(unlinked)'}`}
      description={
        <>
          Taken {when(data.takenAt)}{' '}
          {data.reportedBy.startsWith('device:')
            ? `on device ${data.reportedBy.slice('device:'.length)}`
            : `by ${data.reportedBy}`}
          {data.condition && ` · condition ${data.condition}`}
          {data.codes.length > 0 && ` · scanned ${data.codes.join(', ')}`}
          {data.node && (
            <>
              {' · '}
              <Link
                to="/structure/$nodeId"
                params={{ nodeId: data.node.id }}
                className="hover:underline"
              >
                {data.node.name}
              </Link>
            </>
          )}
        </>
      }
      actions={<Badge variant={open ? 'default' : 'secondary'}>{data.review}</Badge>}
    >
      {data.note && <p className="text-sm whitespace-pre-wrap">{data.note}</p>}
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-3">
          {data.photos.map((photo) => (
            <figure
              key={photo.digest}
              className="relative overflow-hidden rounded-xl border bg-muted"
            >
              <img
                src={blobUrl(photo.digest)}
                alt={`Photo of the ${data.kind}`}
                className="w-full"
              />
              {highlight?.digest === photo.digest && highlight.region && (
                <span
                  aria-hidden
                  className="absolute rounded-sm ring-2 ring-amber-400"
                  style={{
                    left: `${highlight.region.x * 100}%`,
                    top: `${highlight.region.y * 100}%`,
                    width: `${highlight.region.width * 100}%`,
                    height: `${highlight.region.height * 100}%`,
                  }}
                />
              )}
            </figure>
          ))}
        </div>
        <div className="space-y-4">
          {open && <LinkOrDiscard captureId={data.id} linked={data.node !== undefined} />}
          {extraction?.status === 'proposed' && extraction.reportId && open && data.node ? (
            <ProposalForm
              reportId={extraction.reportId}
              fields={extraction.fields}
              onFocusField={(field) =>
                setHighlight(
                  field && {
                    digest: field.source.digest,
                    ...(field.source.region ? { region: field.source.region } : {}),
                  },
                )
              }
            />
          ) : (
            <section
              aria-label="Extraction"
              className="space-y-2 rounded-xl border bg-card p-4 text-sm"
            >
              <p>
                {!extraction
                  ? 'Not read yet.'
                  : extraction.status === 'reading'
                    ? extraction.assignee === 'target:model'
                      ? 'The model is reading the photos.'
                      : `Sent to ${extraction.assignee} to read.`
                    : extraction.status === 'refused'
                      ? `The model could not read it: ${extraction.rejection?.message}`
                      : extraction.status === 'accepted'
                        ? `Accepted by ${data.reviewedBy}.`
                        : 'Link the capture to a node to accept the proposal.'}
              </p>
              {open && extraction?.status !== 'reading' && (
                <Button
                  variant="outline"
                  disabled={request.pending}
                  onClick={() =>
                    void quietly(
                      request.execute({
                        title: `Read ${data.kind}${data.node ? ` on ${data.node.designation}` : ''}`,
                        scope: { reportId: data.id },
                        assignee: { type: 'target', id: 'model' },
                      }),
                    )
                  }
                >
                  {extraction ? 'Read again' : 'Read with the model'}
                </Button>
              )}
              {extraction?.reportId && (
                <Link
                  to="/review/readings/$reportId"
                  params={{ reportId: extraction.reportId }}
                  className="block text-primary hover:underline"
                >
                  What was read
                </Link>
              )}
              <ErrorText error={request.error} />
            </section>
          )}
          {open && data.node && extraction?.status !== 'proposed' && (
            <ValuesForm captureId={data.id} />
          )}
        </div>
      </div>
    </Page>
  );
}
