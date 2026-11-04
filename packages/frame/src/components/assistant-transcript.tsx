import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { AppWindow, Check, Loader2, Search, SquarePen } from 'lucide-react';
import type { CatalogOperation } from '@tortoise/contracts';
import { resourcePath } from '@tortoise/frame/screens';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AssistantConversation } from '@/lib/assistant-conversation';
import {
  approvalRequestOf,
  runEnded,
  runItems,
  type CallItem,
  type PanelRun,
  type RequestItem,
} from '@/lib/assistant-run';
import { formatDate } from '@/lib/fields';
import { transport } from '@/lib/session';
import { cn } from '@/lib/utils';
import { useScreens } from '@/screens-context';

const linkClass =
  'font-mono font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary';

/** The catalog the host serves this session, shared with the command palette's query. */
function useCatalogOperation(id: string): CatalogOperation | undefined {
  const catalog = useQuery({
    queryKey: ['contract'],
    queryFn: () => transport.catalog(),
    staleTime: Infinity,
  });
  return catalog.data?.operations.find((operation) => operation.id === id);
}

/** `<kind>:<id>` linked to the screen `screens.resources` names for its kind, or plain text. */
export function ResourceLink({ resource, children }: { resource: string; children?: ReactNode }) {
  const screens = useScreens();
  const path = useQuery({
    queryKey: ['resource-path', resource],
    queryFn: () => resourcePath(screens, resource),
    retry: false,
    staleTime: Infinity,
  });
  const at = resource.indexOf(':');
  const label = children ?? `${resource.slice(0, at)} ${resource.slice(at + 1, at + 9)}`;
  if (!path.data) return <span className="font-mono text-muted-foreground">{label}</span>;
  return (
    <Link to={path.data} className={cn(linkClass, 'max-w-40 truncate')}>
      {label}
    </Link>
  );
}

const uiCalls: Record<string, string> = {
  'ui.open': 'Open a screen',
  'ui.select': 'Select a record',
  'ui.prepare': 'Fill a form',
  'ui.request-review': 'Ask for a review',
};

/**
 * One call as a chip: the capability's title, an icon for a query, a command or a screen intent,
 * a spinner while it runs, a check once it finished and the refusal code when the host refused
 * it. A command's chip links each record it changed.
 */
function CallChip({ call }: { call: CallItem }) {
  const operation = useCatalogOperation(call.operation);
  const ui = uiCalls[call.operation];
  const Kind = ui ? AppWindow : operation?.kind === 'command' ? SquarePen : Search;
  return (
    <li
      className={cn(
        'flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border bg-background px-2 py-1 text-xs',
        call.state === 'refused' && 'border-destructive/40',
      )}
    >
      <Kind
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-label={ui ? 'Screen' : operation?.kind === 'command' ? 'Command' : 'Query'}
      />
      <span className="font-medium" title={call.operation}>
        {ui ?? operation?.display?.label ?? call.operation}
      </span>
      {call.state === 'running' ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Running" />
      ) : call.state === 'refused' ? (
        <span className="font-mono font-medium text-destructive">{call.code}</span>
      ) : (
        <Check className="size-3.5 text-success" aria-label="Done" />
      )}
      {call.resources.map((resource) => (
        <ResourceLink key={resource} resource={resource} />
      ))}
    </li>
  );
}

/** An approval request the agent recorded; a person decides it on the screen it links to. */
function ApprovalRequestCard({ resource }: { resource: string }) {
  return (
    <section
      aria-label="Approval request"
      className="space-y-1 rounded-lg border border-warning/60 bg-card px-3 py-2 text-[0.8rem]"
    >
      <p className="font-medium">The agent asked for approval.</p>
      <p className="text-muted-foreground">
        A person with the right role approves or rejects it:{' '}
        <ResourceLink resource={resource}>open the approval request</ResourceLink>
      </p>
    </section>
  );
}

/**
 * A question or an approval the run asks the person: a button per offered choice or a text field
 * for a question, Approve and Decline for an approval. Once answered, or once the run stopped
 * waiting, it shows what was asked and the answer.
 */
function RequestCard({
  item,
  onAnswer,
}: {
  item: RequestItem;
  onAnswer: (value: string | boolean) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const respond = async (value: string | boolean) => {
    setPending(true);
    try {
      await onAnswer(value);
    } finally {
      setPending(false);
    }
  };
  const given =
    item.approved !== undefined ? (item.approved ? 'Approved' : 'Declined') : item.answer;
  return (
    <section
      aria-label={item.kind === 'approval' ? 'Approval' : 'Question'}
      className={cn(
        'space-y-2 rounded-lg border px-3 py-2 text-[0.8rem]',
        item.open ? 'border-primary/40 bg-card' : 'bg-muted/40 text-muted-foreground',
      )}
    >
      <p className="whitespace-pre-wrap">{item.message}</p>
      {given !== undefined ? (
        <p>
          Answer: <span className="font-medium text-foreground">{given}</span>
        </p>
      ) : !item.open ? (
        <p>Not answered.</p>
      ) : item.kind === 'approval' ? (
        <div className="flex gap-2">
          <Button size="sm" disabled={pending} onClick={() => void respond(true)}>
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void respond(false)}
          >
            Decline
          </Button>
        </div>
      ) : item.choices.length ? (
        <div className="flex flex-wrap gap-1.5">
          {item.choices.map((choice) => (
            <Button
              key={choice}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => void respond(choice)}
            >
              {choice}
            </Button>
          ))}
        </div>
      ) : (
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) void respond(text.trim());
          }}
        >
          <Input
            aria-label="Answer"
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="h-8 text-[0.8rem]"
          />
          <Button size="sm" disabled={pending || !text.trim()}>
            Answer
          </Button>
        </form>
      )}
    </section>
  );
}

