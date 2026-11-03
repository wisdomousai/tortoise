import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AssistantConversation } from './assistant-session';
import { recordLabel } from './screen-records';

/**
 * The line under the panel's title with what the next run sees of the current screen: the first
 * record's label, how many more there are, and the control that leaves them out of the next run
 * or includes them again. A screen that publishes no record shows no line.
 */
export function ContextLine({ screen }: { screen: AssistantConversation['screen'] }) {
  const [first, ...more] = screen.records;
  if (!first) return null;
  const labels = screen.records.map(recordLabel);
  return (
    <div
      role="group"
      aria-label="What the next run sees"
      className="flex h-8 items-center gap-1.5 border-t px-3 text-xs"
    >
      <span className="shrink-0 text-muted-foreground">
        {screen.included ? 'Sees' : 'Left out'}
      </span>
      <span
        title={labels.join('\n')}
        className={cn(
          'min-w-0 truncate font-medium',
          !screen.included && 'text-muted-foreground line-through',
        )}
      >
        {labels[0]}
      </span>
      {more.length > 0 && (
        <span title={labels.join('\n')} className="shrink-0 text-muted-foreground tabular">
          +{more.length}
        </span>
      )}
      {screen.included ? (
        <Button
          size="icon-xs"
          variant="ghost"
          className="ml-auto"
          aria-label="Leave out of the next run"
          title="Leave out of the next run"
          onClick={screen.leaveOut}
        >
          <X aria-hidden />
        </Button>
      ) : (
        <Button size="xs" variant="ghost" className="ml-auto" onClick={screen.include}>
          Include
        </Button>
      )}
    </div>
  );
}

/**
 * The requests the current screen suggests, above the composer. A request fills the composer, so
 * the person can change it, such as the percent of a discount, before Enter sends it.
 */
export function ScreenRequests({
  requests,
  onPick,
}: {
  requests: readonly string[];
  onPick: (request: string) => void;
}) {
  if (!requests.length) return null;
  return (
    <ul aria-label="Requests from the screen" className="flex flex-wrap gap-1">
      {requests.map((request) => (
        <li key={request} className="max-w-full min-w-0">
          <button
            type="button"
            title={request}
            className="max-w-full truncate rounded-full border px-2 py-0.5 text-left text-xs hover:bg-muted"
            onClick={() => onPick(request)}
          >
            {request}
          </button>
        </li>
      ))}
    </ul>
  );
}
