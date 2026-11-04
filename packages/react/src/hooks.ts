import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  canonicalJson,
  type AnyCapability,
  type InputOf,
  type OutputOf,
} from '@tortoise/contracts';
import { createClient, LiveQuery, type CommandOptions, type Transport } from '@tortoise/client';

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

/**
 * `value` once it has stayed unchanged for `delay` milliseconds, so a search box or filter sends
 * one query per pause rather than one per keystroke.
 */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