function PersonMessage({ text, at }: { text: string; at: string }) {
  return (
    <div className="ml-auto flex max-w-[85%] flex-col items-end gap-0.5">
      <p className="rounded-lg bg-primary px-3 py-1.5 text-[0.8rem] whitespace-pre-wrap text-primary-foreground">
        {text}
      </p>
      <time className="text-[0.7rem] text-muted-foreground tabular-nums">
        {formatDate(Date.parse(at), 'time')}
      </time>
    </div>
  );
}

function AgentText({ text, at }: { text: string; at?: string }) {
  return (
    <div className="mr-auto flex max-w-[92%] flex-col items-start gap-0.5">
      <p className="rounded-lg bg-muted px-3 py-1.5 text-[0.8rem] whitespace-pre-wrap">{text}</p>
      {at && (
        <time className="text-[0.7rem] text-muted-foreground tabular-nums">
          {formatDate(Date.parse(at), 'time')}
        </time>
      )}
    </div>
  );
}

/** How the run ended, or that it is still working. */
function RunState({ run }: { run: PanelRun }) {
  if (run.historyUnavailable)
    return (
      <p className="text-xs text-muted-foreground">
        Permissions changed since this run, so its messages are hidden.
      </p>
    );
  if (!runEnded(run) && !run.state.startsWith('awaiting-'))
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Working
      </p>
    );
  if (run.state === 'failed')
    return <p className="text-xs text-destructive">{run.failure?.message ?? 'The run failed.'}</p>;
  if (run.state === 'cancelled') return <p className="text-xs text-muted-foreground">Stopped.</p>;
  if (run.state === 'interrupted')
    return <p className="text-xs text-muted-foreground">Interrupted when the host restarted.</p>;
  return null;
}

/** One run's text, calls and requests in order; consecutive calls share one row of chips. */
function RunView({ run, conversation }: { run: PanelRun; conversation: AssistantConversation }) {
  const blocks: ReactNode[] = [];
  let chips: CallItem[] = [];
  const flush = () => {
    if (chips.length)
      blocks.push(
        <ul key={`calls-${chips[0]!.callId}`} aria-label="Calls" className="flex flex-wrap gap-1">
          {chips.map((call) => (
            <CallChip key={call.callId} call={call} />
          ))}
        </ul>,
      );
    chips = [];
  };
  for (const [index, item] of runItems(run).entries()) {
    const approval = item.kind === 'call' ? approvalRequestOf(item) : undefined;
    if (item.kind === 'call' && !approval) {
      chips.push(item);
      continue;
    }
    flush();
    if (approval) blocks.push(<ApprovalRequestCard key={approval} resource={approval} />);
    else if (item.kind === 'text') blocks.push(<AgentText key={index} {...item} />);
    else if (item.kind !== 'call')
      blocks.push(
        <RequestCard
          key={item.requestId}
          item={item}
          onAnswer={(value) => conversation.answer(run.id, item.requestId, value)}
        />,
      );
  }
  flush();
  blocks.push(<RunState key="state" run={run} />);
  return <>{blocks}</>;
}

/** The review a run asked for in the panel's UI session, acknowledged or dismissed here. */
function ReviewCard({ conversation }: { conversation: AssistantConversation }) {
  const { review, acknowledgeReview } = conversation.ui;
  if (!review) return null;
  return (
    <section
      aria-label="Review"
      className="space-y-2 rounded-lg border-2 border-warning/60 bg-card px-3 py-2 text-[0.8rem]"
    >
      <p className="font-medium">{review.title}</p>
      {review.resources.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {review.resources.map((resource) => (
            <li key={resource}>
              <ResourceLink resource={resource} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void acknowledgeReview(true)}>
          Acknowledge
        </Button>
        <Button size="sm" variant="outline" onClick={() => void acknowledgeReview(false)}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}

/** The conversation, newest at the bottom, scrolled to the end as it grows. */
export function Transcript({
  conversation,
  empty,
}: {
  conversation: AssistantConversation;
  /** What the panel shows before the first message. */
  empty: ReactNode;
}) {
  const end = useRef<HTMLDivElement>(null);
  const { turns } = conversation;
  const size = turns.reduce((count, run) => count + run.events.length, turns.length);
  // Chromium's scrollIntoView returns a promise, which an effect must not return.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [size]);
  if (!turns.length && !conversation.ui.review) return <div className="p-3">{empty}</div>;
  return (
    <div role="log" aria-label="Conversation" className="flex flex-col gap-2 p-3">
      {turns.map((run) => (
        <div key={run.id} className="flex flex-col gap-1.5">
          {run.request !== undefined && <PersonMessage text={run.request} at={run.createdAt} />}
          <RunView run={run} conversation={conversation} />
        </div>
      ))}
      <ReviewCard conversation={conversation} />
      <div ref={end} />
    </div>
  );
}
