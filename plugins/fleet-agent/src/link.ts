import type { NetworkPort } from '@tortoise/host/plugin';
import { createPeerCall, PeerCallError } from '@tortoise/integration/peer-call';
import { fleetEnrollPath } from './contracts';

/** The fleet did not respond, or responded with an error; the message says which. */
export class FleetUnavailable extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'FleetUnavailable';
  }
}

/** Calls to the fleet as this site, through the network port's `fleet` destination. */
export interface FleetLink {
  command<T>(operation: string, input: unknown, idempotencyKey: string): Promise<T>;
  query<T>(operation: string, input?: unknown): Promise<T>;
  blob(digest: string): Promise<Uint8Array>;
}

/** Keep the fleet's wording of each failure; the site's status screen shows it. */
async function asFleet<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof PeerCallError)) throw error;
    if (error.kind !== 'responded')
      throw new FleetUnavailable(`The fleet is unreachable: ${error.message}`);
    throw new FleetUnavailable(
      error.envelope ? `The fleet refused: ${error.message}` : `The fleet ${error.message}`,
      error.code,
    );
  }
}

const fleetCall = (network: () => NetworkPort, token?: string) =>
  createPeerCall({
    client: () => network().client('fleet'),
    ...(token ? { headers: () => ({ Authorization: `Bearer ${token}` }) } : {}),
  });

/**
 * The fleet's HTTP API with the site credential on every call. The credential is sent only to
 * the bound `fleet` origin (the network port resolves the path against it), and redirects are
 * errors, so it never reaches another host.
 */
export function fleetLink(network: () => NetworkPort, token: string): FleetLink {
  const peer = fleetCall(network, token);
  return {
    command: async <T>(operation: string, input: unknown, idempotencyKey: string) =>
      (await asFleet(() => peer.command<T>(operation, input, idempotencyKey))).result,
    query: <T>(operation: string, input: unknown = {}) =>
      asFleet(() => peer.query<T>(operation, input)),
    blob: (digest: string) => asFleet(() => peer.blob(digest)),
  };
}

/** Exchange a one-use enrollment code for the site's credential. */
export async function enroll(network: () => NetworkPort, code: string): Promise<string> {
  const { token } = await asFleet(() =>
    fleetCall(network).post<{ token?: unknown }>(fleetEnrollPath, { code }),
  );
  if (typeof token !== 'string' || !token)
    throw new FleetUnavailable('The fleet returned no credential for the enrollment');
  return token;
}
