import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { live } from '@/lib/session';
import { operations } from '../contracts';
import { blobUrl, Empty, Page, when } from './shared';

type Filter = 'new' | 'unlinked' | 'all';
const inputFor = (filter: Filter) =>
  filter === 'new' ? { review: 'new' as const } : filter === 'unlinked' ? { unlinked: true } : {};

const readingText: Record<string, string> = {
  reading: 'Reading',
  proposed: 'Proposal ready',
  accepted: 'Accepted',
  refused: 'Model refused',
};

/** The review queue: captures from the field, with where each stands. */
function ReviewQueue({ compact }: { compact: boolean }) {
  const [filter, setFilter] = useState<Filter>('new');
  const captures = useQuery(live.liveQueryOptions(operations.captureList, inputFor(filter)));
  const tree = useQuery(live.liveQueryOptions(operations.tree, {}));
  const designations = new Map((tree.data?.items ?? []).map((node) => [node.id, node.designation]));
  return (
    <Page
      title="Review"
      description={
        compact
          ? undefined
          : 'Captures from the field. Link unlinked ones, check what the model read, and accept it onto the node.'
      }
      actions={
        <NativeSelect
          aria-label="Show"
          value={filter}
          onChange={(event) => setFilter(event.target.value as Filter)}
        >
          <option value="new">To review</option>
          <option value="unlinked">Unlinked</option>
          <option value="all">All</option>
        </NativeSelect>
      }
    >
      {captures.error && <p role="alert">{captures.error.message}</p>}
      {captures.data?.items.length === 0 && <Empty>Nothing here.</Empty>}
      <ul
        aria-label="Captures"
        className={cn('grid gap-3', !compact && 'sm:grid-cols-2 lg:grid-cols-3')}
      >
        {(captures.data?.items ?? []).map((capture) => (
          <li key={capture.id}>
            <Link
              to="/review/$captureId"
              params={{ captureId: capture.id }}
              className={cn(
                'flex gap-3 rounded-xl border bg-card p-3 hover:bg-accent',
                compact && 'min-h-20 items-center',
              )}
            >
              <img
                src={blobUrl(capture.photos[0]!.digest)}
                alt=""
                className={cn(
                  'shrink-0 rounded-md bg-muted object-cover',
                  compact ? 'size-16' : 'size-20',
                )}
              />
              <span className="min-w-0 space-y-1 text-sm">
                <span className="block font-medium">
                  {capture.nodeId ? (designations.get(capture.nodeId) ?? 'Node') : 'Unlinked'} ·{' '}
                  {capture.kind}
                </span>
                <span className="block text-muted-foreground">{when(capture.takenAt)}</span>
                <span className="flex flex-wrap gap-1">
                  {capture.review !== 'new' && <Badge variant="secondary">{capture.review}</Badge>}
                  {capture.reading && (
                    <Badge variant="outline">{readingText[capture.reading]}</Badge>
                  )}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}

export const ReviewScreen = () => <ReviewQueue compact={false} />;
/** The same queue in one column with large rows, for a tablet in the field office. */
export const ReviewScreenCompact = () => <ReviewQueue compact />;
