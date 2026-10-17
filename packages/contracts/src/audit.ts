import type { JsonObject } from './json';

/**
 * Audit event envelope shared by the event-log port, its adapters, verifiers and UI. It is
 * browser-safe data so a posture screen can render events without loading the log adapter.
 *
 * Events carry references and digests, never business payloads: input values appear only for
 * fields a capability lists in `audit.fields`, and egress events never contain bodies. A log is
 * evidence about the authority; it does not replace the committed journal or receipts.
 */

/** Which surface carried the request. Derived by the host, never supplied by the caller. */
export type AuditChannel =
  'direct' | 'http' | 'mcp' | 'cli' | 'embedded' | 'integration' | 'harness' | 'host' | 'shell';

export type AuditOutcome =
  | 'accepted'
  | 'committed'
  | 'recovered'
  | 'aborted'
  | 'denied'
  | 'failed'
  | 'allowed'
  | 'completed'
  | 'info';

export interface AuditActor {
  readonly principalId: string;
  readonly workspaceId?: string;
  readonly runId?: string;
  readonly via?: AuditChannel;
}

/** What an emitter supplies. The log assigns `seq`, `at` (if absent), `source`, `prev` and `hash`. */
export interface AuditRecord {
  /** Dotted, lower-case kind, e.g. `command.committed`, `egress.denied`. */
  readonly kind: string;
  readonly outcome: AuditOutcome;
  readonly at?: number;
  readonly actor?: AuditActor;
  readonly operation?: string;
  readonly resources?: readonly string[];
  /** Safe reason code (an `ErrorCode` or a guard reason); never free text from a remote party. */
  readonly reason?: string;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly cursor?: number;
  /** SHA-256 of the canonical JSON input. Lets an auditor match a request without storing it. */
  readonly inputDigest?: string;
  readonly data?: JsonObject;
}

export interface AuditEvent extends AuditRecord {
  readonly seq: number;
  readonly at: number;
  readonly source: { readonly component: string; readonly instance: string };
  /** Hash of the previous event in the chain, or the genesis value for the first event. */
  readonly prev: string;
  /** SHA-256 over `prev` and the canonical JSON of this event without `hash`. */
  readonly hash: string;
}

export const AUDIT_GENESIS = '0'.repeat(64);
const kindPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
export function isAuditKind(kind: string): boolean {
  return kindPattern.test(kind);
}

/**
 * The event kinds the framework emits. Applications may add kinds in their own namespace; the
 * control catalog references these as runtime evidence.
 */
export const auditEventKinds = {
  'command.accepted': 'A command passed final authorization and is about to commit.',
  'command.committed': 'A command committed; carries the journal cursor.',
  'command.replayed': 'An idempotent retry returned the stored receipt; nothing new committed.',
  'command.recovered': 'Startup resolved an accepted command against the receipt store.',
  'command.aborted': 'An accepted command left no receipt and did not commit.',
  'command.denied': 'Authorization or grant checks refused a command.',
  'command.failed': 'A command failed validation, conflicted or errored without committing.',
  'query.executed': 'A query returned authorized data.',
  'query.denied': 'Authorization or grant checks refused a query.',
  'effect.enqueued': 'A command committed an outbox effect.',
  'effect.attempted': 'A delivery attempt failed transiently and will be retried.',
  'effect.held': 'An uncertain delivery is held for operator reconciliation.',
  'effect.released': 'A held effect was released for redelivery.',
  'effect.settled': 'The target accepted or rejected an effect.',
  'egress.allowed': 'The egress guard opened a declared, bound connection.',
  'egress.denied': 'The egress guard refused an undeclared, unbound or disallowed connection.',
  'egress.completed': 'A guarded request finished; carries status, size and duration.',
  'session.created': 'The host issued a browser or process session.',
  'session.revoked': 'A session ended or was revoked.',
  'grant.issued': 'A delegated grant was bound to a run or connection.',
  'run.started': 'A harness run started under a delegated grant.',
  'run.ended': 'A harness run finished, failed, was cancelled or interrupted.',
  'config.loaded': 'The host started; carries binary, catalog and site-policy digests.',
  'policy.loaded': 'A site policy was validated and applied.',
  'posture.checked': 'A periodic security posture check completed.',
  'log.opened': 'An event log segment was opened or resumed.',
  'log.checkpoint': 'A checkpoint recorded the chain head.',
  'blob.stored': 'A caller uploaded a blob into the workspace staging area.',
  'blob.read': 'A caller read a blob through a resource it may read.',
  'blob.denied': 'A blob upload or read was refused.',
  'os.request.received': 'An OS request matched a declared handler and was routed to its target.',
  'os.request.refused': 'An OS request matched no enabled handler or failed validation.',
  'os.action.performed': 'A declared OS action was handed to the shell.',
  'os.action.refused': 'An OS action was undeclared, disabled, malformed or had no shell.',
} as const;
export type FrameworkAuditKind = keyof typeof auditEventKinds;

/**
 * Whether an unwritable log blocks the audited action. `required` fails closed: the command does
 * not commit, the query returns no data and the connection does not open. `best-effort` proceeds
 * and the gap becomes visible through the verifier and posture checks.
 */
export type AuditRequirement = 'required' | 'best-effort';
export interface AuditMode {
  readonly commands: AuditRequirement;
  readonly queries: AuditRequirement;
  readonly egress: AuditRequirement;
}
export const failClosedAuditMode: AuditMode = Object.freeze({
  commands: 'required',
  queries: 'required',
  egress: 'required',
});

/**
 * Append-only audit sink injected into the runtime, egress guard, dispatcher and host. Appends
 * are ordered: resolved events carry consecutive `seq` values and one hash chain. A rejected
 * promise means none of the records is durable. Implementations must not block on the network
 * while the caller holds a storage transaction; forward to remote sinks after the local append.
 */
export interface EventLogPort {
  readonly mode: AuditMode;
  append(records: readonly AuditRecord[]): Promise<readonly AuditEvent[]>;
}
