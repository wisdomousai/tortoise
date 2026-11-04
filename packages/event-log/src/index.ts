/**
 * Append-only, hash-chained audit event log. Inject an `EventLogPort` into the runtime, network
 * guard, dispatcher and host to make each of them observable; nothing in the framework writes
 * audit events any other way. Server-only as a whole: the JSONL log and the verifier use the
 * filesystem. `chain`, `memory` and `forward` are portable on their own.
 */
export {
  digest,
  genesisHead,
  hashEvent,
  sealEvents,
  type ChainHead,
  type EventSource,
} from './chain';
export { createMemoryEventLog, type MemoryEventLog, type MemoryEventLogOptions } from './memory';
export {
  listSegments,
  EventLogLockedError,
  openJsonlEventLog,
  segmentName,
  type JsonlEventLog,
  type JsonlEventLogOptions,
} from './jsonl';
export {
  readEvents,
  unresolvedCommands,
  verifyEventLog,
  type ReadEventsOptions,
  type VerificationProblem,
  type VerificationReport,
  type VerifyOptions,
} from './verify';
export {
  forwardingEventLog,
  rfc5424,
  type EventSink,
  type ForwardingEventLog,
  type ForwardingStats,
} from './forward';
