import {
  ApplicationError,
  isBlobRef,
  type ErrorCode,
  type BlobRef,
  type ErrorEnvelope,
  type JsonValue,
} from '@agent-native/contracts';
import type { Effect, EffectOutcome } from '@agent-native/runtime';
import { createPeerCall, PeerCallError, type PeerCall, type PeerClient } from './peer-call.js';
import type { PeerDrift } from './peer/drift.js';
import {
  DeliveryFailure,
  DeliveryUncertain,
  type PullBatch,
  type SearchPage,
  type SystemOfRecordPort,
} from './port.js';

export type { PeerClient } from './peer-call.js';

export interface PeerPortOptions {
  /** The outbox target this port delivers, such as `hub`. */
  readonly target: string;
  /**
   * The client for the peer, asked on every call: pairing can happen after the port is built,
   * and a client that throws (not paired, unreachable) is a transient failure. A delivery passes
   * its effect, so a peer link can deliver it on behalf of the person who enqueued it.
   */
  readonly client: (effect?: Readonly<Effect>) => PeerClient;
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
  /**
   * The external reference of an accepted delivery, read from the peer command's result, such as
   * the ID of the record it created. Without it an accepted outcome carries none.
   */
  readonly reference?: (result: unknown, effect: Readonly<Effect>) => string | undefined;
  /**
   * The comparison with the peer's contract (`createPeerDrift`). A delivery or pull to an
   * operation that drifted stays pending, and a peer's `INVALID_INPUT` checks the contract again.
   */
  readonly drift?: PeerDrift;
}

/**
 * Codes the peer answers for a business refusal; delivering again would get the same answer.
 * `IDEMPOTENCY_CONFLICT` is not one: the peer holds a different command under the effect's key,
 * so whether this effect was applied is unknown, and the effect is held.
 */
const refusals = new Set(['INVALID_INPUT', 'NOT_FOUND', 'FORBIDDEN', 'CONFLICT']);

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

/** The peer refused the credential itself (see the HTTP adapter), not the operation. */
const refusedCredential = (error: ErrorEnvelope | undefined) => detail(error, 'credential');
/**
 * The peer refused the signed subject assertion an on-behalf-of call carries. An expired or
 * replayed assertion is signed again on the next attempt; an unmapped subject waits until the
 * peer maps the person.
 */
