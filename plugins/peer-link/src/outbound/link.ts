import { ApplicationError } from '@agent-native/contracts';
import { PeerCallError, type PeerClient, type PeerLink } from '@agent-native/integration';
import type { NetworkPort } from '@agent-native/kernel/plugin';
import { assertionLifetime, bodyDigest, requestLine, signSubjectAssertion } from '../assertion';
import { peerLinkOperations as ops, subjectHeader } from '../contracts';
import type { PeerCaller } from '../inbound/routes';
import type { OutboundTarget } from '../service';
import type { ConnectionSecret, ConnectionSecrets } from './secrets';

interface Held extends ConnectionSecret {
  readonly audience: string;
}

/** Headers a caller of the link may not set: the link alone authenticates. */
const reserved = new Set(['authorization', subjectHeader.toLowerCase(), 'cookie']);

/** A request body as bytes, so the assertion covers exactly what is sent. */
async function bytesOf(body: RequestInit['body']): Promise<Uint8Array> {
  if (body === undefined || body === null) return new Uint8Array();
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  throw new ApplicationError(
    'INTERNAL',
    'A call on behalf of a person sends a string, byte or blob body',
  );
}

export interface OutboundOptions {
  readonly targets: ReadonlyMap<string, OutboundTarget>;
  readonly secrets: ConnectionSecrets;
  readonly network: () => NetworkPort;
  readonly caller: () => PeerCaller | undefined;
  readonly now: () => number;
}

/**
 * The calling side's connections. Credentials and keys are held in memory once read from the
 * secret store, so `client()` answers at once; every request still reads the connection record,
 * so a removal applies to the next request and deletes the secret.
 */
export function createOutbound(options: OutboundOptions) {
  const held = new Map<string, Held>();

  async function current(target: string): Promise<Held | undefined> {
    const caller = options.caller();
    if (!caller) return undefined;
    const { data } = await caller.application.queryRaw(
      { operation: ops.connectionList.id, input: {} },
      caller.context,
    );
    const listed = (
      data as {
        targets: { target: string; connection: { peerId: string; audience: string } | null }[];
      }
    ).targets.find((entry) => entry.target === target)?.connection;
    const secret = held.get(target) ?? (await options.secrets.read(target));
    if (!listed || !secret || secret.peerId !== listed.peerId) {
      held.delete(target);
      // A secret without its record: removed, or left by a connect that did not finish.
      if (secret && !listed) await options.secrets.delete(target);
      return undefined;
    }
    const value = { ...secret, audience: listed.audience };
    held.set(target, value);
    return value;
  }

  function clientFor(
    target: string,
    subject?: { readonly sub: string; readonly run: boolean },
  ): PeerClient {
    const declared = options.targets.get(target);
    if (!declared) throw new Error(`${target} is not a peer target of this application`);
    const base = options.network().client(declared.destination);
    return {
      fetch: async (input, init = {}) => {
        const connection = await current(target);
        if (!connection)
          throw new PeerCallError(
            `No connection to ${target}; connect it on the peers screen`,
            'disconnected',
          );
        const headers: Record<string, string> = {};
        for (const [name, value] of new Headers(init.headers))
          if (!reserved.has(name)) headers[name] = value;
        headers.authorization = `Bearer ${connection.token}`;
        let body = init.body;
        if (subject) {
          const bytes = await bytesOf(init.body);
          // A GET has no body; its assertion covers the empty one.
          if (init.body !== undefined && init.body !== null)
            body = bytes as Uint8Array<ArrayBuffer>;
          const iat = Math.floor(options.now() / 1000);
          headers[subjectHeader.toLowerCase()] = await signSubjectAssertion(connection.privateKey, {
            aud: connection.audience,
            sub: subject.sub,
            act: subject.run ? 'agent' : 'person',
            req: requestLine(init.method ?? 'GET', new URL(String(input), 'http://peer.invalid')),
            body: await bodyDigest(bytes),
            iat,
            exp: iat + Math.min(60, assertionLifetime),
            jti: crypto.randomUUID().replaceAll('-', ''),
          });
        }
        // Redirects are errors, so neither the credential nor an assertion reaches another host.
        return base.fetch(input, {
          ...init,
          headers,
          ...(body === undefined ? {} : { body }),
          redirect: 'error',
        });
      },
    };
  }

  return {
    /** Keep a new connection's secret in memory after the connect route stored it. */
    hold(target: string, secret: ConnectionSecret, audience: string) {
      held.set(target, { ...secret, audience });
    },
    link(target: string): PeerLink {
      return {
        client: () => clientFor(target),
        onBehalfOf: (subject, settings) =>
          clientFor(target, { sub: subject, run: settings?.run ?? false }),
      };
    },
  };
}
export type Outbound = ReturnType<typeof createOutbound>;
