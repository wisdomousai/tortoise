import { ApplicationError } from '@tortoise/contracts';
import { jsonResponse, readJsonBody } from '@tortoise/adapters/http';
import type { HostRoute } from './types';

/** Only the native host that owns this instance, holding the local-user token, may stop it. */
export const shutdownRoute: HostRoute = async (request, url, _session, host) => {
  if (url.pathname !== '/api/v1/shutdown' || request.method !== 'POST') return undefined;
  const body = await readJsonBody(request);
  const { localUserSession, instance } = host.shutdown;
  if (
    !localUserSession ||
    request.headers.get('authorization') !== `Bearer ${localUserSession.token}` ||
    body.instance !== instance
  )
    throw new ApplicationError('FORBIDDEN', 'Only the owning native host can stop this instance');
  setTimeout(() => void host.shutdown.close(), 25);
  return jsonResponse({ stopping: true });
};
