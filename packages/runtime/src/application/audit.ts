import { createHash } from 'node:crypto';
import {
  ApplicationError,
  canonicalJson,
  type AnyCapability,
  type AuditRecord,
  type AuditRequirement,
  type EventLogPort,
  type JsonObject,
} from '@agent-native/contracts';
import type { Effect, ExecutionContext } from '../types.js';

/** Bounded, framework-generated error text; free text from handlers never reaches the log. */
const safeMessage = (error: unknown) =>
  error instanceof ApplicationError ? error.message.slice(0, 200) : 'Unexpected failure';

/** Appends to the optional event log; every other runtime module records through this. */
export function createAuditTrail(eventLog: EventLogPort | undefined) {
  /**
   * Append audit records. In `required` mode a failed append throws UNAVAILABLE so the caller
   * aborts; in `best-effort` mode it is swallowed and the gap shows up in verification instead.
   */
  async function append(requirement: AuditRequirement, records: readonly AuditRecord[]) {
    if (!eventLog || records.length === 0) return;
    try {
      await eventLog.append(records);
    } catch {
      if (requirement === 'required')
        throw new ApplicationError('UNAVAILABLE', 'Audit log unavailable');
    }
  }
  return {
    enabled: eventLog !== undefined,
    commandMode: (): AuditRequirement => eventLog?.mode.commands ?? 'best-effort',
    queryMode: (): AuditRequirement => eventLog?.mode.queries ?? 'best-effort',
    append,
    /** Audit after an action already took effect: it cannot be undone, so never throw. */
    after: (records: readonly AuditRecord[]) =>
      append('best-effort', records).catch(() => undefined),
  };
}
export type AuditTrail = ReturnType<typeof createAuditTrail>;

export const actorOf = (context: ExecutionContext) => ({
  principalId: context.principalId,
  workspaceId: context.workspaceId,
  ...(context.runId === undefined ? {} : { runId: context.runId }),
  ...(context.channel === undefined ? {} : { via: context.channel }),
});

/**
 * Inputs are logged as a digest plus field names. Only fields the capability allow-lists in
 * `audit.fields` appear in plain text. A digest of a low-entropy input can be guessed, so the
 * log itself remains confidential.
 */
export function describeInput(capability: AnyCapability, input: unknown) {
  const object =
    input !== null && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : undefined;
  const allowed = Object.fromEntries(
    (capability.audit?.fields ?? [])
      .filter((field) => object && Object.hasOwn(object, field))
      .map((field) => [field, object![field]]),
  ) as JsonObject;
  return {
    inputDigest: createHash('sha256').update(canonicalJson(input)).digest('hex'),
    data: {
      fields: object ? Object.keys(object).sort() : [],
      ...(Object.keys(allowed).length ? { values: allowed } : {}),
    } as JsonObject,
  };
}

export function failureRecord(
  kind: 'command' | 'query',
  operation: string,
  context: ExecutionContext,
  correlationId: string,
  error: unknown,
): AuditRecord {
  const code = error instanceof ApplicationError ? error.code : 'INTERNAL';
  return {
    kind: `${kind}.${code === 'FORBIDDEN' ? 'denied' : 'failed'}`,
    outcome: code === 'FORBIDDEN' ? 'denied' : 'failed',
    operation,
    actor: actorOf(context),
    correlationId,
    reason: code,
    data: { message: safeMessage(error) },
  };
}

export function effectRecords(
  effects: readonly Effect[],
  context: ExecutionContext,
  correlationId: string,
): AuditRecord[] {
  return effects.map((effect) => ({
    // Enqueued effects have no attempts yet; a held effect always has one, so a pending effect
    // with attempts that a command touched was released.
    kind:
      effect.status !== 'pending'
        ? 'effect.settled'
        : effect.attempts === 0
          ? 'effect.enqueued'
          : 'effect.released',
    outcome: 'info',
    operation: effect.operation,
    resources: [effect.resource],
    actor: actorOf(context),
    correlationId,
    data: {
      effectId: effect.id,
      target: effect.target,
      type: effect.type,
      ...(effect.outcome ? { status: effect.outcome.status } : {}),
      ...(effect.status === 'cancelled' ? { status: 'cancelled' } : {}),
      ...(effect.outcome?.status === 'rejected' ? { code: effect.outcome.code } : {}),
    },
  }));
}
