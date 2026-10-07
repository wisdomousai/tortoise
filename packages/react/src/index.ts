import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import {
  canonicalJson,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@agent-native/contracts';
import { createClient, LiveQuery, type CommandOptions, type Transport } from '@agent-native/client';

/** A typed React subscription to committed data. Keep drafts in separate component state. */
export function useLiveQuery<C extends AnyCapability>(
  transport: Transport,
  capability: C & { kind: 'query' },
  input: InputOf<C>,
) {
  const key = canonicalJson(input);
  const query = useMemo(
    () => new LiveQuery<OutputOf<C>>(transport, capability.id, JSON.parse(key)),
    [transport, capability.id, key],
  );
  return useSyncExternalStore(query.subscribe, query.getSnapshot, query.getSnapshot);
}

/** Commands carry revisions and idempotency through the same client used by agents. */
export function useCommand<C extends AnyCapability>(
  transport: Transport,
  capability: C & { kind: 'command' },
) {
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string>();
  const execute = useCallback(
    async (input: InputOf<C>, options?: CommandOptions) => {
      setPending((count) => count + 1);
      setError(undefined);
      try {
        return await createClient(transport).command(capability, input, options);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Command failed');
        throw cause;
      } finally {
        setPending((count) => count - 1);
      }
    },
    [transport, capability],
  );
  return { execute, pending: pending > 0, error };
}

export type UiIntent =
  | { type: 'openResource' | 'selectResource'; resource: string }
  | { type: 'requestReview'; title: string; operations: readonly string[] };
export interface UiContext {
  sessionId: string;
  selectedResources: readonly string[];
  observedRevisions: Readonly<Record<string, number>>;
}
/** UI context is an explicit immutable target snapshot, never ambient authority. */
export function captureUiContext(context: UiContext): UiContext {
  return structuredClone(context);
}

/** Host-independent session routing. No durable business writes occur through intents. */
export class UiSessions {
  private sessions = new Map<
    string,
    { context: UiContext; handle: (intent: UiIntent) => Promise<'accepted' | 'rejected'> }
  >();
  register(
    context: UiContext,
    handle: (intent: UiIntent) => Promise<'accepted' | 'rejected'>,
  ): () => void {
    const entry = { context: captureUiContext(context), handle };
    this.sessions.set(context.sessionId, entry);
    return () => {
      if (this.sessions.get(context.sessionId) === entry) this.sessions.delete(context.sessionId);
    };
  }
  capture(sessionId: string): UiContext | undefined {
    const entry = this.sessions.get(sessionId);
    return entry ? captureUiContext(entry.context) : undefined;
  }
  async send(
    sessionId: string,
    intent: UiIntent,
  ): Promise<'accepted' | 'rejected' | 'unavailable'> {
    return (await this.sessions.get(sessionId)?.handle(intent)) ?? 'unavailable';
  }
}
