import type { HostSession } from '@agent-native/adapters/http';
import { runRoute } from './runs';
import { shellRoute } from './shell';
import { shutdownRoute } from './shutdown';
import type { HostRoute, HostRouteContext } from './types';
import { uiDeliveryRoute } from './ui-deliveries';
import { uiSessionRoute } from './ui-sessions';

const routes: readonly HostRoute[] = [
  shutdownRoute,
  uiSessionRoute,
  uiDeliveryRoute,
  shellRoute,
  runRoute,
];

/** The host's own API: provider routes first, then shutdown, UI sessions, the shell and runs. */
export async function routeHostRequest(
  request: Request,
  session: HostSession,
  host: HostRouteContext,
): Promise<Response | undefined> {
  const providerResponse = await host.providers.route(request, session);
  if (providerResponse) return providerResponse;
  const url = new URL(request.url);
  for (const route of routes) {
    const response = await route(request, url, session, host);
    if (response) return response;
  }
  return undefined;
}

export type { HostRouteContext } from './types';
