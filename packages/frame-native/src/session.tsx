import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient, type Transport } from '@agent-native/client';
import { createLiveBindings } from '@agent-native/react/query';

/** Services the open instance's plugins expose, keyed by plugin id. */
export type PluginServices = Readonly<Record<string, unknown>>;

function createSession(transport: Transport, services: PluginServices) {
  return {
    transport,
    /**
     * In-process plugin services, such as pairing on the device. They are trusted code of this
     * app; a screen calls only the service of its own plugin and every write still goes through
     * the instance's commands.
     */
    services,
    client: createClient(transport),
    live: createLiveBindings(transport),
    queryClient: new QueryClient(),
  };
}

/** The transport, client, live bindings, query cache and plugin services of the open instance. */
export type NativeSession = ReturnType<typeof createSession>;

const noServices: PluginServices = {};
const SessionContext = createContext<NativeSession | undefined>(undefined);

function LiveInvalidation({ session }: { session: NativeSession }) {
  session.live.useLiveInvalidation(session.queryClient);
  return null;
}

/**
 * One session over `transport`. On the device the transport exists only once the instance is
 * open, so screens read it from context instead of a module, which is what the web frame does. A
 * new transport starts a new cache: a cache is never shared across instances or principals.
 */
export function SessionProvider({
  transport,
  services = noServices,
  children,
}: {
  transport: Transport;
  services?: PluginServices;
  children: ReactNode;
}) {
  const session = useMemo(() => createSession(transport, services), [transport, services]);
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
