import { useEffect, useRef, type ReactNode } from 'react';
import { Loader2, SendHorizontal, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ApprovalCard } from './assistant-approval';
import { ScreenRequests } from './assistant-context';
import { CallChip, LinkedText, QuestionCard } from './assistant-calls';
import { DictationButton, useDictation } from './assistant-dictation';
import { notesByCall, runEnded, runItems, type CallItem, type PanelRun } from './assistant-run';
import type { AssistantConversation, SentMessage } from './assistant-session';
import { clock } from './format';

/**
 * Requests the panel offers before the first message when the screen offers none; each one sends
 * as it reads.
 */
export const exampleRequests = [
  'A caller reads TR-40417 off the rating plate. Which transformer is it?',
  'Which HV bushings fit TR-40417, and are they in stock?',
  'The utility wants 15 percent off the open draft because of a late delivery.',
];

/** The approval request an `approval.request` call recorded, once its finish names it. */
const approvalOf = (call: CallItem) =>
  call.operation === 'approval.request' && call.state === 'finished'
    ? call.resources.find((resource) => resource.startsWith('approval-request:'))?.slice(17)
    : undefined;

function PersonMessage({ message }: { message: SentMessage }) {
  return (
    <div className="ml-auto flex max-w-[85%] flex-col items-end gap-0.5">
      <p className="rounded-lg bg-primary px-3 py-1.5 text-[0.8rem] whitespace-pre-wrap text-primary-foreground">
        {message.text}
      </p>
      <time className="text-[0.7rem] text-muted-foreground tabular">{clock(message.at)}</time>
    </div>
  );
}

function AssistantText({ text, at }: { text: string; at?: string }) {
  return (
    <div className="mr-auto flex max-w-[92%] flex-col items-start gap-0.5">
      <p className="rounded-lg bg-muted px-3 py-1.5 text-[0.8rem] whitespace-pre-wrap">
        <LinkedText text={text} />
      </p>
      {at && (
        <time className="text-[0.7rem] text-muted-foreground tabular">{clock(Date.parse(at))}</time>
      )}
    </div>
  );
}

/** One run's text, calls and questions in order; consecutive calls share one row of chips. */
function RunView({ run, conversation }: { run: PanelRun; conversation: AssistantConversation }) {
  const blocks: ReactNode[] = [];
  const notes = notesByCall(run, conversation.notes);
  let chips: CallItem[] = [];
  const flush = () => {
    if (chips.length)
      blocks.push(
        <ul key={`calls-${chips[0]!.callId}`} aria-label="Calls" className="flex flex-wrap gap-1">
          {chips.map((call) => {
            const note = notes.get(call.callId);
            return <CallChip key={call.callId} call={call} {...(note ? { note } : {})} />;
          })}
        </ul>,
      );
    chips = [];
  };
  for (const [index, item] of runItems(run).entries()) {
    const approval = item.kind === 'call' ? approvalOf(item) : undefined;
    if (item.kind === 'call' && !approval) {
      chips.push(item);
      continue;
    }
    flush();
    if (approval) blocks.push(<ApprovalCard key={approval} id={approval} />);
    else if (item.kind === 'text') blocks.push(<AssistantText key={index} {...item} />);
    else if (item.kind === 'question')
      blocks.push(
        <QuestionCard
          key={item.requestId}
          message={item.message}
          choices={item.choices}
          open={item.open}
          answer={conversation.answers[item.requestId]}
          onAnswer={(answer) => conversation.answer(run.id, item.requestId, answer)}
        />,
      );
  }
  flush();
  if (!runEnded(run) && run.state !== 'awaiting-question')
    blocks.push(
      <p key="working" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Working
      </p>,
    );
  if (run.state === 'failed')
    blocks.push(
      <p key="failed" className="text-xs text-destructive">
        {run.failure?.message ?? 'The run failed.'}
      </p>,
    );
  if (run.state === 'cancelled' || run.state === 'interrupted')
    blocks.push(
      <p key="stopped" className="text-xs text-muted-foreground">
        {run.state === 'cancelled' ? 'Stopped.' : 'Interrupted when the host restarted.'}
      </p>,
    );
  return <>{blocks}</>;
}

/** The messages of the conversation, newest at the bottom, scrolled to the end as they grow. */
export function Transcript({ conversation }: { conversation: AssistantConversation }) {
  const end = useRef<HTMLDivElement>(null);
  const { messages } = conversation;
  const size = messages.reduce(
    (count, message) => count + (conversation.runOf(message.runId)?.events.length ?? 0),
    messages.length,
  );
  // Chromium's scrollIntoView returns a promise, which an effect must not return.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [size]);
  const offered = conversation.screen.requests.length > 0;
  if (!messages.length)
    return (
      <div className="space-y-2 p-3">
        <p className="text-xs text-muted-foreground">
          Ask about a transformer, the parts that fit it or a quote.{' '}
          {offered ? 'The requests above the message field are about this screen.' : 'For example:'}
        </p>
        {!offered && (
          <ul className="space-y-1.5">
            {exampleRequests.map((request) => (
              <li key={request}>
                <button
                  type="button"
                  className="w-full rounded-md border px-2.5 py-1.5 text-left text-[0.8rem] hover:bg-muted"
                  onClick={() => void conversation.send(request)}
                >
                  {request}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  return (
    <div role="log" aria-label="Conversation" className="flex flex-col gap-2 p-3">
      {messages.map((message) => {
        const run = conversation.runOf(message.runId);
        return (
          <div key={message.runId} className="flex flex-col gap-1.5">
            <PersonMessage message={message} />
            {run && <RunView run={run} conversation={conversation} />}
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/**
 * A growing text area: Enter sends, Shift+Enter breaks the line, Stop cancels the running run.
 * Above it, the requests the current screen suggests. The microphone dictates into the text area
 * on this device when the browser offers on-device English recognition.
 */
export function Composer({ conversation }: { conversation: AssistantConversation }) {
  const { draft, setDraft, sending, active, error } = conversation;
  const field = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation(draft, setDraft);
  return (
    <form
      className="space-y-1.5 border-t p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void conversation.send();
      }}
    >
      {error && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {error}
        </p>
      )}
      {dictation.error && (
        <p role="alert" className="px-1 text-xs text-destructive">
          {dictation.error}
        </p>
      )}
      <ScreenRequests
        requests={conversation.screen.requests}
        onPick={(request) => {
          setDraft(request);
          field.current?.focus();
        }}
      />
      <div className="flex items-end gap-1.5">
        <Textarea
          ref={field}
          aria-label="Message"
          rows={1}
          maxLength={4000}
          placeholder="Ask the assistant"
          className="max-h-40 min-h-8 resize-none py-1.5 text-[0.8rem] md:text-[0.8rem]"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void conversation.send();
          }}
        />
        <DictationButton dictation={dictation} />
        {active ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void conversation.stop()}
          >
            <Square aria-hidden />
            Stop
          </Button>
        ) : (
          <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
            <SendHorizontal aria-hidden />
            Send
          </Button>
        )}
      </div>
    </form>
  );
}
