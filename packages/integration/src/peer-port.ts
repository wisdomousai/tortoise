import {
  isBlobRef,
  type BlobRef,
  type ErrorEnvelope,
  type JsonValue,
} from '@agent-native/contracts';
import type { Effect, EffectOutcome } from '@agent-native/runtime';
import { DeliveryFailure, type PullBatch, type SystemOfRecordPort } from './port.js';

/** A `fetch` bound to the peer's origin, as `NetworkPort.client` returns it. */
export interface PeerClient {
  readonly fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
}

export interface PeerPortOptions {
  /** The outbox target this port delivers, such as `hub`. */
  readonly target: string;
  /**
   * The client for the peer, asked on every call: pairing can happen after the port is built,
   * and a client that throws (not paired, unreachable) is a transient failure.
   */
  readonly client: () => PeerClient;
  /** A blob an effect reports with; the application's `readEffectBlob` for this workspace. */
  readonly readBlob: (
    effect: Readonly<Effect>,
    digest: string,
  ) => Promise<{ readonly ref: BlobRef; readonly data: Uint8Array } | undefined>;
  /**
   * The peer's feed query for inbound sync. It takes `{ cursor? }` and answers a `PullBatch`:
   * `{ items, cursor, more? }`. Without it the port does not pull.
   */
  readonly feed?: string;
}

/** Codes the peer answers for a business refusal; delivering again would get the same answer. */
const refusals = new Set([
  'INVALID_INPUT',
  'NOT_FOUND',
  'FORBIDDEN',
  'CONFLICT',
  'IDEMPOTENCY_CONFLICT',
]);

/** Every blob reference in a payload, once each, in payload order. */
export function payloadBlobs(payload: JsonValue): BlobRef[] {
  const found = new Map<string, BlobRef>();
  const visit = (value: JsonValue) => {
    if (isBlobRef(value)) found.set(value.digest, value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(payload);
  return [...found.values()];
}

async function call(client: PeerClient, path: string, init: RequestInit, signal: AbortSignal) {
  let response: Response;
  try {
    response = await client.fetch(path, { ...init, signal });
  } catch (error) {
    if (error instanceof DeliveryFailure) throw error;
    throw new DeliveryFailure('The peer is unreachable');
  }
  const body = (await response.json().catch(() => undefined)) as
    { readonly error?: ErrorEnvelope } | undefined;
  return { response, body, error: response.ok ? undefined : body?.error };
}

/** The peer refused the credential itself (see the HTTP adapter), not the operation. */
const refusedCredential = (error: ErrorEnvelope | undefined) =>
  error?.code === 'FORBIDDEN' &&
  typeof error.details === 'object' &&
  error.details !== null &&
  'credential' in error.details;
const isRefusal = (error: ErrorEnvelope | undefined): error is ErrorEnvelope =>
  !!error && refusals.has(error.code) && !refusedCredential(error);

/**
 * A missing or revoked credential is not the record's fault: keep it pending until the device is
 * paired again. Anything that is not a business refusal is retried.
 */
function failureOf(error: ErrorEnvelope | undefined): never {
  throw new DeliveryFailure(
    refusedCredential(error)
      ? 'The peer did not accept this device credential; pair the device again'
      : 'The peer could not accept the delivery now',
  );
}

const clientOf = (options: PeerPortOptions) => {
  try {
    return options.client();
  } catch {
    throw new DeliveryFailure(`No connection to ${options.target}; pair the device first`);
  }
};

/** The peer refused a blob for a business reason; the effect is settled as rejected. */
class BlobRefused extends Error {
  constructor(readonly envelope: ErrorEnvelope) {
    super(envelope.message);
  }
}

/** Upload each blob the payload references; the peer stores it by digest, so a retry is cheap. */
async function uploadBlobs(
  options: PeerPortOptions,
  client: PeerClient,
  effect: Readonly<Effect>,
  signal: AbortSignal,
) {
  for (const ref of payloadBlobs(effect.payload)) {
    const blob = await options.readBlob(effect, ref.digest);
    // The command would refuse an unknown digest; refusing here names the cause.
    if (!blob) throw new DeliveryFailure('A photo this record references is missing on the device');
    const { response, body, error } = await call(
      client,
      '/api/v1/blobs',
      {
        method: 'POST',
        headers: { 'Content-Type': blob.ref.mediaType },
        body: blob.data as Uint8Array<ArrayBuffer>,
      },
      signal,
    );
    if (isRefusal(error)) throw new BlobRefused(error);
    if (!response.ok) failureOf(error);
    if ((body as { digest?: string } | undefined)?.digest !== ref.digest)
      throw new DeliveryFailure('The peer stored a different blob than the record references');
  }
}

/**
 * The port to another agent-native host, such as a hub a field device is paired with. It speaks
 * the peer's own HTTP API with the credential the client carries, so the peer authorizes every
 * call as that device.
 *
 * - `deliver` uploads the blobs the effect's payload references, then invokes the peer command
 *   named by the effect's `type` with the payload as input and the effect id as idempotency key.
 *   The peer's receipts make a repeated delivery after a lost response return the first result,
 *   so delivery is idempotent.
 * - A business refusal from the peer (invalid input, not found, conflict, denied) settles the
 *   effect as `rejected` with the peer's code and message. A refused credential, an unreachable
 *   peer or a server error is a `DeliveryFailure` and is retried.
 * - `pull` reads the peer's feed query from the stored cursor.
 */
export function createPeerPort<Item = unknown>(options: PeerPortOptions): SystemOfRecordPort<Item> {
  return {
    describe: () => ({ target: options.target, idempotentDelivery: true }),
    async deliver(effect, signal): Promise<EffectOutcome> {
      const client = clientOf(options);
      try {
        await uploadBlobs(options, client, effect, signal);
      } catch (error) {
        if (error instanceof BlobRefused)
          return { status: 'rejected', code: error.envelope.code, message: error.envelope.message };
        throw error;
      }
      const { response, body, error } = await call(
        client,
        `/api/v1/commands/${encodeURIComponent(effect.type)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: effect.payload, idempotencyKey: effect.id }),
        },
        signal,
      );
      if (response.ok) {
        const receipt = body as { operation?: string; cursor?: number } | undefined;
        return {
          status: 'accepted',
          ...(receipt?.cursor === undefined
            ? {}
            : { externalRef: `${effect.type}@${receipt.cursor}` }),
        };
      }
      if (isRefusal(error)) return { status: 'rejected', code: error.code, message: error.message };
      return failureOf(error);
    },
    ...(options.feed
      ? {
          async pull(cursor: string | undefined, signal: AbortSignal): Promise<PullBatch<Item>> {
            const { response, body, error } = await call(
              clientOf(options),
              `/api/v1/queries/${encodeURIComponent(options.feed!)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ input: cursor === undefined ? {} : { cursor } }),
              },
              signal,
            );
            if (!response.ok) failureOf(error);
            return (body as { data: PullBatch<Item> }).data;
          },
        }
      : {}),
  };
}
