import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRuns } from '@/components/run-panel';
import { hostJson } from '@/lib/host-client';
import { useUiSession } from '@/lib/ui-session';
import { assistantAgent } from '../contracts/assistant-agent';
import { conversationPrompt } from '../conversation';
import { useAssistantIntents } from './assistant-intents';
import { runEnded, runText, type PanelRun } from './assistant-run';
import { useShownRecords } from './screen-context';
import { screenRequests, screenResources } from './screen-records';

/** One message the person sent, and the run it started. */
export interface SentMessage {
  readonly runId: string;
  readonly text: string;
  readonly at: number;
}

/**
 * The records of the current screen as the next run sees them: the panel's UI session selects
 * them unless the person left them out. Leaving out holds for these records only, so the next
 * screen's records are included again.
 */
function useScreen() {
  const records = useShownRecords();
  const resources = screenResources(records);
  const key = resources.map((resource) => resource.id).join(' ');
  const [leftOut, setLeftOut] = useState<string>();
  const included = records.length > 0 && leftOut !== key;
  return {
    records,
    included,
    /** The selection for the panel's UI session; undefined selects nothing. */
    resources: included ? resources : undefined,
    requests: included ? screenRequests(records) : [],
    leaveOut: () => setLeftOut(key),
    include: () => setLeftOut(undefined),
  };
}

/**
 * The assistant panel's conversation. Each message starts a run of the assistant through the run
 * route, from the panel's own UI session, so the run's intents reach the frame after it navigates.
 * The session selects the current screen's records, so the run's context names them, and applies
 * the run's intents to open, select and prepare (`useAssistantIntents`).
 * Runs keep no prompt, so the panel keeps what the person wrote; the first run's conversationId
 * continues the conversation, and a follow-up's prompt carries the earlier turns as text, since
 * the local harness keeps no history between runs. The host refuses a start while the model
 * server is still starting, so a refused message stays in the composer to send again.
 */
export function useAssistantConversation() {
  const screen = useScreen();
  /** The run the panel sent last; the UI intents that arrive belong to it. */
  const sentRun = useRef<string>(undefined);
  const intents = useAssistantIntents(() => sentRun.current);
  const ui = useUiSession(screen.resources, intents.handlers);
  const runs = useRuns();
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<readonly SentMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  /** The answer the person gave each question, by request ID; run events do not carry it. */
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});

  const byId = new Map((runs.data ?? []).map((run) => [run.id, run as PanelRun]));
  const last = messages.at(-1);
  const lastRun = last ? byId.get(last.runId) : undefined;
  /** The run that has not ended yet; the panel sends the next message after it. */
  const active = last && (!lastRun || !runEnded(lastRun)) ? last.runId : undefined;

  async function send(text = draft) {
    const request = text.trim();
    if (!request || sending || active) return;
    setSending(true);
    setError(undefined);
    try {
      const earlier = messages.map((message) => {
        const run = byId.get(message.runId);
        return { request: message.text, answer: run ? runText(run) : '' };
      });
      const session = await ui.prepare();
      const run = await hostJson<PanelRun>('runs', {
        agentId: assistantAgent.id,
        prompt: conversationPrompt(earlier, request),
        uiSessionId: session.sessionId,
        uiContextVersion: session.version,
        ...(conversationId ? { conversationId } : {}),
      });
      sentRun.current = run.id;
      setMessages((sent) => [...sent, { runId: run.id, text: request, at: Date.now() }]);
      setConversationId((current) => current ?? run.conversationId);
      setDraft('');
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    } catch (refused) {
      setDraft(text);
      setError(refused instanceof Error ? refused.message : 'The host refused the message.');
    } finally {
      setSending(false);
    }
  }

  async function stop() {
    if (!active) return;
    try {
      await hostJson(`runs/${active}/cancel`, {});
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    } catch (refused) {
      setError(refused instanceof Error ? refused.message : 'The run did not stop.');
    }
  }

  async function answer(runId: string, requestId: string, value: string) {
    setError(undefined);
    try {
      await hostJson(`runs/${runId}/respond`, { type: 'question', requestId, answer: value });
      setAnswers((given) => ({ ...given, [requestId]: value }));
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    } catch (refused) {
      setError(refused instanceof Error ? refused.message : 'The answer was not taken.');
    }
  }

  /** Start a new conversation: the panel forgets the messages and the conversation ID. */
  function clear() {
    setMessages([]);
    setConversationId(undefined);
    setAnswers({});
    sentRun.current = undefined;
    intents.clearNotes();
    setDraft('');
    setError(undefined);
  }

  return {
    screen,
    messages,
    runOf: (runId: string) => byId.get(runId),
    /** What the panel's handlers noted of each UI intent, for the chips of the UI calls. */
    notes: intents.notes,
    answers,
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
