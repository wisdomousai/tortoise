import type { ErrorEnvelope } from '@agent-native/contracts';
import type { NetworkPort } from '@agent-native/host/plugin';
import { fleetEnrollPath } from './contracts';

/** The fleet did not answer, or answered with an error; the message says which. */
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

async function send(network: () => NetworkPort, path: string, init: RequestInit) {
  let response: Response;
  try {
    response = await network()
      .client('fleet')
      .fetch(path, { ...init, redirect: 'error' });
  } catch (error) {
    throw new FleetUnavailable(`The fleet is unreachable: ${(error as Error).message}`);
  }
  return response;
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => undefined)) as
    (T & { error?: ErrorEnvelope }) | undefined;
  if (!response.ok || !body)
    throw new FleetUnavailable(
      body?.error
        ? `The fleet refused: ${body.error.code} ${body.error.message}`
        : `The fleet answered ${response.status}`,
      body?.error?.code,
    );
  return body;
}

/**
 * The fleet's HTTP API with the site credential on every call. The credential is sent only to
 * the bound `fleet` origin (the network port resolves the path against it), and redirects are
 * errors, so it never reaches another host.
 */
export function fleetLink(network: () => NetworkPort, token: string): FleetLink {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  return {
    async command<T>(operation: string, input: unknown, idempotencyKey: string) {
      const response = await send(network, `/api/v1/commands/${encodeURIComponent(operation)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input, idempotencyKey }),
      });
      return (await json<{ result: T }>(response)).result;
    },
    async query<T>(operation: string, input: unknown = {}) {
      const response = await send(network, `/api/v1/queries/${encodeURIComponent(operation)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
      });
      return (await json<{ data: T }>(response)).data;
    },
    async blob(digest: string) {
      const response = await send(network, `/api/v1/blobs/${encodeURIComponent(digest)}`, {
        headers: { Authorization: headers.Authorization },
      });
      if (!response.ok) await json(response);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** Exchange a one-use enrollment code for the site's credential. */
export async function enroll(network: () => NetworkPort, code: string): Promise<string> {
  const response = await send(network, fleetEnrollPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const { token } = await json<{ token?: unknown }>(response);
  if (typeof token !== 'string' || !token)
    throw new FleetUnavailable('The fleet answered the enrollment without a credential');
  return token;
}
