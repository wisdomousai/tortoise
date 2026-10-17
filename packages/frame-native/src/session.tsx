import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient, type Transport } from '@agent-native/client';
import { createLiveBindings } from '@agent-native/react/query';

function createSession(transport: Transport) {
  return {
    transport,
    client: createClient(transport),
    live: createLiveBindings(transport),
    queryClient: new QueryClient(),
  };
}

/** The transport, client, live bindings and query cache of the open authority. */
export type NativeSession = ReturnType<typeof createSession>;

const SessionContext = createContext<NativeSession | undefined>(undefined);

function LiveInvalidation({ session }: { session: NativeSession }) {
  session.live.useLiveInvalidation(session.queryClient);
  return null;
}

/**
 * One session over `transport`. On the device the transport exists only once the authority is
 * open, so screens read it from context instead of a module, which is what the web frame does. A
 * new transport starts a new cache: a cache is never shared across authorities or principals.
 */
export function SessionProvider({
  transport,
  children,
}: {
  transport: Transport;
  children: ReactNode;
}) {
  const session = useMemo(() => createSession(transport), [transport]);
  return (
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={session.queryClient}>
        <LiveInvalidation session={session} />
        {children}
      </QueryClientProvider>
    </SessionContext.Provider>
  );
}

/** The session of the surrounding `SessionProvider`. Throws outside one. */
export function useSession(): NativeSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession needs a SessionProvider');
  return session;
}
