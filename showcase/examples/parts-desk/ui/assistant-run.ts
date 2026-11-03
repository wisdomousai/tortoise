/**
 * What the assistant panel shows of one run, from the events the run route returns. Pure, so a
 * unit test reads it without a browser.
 */

/** The fields of a run event the panel reads; `Run` from `@/components/run-panel` has them. */
export interface PanelEvent {
  readonly sequence: number;
  readonly at?: string;
  readonly type: string;
  readonly text?: string;
  readonly message?: string;
  readonly operation?: string;
  readonly callId?: string;
  readonly resources?: readonly string[];
  readonly code?: string;
  readonly requestId?: string;
  readonly choices?: readonly string[];
}
export interface PanelRun {
  readonly id: string;
  readonly state: string;
  readonly conversationId: string;
  readonly events: readonly PanelEvent[];
  readonly failure?: { readonly message: string };
}

/** One call: its tool-start, and its tool-finish once the host settled it. */
export interface CallItem {
  readonly kind: 'call';
  readonly callId: string;
  readonly operation: string;
  /** Running until the finish; refused when the finish carries an error code. */
  readonly state: 'running' | 'finished' | 'refused';
  readonly code?: string;
  /** The records a command changed, as `<kind>:<id>`. A query's finish names none. */
  readonly resources: readonly string[];
}
export type RunItem =
  | { readonly kind: 'text'; readonly text: string; readonly at?: string }
  | CallItem
  | {
      readonly kind: 'question';
      readonly requestId: string;
      readonly message: string;
      readonly choices: readonly string[];
      /** The run waits for this answer now. */
      readonly open: boolean;
    };

const finished = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

/** Whether the run has ended, so the panel takes the next message. */
export const runEnded = (run: Pick<PanelRun, 'state'>) => finished.has(run.state);

/**
 * The run's text, calls and questions in the order they happened. Consecutive text events join
 * into one message with the time of the last; a tool-finish settles the call its callId started.
 */
export function runItems(run: PanelRun): RunItem[] {
  const items: RunItem[] = [];
  const calls = new Map<string, number>();
  const events = [...run.events].sort((a, b) => a.sequence - b.sequence);
  const waiting = run.state === 'awaiting-question';
  const lastQuestion = events.findLast((event) => event.type === 'question')?.requestId;
  for (const event of events) {
    const previous = items.at(-1);
    if (event.type === 'text' && event.text) {
      if (previous?.kind === 'text')
        items[items.length - 1] = { kind: 'text', text: previous.text + event.text, at: event.at };
      else items.push({ kind: 'text', text: event.text, at: event.at });
    } else if (event.type === 'tool-start' && event.callId && event.operation) {
      calls.set(event.callId, items.length);
      items.push({
        kind: 'call',
        callId: event.callId,
        operation: event.operation,
        state: 'running',
        resources: [],
      });
    } else if (event.type === 'tool-finish' && event.callId && event.operation) {
      const settled: CallItem = {
        kind: 'call',
        callId: event.callId,
        operation: event.operation,
        state: event.code ? 'refused' : 'finished',
        ...(event.code ? { code: event.code } : {}),
        resources: event.resources ?? [],
      };
      const at = calls.get(event.callId);
      if (at === undefined) items.push(settled);
      else items[at] = settled;
    } else if (event.type === 'question' && event.requestId)
      items.push({
        kind: 'question',
        requestId: event.requestId,
        message: event.message ?? '',
        choices: event.choices ?? [],
        open: waiting && event.requestId === lastQuestion,
      });
  }
  return items;
}

/** The calls that send a UI intent to the panel's session and change no records. */
export const uiTools = ['ui.open', 'ui.select', 'ui.prepare'] as const;
export type UiTool = (typeof uiTools)[number];
export const isUiTool = (operation: string): operation is UiTool =>
  (uiTools as readonly string[]).includes(operation);

/**
 * What the panel's handler received for one UI intent and did with it. A run's events name the
 * call but not its input, so the handler notes it for the call's chip.
 */
export interface UiNote {
  /** The run the panel sent last when the intent arrived; runs of the panel never overlap. */
  readonly runId: string | undefined;
  readonly tool: UiTool;
  /** The record opened or selected, such as TR-40417, or the serial of the form filled. */
  readonly name: string;
  /** The command whose form was filled. */
  readonly operation?: string;
  /** How many lines the filled quote holds. */
  readonly lines?: number;
  /** The screen it opened, for the chip's link. */
  readonly to?: string;
  readonly search?: Readonly<Record<string, string>>;
  /** False when the screen rejected the intent. */
  readonly accepted: boolean;
}

/**
 * The note of each UI call of the run, by call ID. The host queues an intent for each call it
 * accepts, in the order of the calls, so the run's n-th accepted call of a tool sent the n-th
 * intent of that tool the panel noted for the run. A refused call queued nothing.
 */
export function notesByCall(run: PanelRun, notes: readonly UiNote[]): Map<string, UiNote> {
  const byCall = new Map<string, UiNote>();
  const taken = new Map<UiTool, number>();
  for (const item of runItems(run)) {
    if (item.kind !== 'call' || !isUiTool(item.operation) || item.state === 'refused') continue;
    const index = taken.get(item.operation) ?? 0;
    taken.set(item.operation, index + 1);
    const note = notes.filter((entry) => entry.runId === run.id && entry.tool === item.operation)[
      index
    ];
    if (note) byCall.set(item.callId, note);
  }
  return byCall;
}

/** The assistant's whole text in the run, for the earlier turns of a follow-up's prompt. */
export const runText = (run: PanelRun) =>
  run.events
    .filter((event) => event.type === 'text')
    .map((event) => event.text ?? '')
    .join('');

/** A transformer serial or a quote number in the assistant's text, which the panel links. */
export const RECORD_NAME = /\b(TR-\d{5}|Q-\d{5})\b/g;

/** The text split into plain parts and the serials and quote numbers in it. */
export function recordNames(text: string) {
  const parts: { text: string; record?: 'transformer' | 'quote' }[] = [];
  let from = 0;
  for (const match of text.matchAll(RECORD_NAME)) {
    if (match.index > from) parts.push({ text: text.slice(from, match.index) });
    parts.push({ text: match[0], record: match[0].startsWith('TR-') ? 'transformer' : 'quote' });
    from = match.index + match[0].length;
  }
  if (from < text.length) parts.push({ text: text.slice(from) });
  return parts;
}