const refusedAssertion = (error: ErrorEnvelope | undefined) => detail(error, 'assertion');
function detail(error: ErrorEnvelope | undefined, key: string): string | undefined {
  if (error?.code !== 'FORBIDDEN' || typeof error.details !== 'object' || error.details === null)
    return undefined;
  const value = (error.details as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : value === undefined ? undefined : String(value);
}
const isRefusal = (error: ErrorEnvelope | undefined): error is ErrorEnvelope =>
  !!error && refusals.has(error.code) && !refusedCredential(error) && !refusedAssertion(error);

/**
 * Map a call that failed to the dispatcher's terms. A missing or revoked credential and a refused
 * assertion are not the record's fault: the effect stays pending with a message saying why.
 * Anything that is not a business refusal is retried.
 */
function failureOf(options: PeerPortOptions, error: unknown): never {
  if (!(error instanceof PeerCallError)) throw error;
  if (error.kind === 'disconnected')
    throw new DeliveryFailure(`No connection to ${options.target}; pair the device first`);
  if (error.kind === 'unreachable') throw new DeliveryFailure('The peer is unreachable');
  if (error.code === 'IDEMPOTENCY_CONFLICT')
    throw new DeliveryUncertain(
      `${options.target} holds a different command under this effect's key`,
    );
  if (refusedCredential(error.envelope))
    throw new DeliveryFailure(
      'The peer did not accept this device credential; pair the device again',
    );
  const assertion = refusedAssertion(error.envelope);
  if (assertion === 'unmapped')
    throw new DeliveryFailure(
      `${options.target} maps no person to the caller; ask its owner to map them`,
    );
  if (assertion)
    throw new DeliveryFailure(`${options.target} refused the subject assertion (${assertion})`);
  throw new DeliveryFailure('The peer could not accept the delivery now');
}

/** Run a call; a business refusal comes back as the rejection it settles the effect with. */
async function attempt<T>(
  options: PeerPortOptions,
  run: () => Promise<T>,
): Promise<{ value: T } | { rejected: ErrorEnvelope }> {
  try {
    return { value: await run() };
  } catch (error) {
    if (error instanceof PeerCallError && isRefusal(error.envelope))
      return { rejected: error.envelope };
    return failureOf(options, error);
  }
}

/** Upload each blob the payload references; the peer stores it by digest, so a retry is cheap. */
async function uploadBlobs(
  options: PeerPortOptions,
  peer: PeerCall,
  effect: Readonly<Effect>,
  signal: AbortSignal,
): Promise<ErrorEnvelope | undefined> {
  for (const ref of payloadBlobs(effect.payload)) {
    const blob = await options.readBlob(effect, ref.digest);
    // The command would refuse an unknown digest; refusing here names the cause.
    if (!blob) throw new DeliveryFailure('A photo this record references is missing on the device');
    const stored = await attempt(options, () => peer.upload(blob.ref.mediaType, blob.data, signal));
    if ('rejected' in stored) return stored.rejected;
    if (stored.value !== ref.digest)
      throw new DeliveryFailure('The peer stored a different blob than the record references');
  }
  return undefined;
}

const rejection = (error: ErrorEnvelope): EffectOutcome => ({
  status: 'rejected',
  code: error.code,
  message: error.message,
});

/**
 * The port to another agent-native host, such as a hub a field device is paired with. It speaks
 * the peer's own HTTP API with the credential the client carries, so the peer authorizes every
 * call as that caller.
 *
 * - `deliver` uploads the blobs the effect's payload references, then invokes the peer command
 *   named by the effect's `type` with the payload as input and the effect id as idempotency key.
 *   The peer's receipts make a repeated delivery after a lost response return the first result,
 *   so delivery is idempotent. `reference` names the external reference from that result.
 * - A business refusal from the peer (invalid input, not found, conflict, denied) settles the
 *   effect as `rejected` with the peer's code and message. A refused credential or assertion, an
 *   unreachable peer or a server error is a `DeliveryFailure` and is retried. An idempotency
 *   conflict holds the effect for reconciliation.
 * - `pull` reads the peer's feed query from the stored cursor.
 * - `search` answers a remote query with the peer query of the same ID, which returns
 *   `{ items, next? }`.
 */
export function createPeerPort<Item = unknown>(options: PeerPortOptions): SystemOfRecordPort<Item> {
  const service = createPeerCall({ client: () => options.client() });
  /** Wait while the operation drifted; the next check after the peer's change clears it. */
  async function current(operation: string) {
    if (!options.drift) return;
    await options.drift.check();
    if (options.drift.blocked(operation))
      throw new DeliveryFailure(
        `${operation} changed on ${options.target}; calls wait until the two applications agree`,
      );
  }
  return {
    describe: () => ({ target: options.target, idempotentDelivery: true }),
    async deliver(effect, signal): Promise<EffectOutcome> {
      await current(effect.type);
      const peer = createPeerCall({ client: () => options.client(effect) });
      const refused = await uploadBlobs(options, peer, effect, signal);
      if (refused) return rejection(refused);
      const sent = await attempt(options, () =>
        peer.command(effect.type, effect.payload, effect.id, signal),
      );
      if ('rejected' in sent) {
        // Input the peer refuses may mean its contract changed: if so, the effect waits.
        if (sent.rejected.code === 'INVALID_INPUT' && options.drift) {
          options.drift.invalidate();
          await current(effect.type);
        }
        return rejection(sent.rejected);
      }
      const externalRef = options.reference?.(sent.value.result, effect);
      return { status: 'accepted', ...(externalRef ? { externalRef } : {}) };
    },
    async search(request, _access, signal): Promise<SearchPage> {
      try {
        await current(request.operation);
        const page = await service.query<SearchPage>(request.operation, request.query, signal);
        return { items: page.items, ...(page.next ? { next: page.next } : {}) };
      } catch (error) {
        // The peer's refusal, such as a cursor it no longer accepts, reaches the caller as is.
        if (error instanceof PeerCallError && isRefusal(error.envelope))
          throw new ApplicationError(error.envelope.code as ErrorCode, error.envelope.message);
        return failureOf(options, error);
      }
    },
    ...(options.feed
      ? {
          async pull(cursor: string | undefined, signal: AbortSignal): Promise<PullBatch<Item>> {
            await current(options.feed!);
            try {
              return await service.query<PullBatch<Item>>(
                options.feed!,
                cursor === undefined ? {} : { cursor },
                signal,
              );
            } catch (error) {
              return failureOf(options, error);
            }
          },
        }
      : {}),
  };
}
