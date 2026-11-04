/**
 * What the assistant panel shows of one run, from the run the run route returns. Pure, so a unit
 * test reads it without a browser.
 */

/** The fields of a run event the panel reads. */
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
  readonly approved?: boolean;
}
export interface PanelRun {
  readonly id: string;
  readonly state: string;
  readonly conversationId: string;
  readonly createdAt: string;
  /** What the person asked; absent for a run no person asked for. */
  readonly request?: string;
  readonly context?: { readonly agentId?: string };
  readonly events: readonly PanelEvent[];
  readonly failure?: { readonly message: string };
  /** Set when permissions changed since the run, so the host hides its events. */
  readonly historyUnavailable?: boolean;
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
/** A question or an approval the run asked the person, and the answer once given. */
export interface RequestItem {
  readonly kind: 'question' | 'approval';
  readonly requestId: string;
  readonly message: string;
  readonly choices: readonly string[];
  /** The run waits for this answer now. */
  readonly open: boolean;
  /** A question's answer. */
  readonly answer?: string;
  /** An approval's decision. */
  readonly approved?: boolean;
}
export type RunItem =
  { readonly kind: 'text'; readonly text: string; readonly at?: string } | CallItem | RequestItem;

const finished = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);

/** Whether the run has ended, so the panel takes the next message. */
export const runEnded = (run: Pick<PanelRun, 'state'>) => finished.has(run.state);

/**
 * The run's text, calls, questions and approvals in the order they happened. Consecutive text
 * events join into one message with the time of the last; a tool-finish settles the call its
 * callId started, and an answer settles the request its requestId names.
 */
export function runItems(run: PanelRun): RunItem[] {
  const items: RunItem[] = [];
  const calls = new Map<string, number>();
  const requests = new Map<string, number>();
  const events = [...run.events].sort((a, b) => a.sequence - b.sequence);
  const waiting = run.state === 'awaiting-question' || run.state === 'awaiting-approval';
  const lastRequest = events.findLast(
    (event) => event.type === 'question' || event.type === 'approval',
  )?.requestId;
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
    } else if ((event.type === 'question' || event.type === 'approval') && event.requestId) {
      requests.set(event.requestId, items.length);
      items.push({
        kind: event.type,
        requestId: event.requestId,
        message: event.message ?? '',
        choices: event.choices ?? [],
        open: waiting && event.requestId === lastRequest,
      });
    } else if (event.type === 'answer' && event.requestId) {
      const at = requests.get(event.requestId);
      const asked = at === undefined ? undefined : items[at];
      if (asked && asked.kind !== 'text' && asked.kind !== 'call')
        items[at!] = {
          ...asked,
          open: false,
          ...(event.text !== undefined ? { answer: event.text } : {}),
          ...(event.approved !== undefined ? { approved: event.approved } : {}),
        };
    }
  }
  return items;
}

/** The approval request an `approval.request` call recorded, once its finish names it. */
export const approvalRequestOf = (call: CallItem) =>
  call.operation === 'approval.request' && call.state === 'finished'
    ? call.resources.find((resource) => resource.startsWith('approval-request:'))
    : undefined;

/** The runs of one conversation, in the order they started. */
export const conversationRuns = (runs: readonly PanelRun[], conversationId: string | undefined) =>
  conversationId
    ? runs
        .filter((run) => run.conversationId === conversationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    : [];
