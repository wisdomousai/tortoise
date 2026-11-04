import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogAgent } from '@tortoise/contracts';
import type { AgentSelection, HostHarness } from '@/components/accounts';
import { useRuns } from '@/components/run-panel';
import { selectOnScreen, useShownRecords } from './assistant-context';
import { conversationRuns, runEnded, type PanelRun } from './assistant-run';
import { hostJson } from './host-client';
import { transport } from './session';
import { useUiSession } from './ui-session';

const CONVERSATION_KEY = 'tortoise.assistant.conversation.';

/** Storage can be off or full; then a value lasts as long as the page. */
function stored(key: string) {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function store(key: string, value: string | undefined) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // The value then lasts as long as the page.
  }
}

/** The agent definitions of the application, from the catalog the host serves this session. */
export function useAgents(): readonly CatalogAgent[] {
  const catalog = useQuery({
    queryKey: ['contract'],
    queryFn: () => transport.catalog(),
    staleTime: Infinity,
  });
  return catalog.data?.agents ?? [];
}

/** The harnesses the host offers for a run without `harnessId`. */
export function useHostHarnesses() {
  return useQuery({
    queryKey: ['harnesses'],
    queryFn: () => hostJson<HostHarness[]>('harnesses'),
    staleTime: 30_000,
  });
}

/**
 * The records of the current screen as the next run sees them: the panel's UI session selects
 * them unless the person left them out. Leaving out holds for these records only, so the next
 * screen's records are included again.
 */
function useScreen() {
  const records = useShownRecords();
  const key = records.map((record) => record.id).join(' ');
  const [leftOut, setLeftOut] = useState<string>();
  const included = records.length > 0 && leftOut !== key;
  return {
    records,
    included,
    leaveOut: () => setLeftOut(key),
    include: () => setLeftOut(undefined),
  };
}

/**
 * The conversation with one agent. Each message starts a run of the agent through the run route,
 * from the panel's own UI session, which selects the current screen's records and applies the
 * run's intents: `ui.open` and `ui.prepare` by the frame's defaults, `ui.select` on the screen
 * (`selectOnScreen`). The host keeps each run's request, events and answers, and gives a harness
 * that cannot resume the earlier turns, so the panel keeps only the conversation ID, per agent in
 * local storage: a reload shows the whole conversation again. A refused message stays in the
 * composer to send again.
 */
export function useAssistantConversation(agentId: string | undefined, harness: AgentSelection) {
  const screen = useScreen();
  const ui = useUiSession(
    screen.included
      ? screen.records.map((record) => ({ id: record.id, revision: record.revision }))
      : undefined,
    { select: selectOnScreen },
  );
  const runs = useRuns();
  const queryClient = useQueryClient();
  const key = CONVERSATION_KEY + (agentId ?? '');
  const [conversations, setConversations] = useState<Readonly<Record<string, string>>>({});
  const remembered = agentId ? (conversations[key] ?? stored(key)) : undefined;
  const all = (runs.data ?? []) as readonly PanelRun[];
  const turns = conversationRuns(all, remembered);
  // A remembered conversation the host no longer lists, such as after a reset, is gone.
  const conversationId = runs.data && !turns.length ? undefined : remembered;
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const last = turns.at(-1);
  /** The run that has not ended yet; the panel sends the next message after it. */
  const active = last && !runEnded(last) ? last.id : undefined;
  const remember = (id: string | undefined) => {
    store(key, id);
    setConversations((current) => ({ ...current, [key]: id ?? '' }));
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['runs'] });
  const failed = (refused: unknown, fallback: string) =>
    setError(refused instanceof Error ? refused.message : fallback);

  async function send(text = draft) {
    const request = text.trim();
    if (!agentId || !request || sending || active) return;
    setSending(true);
    setError(undefined);
    try {
      const session = await ui.prepare();
      const { local: _local, agentId: _agent, ...account } = harness;
      const run = await hostJson<PanelRun>('runs', {
        ...(harness.local ? {} : account),
        agentId,
        prompt: request,
        uiSessionId: session.sessionId,
        uiContextVersion: session.version,
        ...(conversationId ? { conversationId } : {}),
      });
      if (!conversationId) remember(run.conversationId);
      setDraft('');
      refresh();
    } catch (refused) {
      setDraft(text);
      failed(refused, 'The host refused the message.');
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!active) return;
    try {
      await hostJson(`runs/${active}/cancel`, {});
      refresh();
    } catch (refused) {
      failed(refused, 'The run did not stop.');
    }
  }

  /** Answer the run's open question (a string) or approval (a boolean). */
  async function answer(runId: string, requestId: string, value: string | boolean) {
    setError(undefined);
    try {
      await hostJson(`runs/${runId}/respond`, {
        requestId,
        ...(typeof value === 'boolean'
          ? { type: 'approval', approved: value }
          : { type: 'question', answer: value }),
      });
      refresh();
    } catch (refused) {
      failed(refused, 'The answer was not taken.');
    }
  }

  /** Start a new conversation; the earlier one stays on the host. */
  function clear() {
    remember(undefined);
    setDraft('');
    setError(undefined);
  }

  return {
    agentId,
    screen,
    ui,
    turns,
    loading: runs.isPending,
    draft,
    setDraft,
    sending,
    active,
    error,
    send,
    stop,
    answer,
    clear,
  };
}

export type AssistantConversation = ReturnType<typeof useAssistantConversation>;
