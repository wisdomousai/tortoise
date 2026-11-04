import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  AppWindow,
  Check,
  ClipboardPen,
  Loader2,
  MousePointerClick,
  Search,
  SquarePen,
} from 'lucide-react';
import type { CatalogOperation } from '@tortoise/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { live, transport } from '@/lib/session';
import { cn } from '@/lib/utils';
import { operations } from '../contracts';
import { isUiTool, recordNames, type CallItem, type UiNote, type UiTool } from './assistant-run';

/** The catalog the host serves this session, shared with the command palette's query. */
export function useCatalogOperation(id: string): CatalogOperation | undefined {
  const catalog = useQuery({
    queryKey: ['contract'],
    queryFn: () => transport.catalog(),
    staleTime: Infinity,
  });
  return catalog.data?.operations.find((operation) => operation.id === id);
}

/** The capability's title from the catalog, or its ID when it declares none. */
export const titleOf = (operation: CatalogOperation | undefined, id: string) =>
  operation?.display?.label ?? id;

const linkClass =
  'font-mono font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary';

/**
 * A record a command changed, by `<kind>:<id>`, named and linked to its screen. The assistant's
 * commands change quotes, and the inquiry a new quote answers; another kind shows as its kind.
 */
export function RecordLink({ resource }: { resource: string }) {
  const at = resource.indexOf(':');
  const kind = resource.slice(0, at);
  const id = resource.slice(at + 1);
  const quote = useQuery({
    ...live.liveQueryOptions(operations.quoteGet, { id }),
    enabled: kind === 'quote',
  }).data;
  const inquiry = useQuery({
    ...live.liveQueryOptions(operations.inquiryGet, { id }),
    enabled: kind === 'inquiry',
  }).data;
  const target = quote
    ? { to: `/quotes/${quote.id}`, name: quote.number }
    : inquiry
      ? { to: '/inquiries', name: inquiry.subject }
      : undefined;
  if (!target) return <span className="font-mono text-muted-foreground">{kind}</span>;
  return (
    <Link to={target.to} className={cn(linkClass, 'max-w-40 truncate')}>
      {target.name}
    </Link>
  );
}

/** A quote number in the assistant's text, linked once quote.list finds that number. */
function QuoteNumber({ number }: { number: string }) {
  const found = useQuery(live.liveQueryOptions(operations.quoteList, { search: number, limit: 5 }));
  const quote = found.data?.items.find((item) => item.number === number);
  if (!quote) return <>{number}</>;
  return (
    <Link to={`/quotes/${quote.id}`} className={linkClass}>
      {number}
    </Link>
  );
}

/**
 * The assistant's text with each transformer serial and quote number linked to its screen. A
 * query's finish names no records, so this is how a find or a list links what it read.
 */
