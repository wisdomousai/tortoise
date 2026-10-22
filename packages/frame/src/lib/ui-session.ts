import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { UiIntent } from '@agent-native/contracts';
import { resourcePath } from '@agent-native/frame/screens';
import { useScreens } from '@/screens-context';
import { hostJson } from './host-client';
import { applyUiIntent, type UiIntentHandlers, type UiReview } from './ui-intents';

export type { UiReview } from './ui-intents';

type Resource = { id: string; revision: number } | undefined;
type Binding = { sessionId: string; version: number; key: string };

/** How a screen applies an agent's intents; see `useUiSession`. */
export interface UiSessionHandlers {
  /** Make the resource this screen's selection without navigating; throw for another kind. */
  readonly select?: (resource: string) => Promise<void>;
  /** Open the resource; by default its `screens.resources` path. */
  readonly open?: (resource: string) => Promise<void>;
}
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
 * Apply the intents an agent sent: a review request is shown; an open or a selection is applied
 * and acknowledged as accepted or rejected.
 */
async function receiveIntents(sessionId: string, handlers: UiIntentHandlers, signal: AbortSignal) {
  const intents = await hostJson<{ id: string; intent: UiIntent }[]>(
    `ui/sessions/${sessionId}/intents`,
    undefined,
    signal,
  );
  for (const entry of intents) {
    const status = await applyUiIntent(entry.id, entry.intent, handlers);
    if (status) await hostJson(`ui/sessions/${sessionId}/ack`, { id: entry.id, status }, signal);
  }
}

/**
 * One ephemeral frontend session for the screen showing `resource`; updates serialize and run
 * starts pin an exact version. A run started from it sends intents back: `openResource` opens
 * the resource's screen, `selectResource` calls `handlers.select` and is rejected without it,
 * and `requestReview` sets `review` until `acknowledgeReview`.
 */
export function useUiSession(resource: Resource, handlers: UiSessionHandlers = {}) {
  const [sessionId, setSessionId] = useState<string>();
  const [review, setReview] = useState<UiReview>();
  const screens = useScreens();
  const router = useRouter();
  const latest: UiIntentHandlers = {
    open:
      handlers.open ??
      (async (target) => {
        await router.navigate({ to: await resourcePath(screens, target) } as never);
      }),
    ...(handlers.select ? { select: handlers.select } : {}),
    review: setReview,
  };
  // The polling loop starts once; it reads the handlers of the latest render.
  const intentHandlers = useRef(latest);
  intentHandlers.current = latest;
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
        await receiveIntents(bound.sessionId, intentHandlers.current, abort.signal);
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
