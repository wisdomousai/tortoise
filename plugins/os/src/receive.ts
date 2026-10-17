import {
  osPlatforms,
  type Catalog,
  type OsPlatform,
  type OsRefusal,
  type OsRequestOutcome,
  type RawOsRequest,
} from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import {
  matchOsRequest,
  OsRequestError,
  parseRawOsRequest,
  resolveTarget,
  type MatchOptions,
  type OsMatch,
} from '@agent-native/shell';
import type { OsAudit } from './audit';
import { digestOf } from './audit';
import type { OsDeclarationSet } from './declarations';

/**
 * A plugin's receiver for the handlers whose target names it. It gets the matched handler, the
 * values its templates may use and the raw request, as the session that submitted it, and
 * applies its own rules: a reply consumer, for example, accepts only a live nonce it issued.
 */
export type OsConsumer = (
  context: ExecutionContext,
  match: OsMatch,
  raw: RawOsRequest,
) => Promise<void>;

/**
 * A plugin's resolver for claim codes it issued: the request the code stands for, taken once,
 * as the session that claims it (a held file is staged in the blob store under that session).
 * `undefined` when the code is not this plugin's or is used or expired.
 */
export type OsHolder = (context: ExecutionContext, code: string) => Promise<unknown>;

export interface ReceiveDependencies {
  readonly declarations: OsDeclarationSet;
  readonly catalog: Catalog;
  readonly match: MatchOptions;
  readonly disabled: ReadonlySet<string>;
  readonly consumers: ReadonlyMap<string, OsConsumer>;
  readonly holders: readonly OsHolder[];
  readonly allow: (handler: string) => boolean;
  readonly audit: OsAudit;
}

async function claim(holders: readonly OsHolder[], context: ExecutionContext, code: string) {
  for (const holder of holders) {
    const held = await holder(context, code);
    if (held !== undefined) return held;
  }
  return undefined;
}

/**
 * Receive one OS request: check its syntax, match it to a handler, apply the site's disabled
 * list and the per-handler rate, and resolve its target. Every outcome is audited with the
 * request's digest and a reason code. An unsolicited request only becomes a delivery (open,
 * navigate, prepare); a consumer decides itself what a request it receives may do.
 */
export async function receiveOsRequest(
  dependencies: ReceiveDependencies,
  context: ExecutionContext,
  input: unknown,
  platform: OsPlatform,
): Promise<OsRequestOutcome> {
  const { audit } = dependencies;
  const digest = digestOf(input ?? null);
  const refuse = async (reason: OsRefusal, handler?: string): Promise<OsRequestOutcome> => {
    await audit.record(
      context,
      {
        kind: 'os.request.refused',
        reason,
        ...(handler ? { id: handler } : {}),
        ...(osPlatforms.includes(platform) ? { platform } : {}),
      },
      { digest },
    );
    return { status: 'refused', reason, ...(handler ? { handler } : {}) };
  };
  if (!osPlatforms.includes(platform)) return refuse('invalid');
  let raw: RawOsRequest;
  let match: OsMatch | undefined;
  try {
    raw = parseRawOsRequest(input);
    if (raw.kind === 'claim') {
      // The claim stands for input a plugin held without a session; this session takes it now,
      // and what it stands for is parsed and matched like any request.
      const held = await claim(dependencies.holders, context, raw.code);
      if (held === undefined) return refuse('invalid');
      raw = parseRawOsRequest(held);
      if (raw.kind === 'claim') return refuse('invalid');
    }
    match = matchOsRequest(dependencies.declarations.handlers, raw, dependencies.match);
  } catch (error) {
    if (error instanceof OsRequestError) return refuse(error.reason);
    throw error;
  }
  if (!match) return refuse('no-handler');
  const { handler } = match;
  if (dependencies.disabled.has(handler.id)) return refuse('disabled', handler.id);
  if (!dependencies.allow(handler.id)) return refuse('rate-limited', handler.id);
  let target: ReturnType<typeof resolveTarget>;
  try {
    target = resolveTarget(match, dependencies.catalog);
  } catch (error) {
    if (error instanceof OsRequestError) return refuse(error.reason, handler.id);
    throw error;
  }
  const accepted = () =>
    audit.record(
      context,
      { kind: 'os.request.received', id: handler.id, platform },
      { digest, handlerKind: handler.kind },
    );
  if ('consumer' in target) {
    const consume = dependencies.consumers.get(target.consumer);
    if (!consume) return refuse('unsupported', handler.id);
    await accepted();
    await consume(context, match, raw);
    return { status: 'consumed', handler: handler.id };
  }
  await accepted();
  return { status: 'delivered', handler: handler.id, delivery: target.delivery };
}