export function LinkedText({ text }: { text: string }) {
  return (
    <>
      {recordNames(text).map((part, index) =>
        part.record === 'transformer' ? (
          <Link key={index} to={`/transformers/${part.text}`} className={linkClass}>
            {part.text}
          </Link>
        ) : part.record === 'quote' ? (
          <QuoteNumber key={index} number={part.text} />
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

const uiCall = {
  'ui.open': { icon: AppWindow, done: 'Opened', failed: 'Did not open', waiting: 'Open a screen' },
  'ui.select': {
    icon: MousePointerClick,
    done: 'Selected',
    failed: 'Did not select',
    waiting: 'Select a record',
  },
  'ui.prepare': {
    icon: ClipboardPen,
    done: 'Filled',
    failed: 'Did not fill',
    waiting: 'Fill a form',
  },
} as const;

/**
 * A call that sends the screen a UI intent, as a chip that says what it did from the handler's
 * note: what opened or was selected, or which form was filled for which transformer, linked to
 * that screen. Until the panel has applied the intent it says what the call asks for.
 */
function UiCallChip({ call, note }: { call: CallItem & { operation: UiTool }; note?: UiNote }) {
  const form = useCatalogOperation(note?.operation ?? '');
  const { icon: Icon, ...words } = uiCall[call.operation];
  const formTitle = note?.operation ? titleOf(form, note.operation) : undefined;
  const target =
    note?.accepted && note.to ? (
      <Link
        to={note.to}
        {...(note.search ? { search: note.search } : {})}
        className={cn(linkClass, 'max-w-40 truncate')}
      >
        {note.name}
        {note.lines !== undefined && `, ${note.lines} ${note.lines === 1 ? 'line' : 'lines'}`}
      </Link>
    ) : note?.name ? (
      <span className="font-mono">{note.name}</span>
    ) : null;
  return (
    <li
      className={cn(
        'flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border bg-background px-2 py-1 text-xs',
        (call.state === 'refused' || note?.accepted === false) && 'border-destructive/40',
      )}
    >
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-label="Screen" />
      <span className="font-medium" title={call.operation}>
        {note ? (note.accepted ? words.done : words.failed) : words.waiting}
        {formTitle && ` ${formTitle}`}
        {formTitle && target && ' for'}
      </span>
      {target}
      {call.state === 'running' ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Running" />
      ) : call.state === 'refused' ? (
        <span className="font-mono font-medium text-destructive">{call.code}</span>
      ) : note?.accepted === false ? (
        <span className="font-medium text-destructive">rejected</span>
      ) : (
        <Check className="size-3.5 text-success" aria-label="Done" />
      )}
    </li>
  );
}

/**
 * One call as a chip: the capability's title, an icon for a query or a command, a spinner while
 * it runs, a check once it finished and the refusal code when the host refused it. A command's
 * chip links each record it changed. A UI call shows what the screen did with it (`note`).
 */
export function CallChip({ call, note }: { call: CallItem; note?: UiNote }) {
  if (isUiTool(call.operation))
    return <UiCallChip call={{ ...call, operation: call.operation }} {...(note ? { note } : {})} />;
  return <CatalogCallChip call={call} />;
}

function CatalogCallChip({ call }: { call: CallItem }) {
  const operation = useCatalogOperation(call.operation);
  const Kind = operation?.kind === 'command' ? SquarePen : Search;
  return (
    <li
      className={cn(
        'flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border bg-background px-2 py-1 text-xs',
        call.state === 'refused' && 'border-destructive/40',
      )}
    >
      <Kind
        className="size-3.5 shrink-0 text-muted-foreground"
        aria-label={operation?.kind === 'command' ? 'Command' : 'Query'}
      />
      <span className="font-medium" title={call.operation}>
        {titleOf(operation, call.operation)}
      </span>
      {call.state === 'running' ? (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Running" />
      ) : call.state === 'refused' ? (
        <span className="font-mono font-medium text-destructive">{call.code}</span>
      ) : (
        <Check className="size-3.5 text-success" aria-label="Done" />
      )}
      {call.resources.map((resource) => (
        <RecordLink key={resource} resource={resource} />
      ))}
    </li>
  );
}

/**
 * A question the run asks the person: a button per offered choice, or a text field without
 * choices. Once answered, or once the run stopped waiting, it shows the question and the answer.
 */
export function QuestionCard({
  message,
  choices,
  open,
  answer,
  onAnswer,
}: {
  message: string;
  choices: readonly string[];
  open: boolean;
  answer?: string;
  onAnswer: (answer: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const respond = async (value: string) => {
    setPending(true);
    try {
      await onAnswer(value);
    } finally {
      setPending(false);
    }
  };
  return (
    <section
      aria-label="Question"
      className={cn(
        'space-y-2 rounded-lg border px-3 py-2 text-[0.8rem]',
        open ? 'border-primary/40 bg-card' : 'bg-muted/40 text-muted-foreground',
      )}
    >
      <p className="whitespace-pre-wrap">{message}</p>
      {open && !answer ? (
        choices.length ? (
          <div className="flex flex-wrap gap-1.5">
            {choices.map((choice) => (
              <Button
                key={choice}
                size="xs"
                variant="outline"
                className="font-mono"
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
              className="h-7 text-[0.8rem]"
              value={text}
              maxLength={8000}
              onChange={(event) => setText(event.target.value)}
            />
            <Button size="sm" disabled={pending || !text.trim()}>
              Answer
            </Button>
          </form>
        )
      ) : answer ? (
        <p className="text-xs">
          Answered <span className="font-mono text-foreground">{answer}</span>
        </p>
      ) : null}
    </section>
  );
}
