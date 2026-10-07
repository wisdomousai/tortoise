import { useEffect, useRef, useState } from 'react';
import type { UiIntent } from '@agent-native/react';
import { hostJson } from './host-client';

type Resource = { id: string; revision: number } | undefined;
type Binding = { sessionId: string; version: number; key: string };

/** One ephemeral frontend session; updates serialize and run starts pin an exact version. */
export function useUiSession(resource: Resource, select: (resource: string) => Promise<void>) {
  const [sessionId, setSessionId] = useState<string>();
  const [review, setReview] = useState<{
    id: string;
    title: string;
    operations: readonly string[];
  }>();
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
        const result = binding.current
          ? await hostJson<{ sessionId: string; version: number }>(
              `ui/sessions/${binding.current.sessionId}`,
              { context, expectedVersion: binding.current.version },
              signal,
            )
          : await hostJson<{ sessionId: string; version: number }>('ui/sessions', context, signal);
        binding.current = { ...result, key };
        setSessionId(result.sessionId);
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
        const intents = await hostJson<{ id: string; intent: UiIntent }[]>(
          `ui/sessions/${bound.sessionId}/intents`,
          undefined,
          abort.signal,
        );
        for (const entry of intents) {
          if (entry.intent.type === 'requestReview')
            setReview({
              id: entry.id,
              title: entry.intent.title,
              operations: entry.intent.operations,
            });
          else {
            let status = 'accepted';
            try {
              await selected.current(entry.intent.resource);
            } catch {
              status = 'rejected';
            }
            await hostJson(
              `ui/sessions/${bound.sessionId}/ack`,
              { id: entry.id, status },
              abort.signal,
            );
          }
        }
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
