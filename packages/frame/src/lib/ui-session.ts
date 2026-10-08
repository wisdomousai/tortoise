import { useEffect, useRef, useState } from 'react';
import type { UiIntent } from '@agent-native/react';
import { hostJson } from './host-client';

type Resource = { id: string; revision: number } | undefined;
type Binding = { sessionId: string; version: number; key: string };

type Review = { id: string; title: string; operations: readonly string[] };
type Selection = { selectedResources: string[]; observedRevisions: Record<string, number> };

/** Create the session, or move the bound one to `context` at its expected version. */
async function bindSession(
  bound: Binding | undefined,
  context: Selection,
  key: string,
  signal?: AbortSignal,
): Promise<Binding> {
  const result = bound
    ? await hostJson<{ sessionId: string; version: number }>(
        `ui/sessions/${bound.sessionId}`,
        { context, expectedVersion: bound.version },
        signal,
      )
    : await hostJson<{ sessionId: string; version: number }>('ui/sessions', context, signal);
  return { ...result, key };
}

/**
 * Apply the intents an agent sent: a review request is shown; a selection is applied and
 * acknowledged as accepted or rejected.
 */
async function receiveIntents(
  sessionId: string,
  onReview: (review: Review) => void,
  select: (resource: string) => Promise<void>,
  signal: AbortSignal,
) {
  const intents = await hostJson<{ id: string; intent: UiIntent }[]>(
    `ui/sessions/${sessionId}/intents`,
    undefined,
    signal,
  );
  for (const entry of intents) {
    if (entry.intent.type === 'requestReview')
      onReview({
        id: entry.id,
        title: entry.intent.title,
        operations: entry.intent.operations,
      });
    else {
      let status = 'accepted';
      try {
        await select(entry.intent.resource);
      } catch {
        status = 'rejected';
      }
      await hostJson(`ui/sessions/${sessionId}/ack`, { id: entry.id, status }, signal);
    }
  }
}

/** One ephemeral frontend session; updates serialize and run starts pin an exact version. */
export function useUiSession(resource: Resource, select: (resource: string) => Promise<void>) {
  const [sessionId, setSessionId] = useState<string>();
  const [review, setReview] = useState<Review>();
  const selected = useRef(select);
  selected.current = select;
  const current = useRef(resource);
  current.current = resource;
  const binding = useRef<Binding | undefined>(undefined);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  function synchronize(value: Resource, signal?: AbortSignal): Promise<Binding> {
    const context = {
      selectedResources: value ? [value.id] : [],
      observedRevisions: value ? { [value.id]: value.revision } : {},
    };
    const key = JSON.stringify(context);
    const next = tail.current
      .catch(() => {})
      .then(async () => {
        if (binding.current?.key === key) return binding.current;
        binding.current = await bindSession(binding.current, context, key, signal);
        setSessionId(binding.current.sessionId);
        return binding.current;
      });
    tail.current = next;
    return next;
  }
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function sync() {
      try {
        const bound = await synchronize(current.current, abort.signal);
        await receiveIntents(
          bound.sessionId,
          setReview,
          (resource) => selected.current(resource),
          abort.signal,
        );
      } catch {
        if (!abort.signal.aborted) {
          binding.current = undefined;
          setSessionId(undefined);
        }
      }
      if (!abort.signal.aborted) timer = setTimeout(sync, 500);
    }
    void sync();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, []);
  return {
    sessionId,
    review,
    async prepare() {
      const bound = await synchronize(current.current);
      return { sessionId: bound.sessionId, version: bound.version };
    },
    async acknowledgeReview(accepted: boolean) {
      if (sessionId && review)
        await hostJson(`ui/sessions/${sessionId}/ack`, {
          id: review.id,
          status: accepted ? 'accepted' : 'rejected',
        });
      setReview(undefined);
    },
  };
}
