import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { z } from 'zod';
import { createClient, createHttpTransport } from '@agent-native/client';
import { createLiveBindings, type LiveBindings } from '@agent-native/react/query';
import type { operatorSessionSchema } from '../contracts';

export type OperatorSessionRecord = z.infer<typeof operatorSessionSchema>;

/** The signed-in operator's session at the terminal, and a client that acts as that operator. */
export interface OperatorSession {
  readonly session: OperatorSessionRecord;
  readonly client: ReturnType<typeof createClient>;
  readonly live: LiveBindings;
  /** Ends the session at the host and returns the terminal to sign-in. */
  readonly signOut: () => void;
}

const Context = createContext<OperatorSession | undefined>(undefined);

/**
 * The operator's session for the screen the terminal shows while someone is signed in. Its client
 * sends the operator token as a bearer, which the host prefers over the terminal's session cookie, so
 * every query and command acts as the operator.
 */
export function useOperatorSession(): OperatorSession {
  const session = useContext(Context);
  if (!session) throw new Error('useOperatorSession is used outside a signed-in terminal');
  return session;
}

/**
 * Holds the operator token in memory only, with its own transport, live bindings and query cache,
 * so nothing the operator read stays cached for the terminal or the next operator. A response that
 * rejects the credential, after a sign-out elsewhere, a revoked badge or an expiry, ends the
 * session here too.
 */
export function OperatorSessionProvider({
  token,
  session,
  signOut,
  onRejected,
  children,
}: {
  token: string;
  session: OperatorSessionRecord;
  signOut: () => void;
  onRejected: () => void;
  children: ReactNode;
}) {
  // Read at call time, so a new callback from the terminal screen never rebuilds the client.
  const callbacks = useRef({ signOut, onRejected });
  callbacks.current = { signOut, onRejected };
  const value = useMemo(() => {
    const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, init);
      if (response.status === 403) {
        const body = (await response
          .clone()
          .json()
          .catch(() => undefined)) as { error?: { details?: { credential?: string } } } | undefined;
        if (body?.error?.details?.credential === 'rejected') callbacks.current.onRejected();
      }
      return response;
    }) as typeof fetch;
    const transport = createHttpTransport({ baseUrl: location.origin, token, fetch: request });
    return {
      operator: {
        session,
        client: createClient(transport),
        live: createLiveBindings(transport),
        signOut: () => callbacks.current.signOut(),
      },
      queryClient: new QueryClient(),
    };
  }, [token, session]);
  useEffect(() => () => value.queryClient.clear(), [value]);
  value.operator.live.useLiveInvalidation(value.queryClient);
  return (
    <QueryClientProvider client={value.queryClient}>
      <Context.Provider value={value.operator}>{children}</Context.Provider>
    </QueryClientProvider>
  );
}
