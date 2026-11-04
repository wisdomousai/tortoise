import { useEffect, useRef, useState } from 'react';
import { useRouter } from '@tanstack/react-router';
import type { JsonObject, UiIntent } from '@tortoise/contracts';
import { resourcePath, screenForCapability } from '@tortoise/frame/screens';
import { useScreens } from '@/screens-context';
import { hostJson } from './host-client';
import {
  applyUiIntent,
  uiSelection,
  type UiIntentHandlers,
  type UiResource,
  type UiReview,
} from './ui-intents';
import { holdRunPrefill } from './os-deliveries';

export type { UiReview } from './ui-intents';

/** What the screen has selected: nothing, one resource or several. */
type Selected = UiResource | readonly UiResource[] | undefined;
const listOf = (value: Selected): readonly UiResource[] =>
  value === undefined ? [] : 'id' in value ? [value] : value;
type Binding = { sessionId: string; version: number; key: string };

/** How a screen applies an agent's intents; see `useUiSession`. */
export interface UiSessionHandlers {
  /** Make the resource this screen's selection without navigating; throw for another kind. */
  readonly select?: (resource: string) => Promise<void>;
  /** Open the resource; by default its `screens.resources` path. */
  readonly open?: (resource: string) => Promise<void>;
  /**
   * Fill a command's form; by default the prefill is held for the form that binds the command
   * (`usePreparedInput`, which `CapabilityForm` reads) and its capability screen opens. A handler
   * that opens another screen holds it with `holdRunPrefill(id, operation, input)` itself.
   */
  readonly prepare?: (operation: string, input: JsonObject, id: string) => Promise<void>;
}
type Selection = ReturnType<typeof uiSelection>;

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
  const intents = await hostJson<{ id: string; intent: UiIntent; runId?: string }[]>(
    `ui/sessions/${sessionId}/intents`,
    undefined,
    signal,
  );
  for (const entry of intents) {
    const status = await applyUiIntent(entry.id, entry.intent, handlers, entry.runId);
    if (status) await hostJson(`ui/sessions/${sessionId}/ack`, { id: entry.id, status }, signal);
  }
}

/**
 * The review an agent asked for, shown until the person acknowledges it. A review stays pending
 * on the host until then, so a poll answered just before the acknowledgement returns it once
 * more; an acknowledged review never shows again.
 */
function useReview(sessionId: string | undefined) {
  const [review, setReview] = useState<UiReview>();
  const acknowledged = useRef(new Set<string>());
  return {
    review,
    show(value: UiReview) {
      if (!acknowledged.current.has(value.id)) setReview(value);
    },
    async acknowledge(accepted: boolean) {
      if (sessionId && review) {
        acknowledged.current.add(review.id);
        await hostJson(`ui/sessions/${sessionId}/ack`, {
          id: review.id,
          status: accepted ? 'accepted' : 'rejected',
        });
      }
      setReview(undefined);
    },
  };
}

/**
 * One ephemeral frontend session for the screen showing `resource`, or the resources a list
 * screen has selected; updates serialize and run starts pin an exact version. A run started
 * from it sends intents back: `openResource` opens the resource's screen, `selectResource`
 * calls `handlers.select` and is rejected without it, `prepare` fills a command's form for the
 * person to submit, and `requestReview` sets `review` until `acknowledgeReview`.
 */
export function useUiSession(resource: Selected, handlers: UiSessionHandlers = {}) {
  const [sessionId, setSessionId] = useState<string>();
  const reviews = useReview(sessionId);
  const screens = useScreens();
  const router = useRouter();
  const latest: UiIntentHandlers = {
    open:
      handlers.open ??
      (async (target) => {
        await router.navigate({ to: await resourcePath(screens, target) } as never);
      }),
    ...(handlers.select ? { select: handlers.select } : {}),
    review: reviews.show,
    prepare:
      handlers.prepare ??
      (async (operation, input, id) => {
        holdRunPrefill(id, operation, input);
        const to = screenForCapability(screens, operation);
        if (to) await router.navigate({ to } as never);
      }),
  };
  // The polling loop starts once; it reads the handlers of the latest render.
  const intentHandlers = useRef(latest);
  intentHandlers.current = latest;
  const current = useRef(resource);
  current.current = resource;
  const binding = useRef<Binding | undefined>(undefined);
  const tail = useRef<Promise<unknown>>(Promise.resolve());
  function synchronize(value: Selected, signal?: AbortSignal): Promise<Binding> {
    const context = uiSelection(listOf(value));
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
    review: reviews.review,
    async prepare() {
      const bound = await synchronize(current.current);
      return { sessionId: bound.sessionId, version: bound.version };
    },
    acknowledgeReview: reviews.acknowledge,
  };
}
