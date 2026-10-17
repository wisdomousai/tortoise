import { ApplicationError } from '@agent-native/contracts';
import { jsonResponse, readJsonBody } from '@agent-native/adapters/http';
import type { HostRoute } from './types';
import { fencedCandidates } from './ui-sessions';

/**
 * The frame takes what OS requests from its own session asked it to show, and acknowledges each
 * once it opened or prefilled it, or could not.
 */
export const uiDeliveryRoute: HostRoute = async (request, url, session, host) => {
  if (url.pathname === '/api/v1/ui/deliveries' && request.method === 'GET')
    return fencedCandidates(request, session, host, () => host.uiDeliveries.poll(session));
  const ack = url.pathname.match(/^\/api\/v1\/ui\/deliveries\/([^/]+)\/ack$/);
  if (!ack || request.method !== 'POST') return undefined;
  const body = await readJsonBody(request);
  if (body.status !== 'accepted' && body.status !== 'rejected')
    throw new ApplicationError('INVALID_INPUT', 'Invalid delivery acknowledgement');
  host.uiDeliveries.acknowledge(session, ack[1]!, body.status);
  return jsonResponse({ acknowledged: true });
};
