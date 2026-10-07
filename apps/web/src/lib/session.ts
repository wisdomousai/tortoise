import { QueryClient } from '@tanstack/react-query';
import { createClient, createHttpTransport } from '@agent-native/client';
import { createLiveBindings } from '@agent-native/react/query';

/**
 * One authenticated browser session: the HttpOnly session cookie identifies the principal, so
 * the transport carries no token. Cache and bindings live exactly as long as the page; a new
 * launch reloads the page and therefore starts with an empty cache.
 */
export const transport = createHttpTransport({ baseUrl: location.origin });
export const client = createClient(transport);
export const live = createLiveBindings(transport);
export const queryClient = new QueryClient();
