import type { Catalog } from '@agent-native/contracts';
import type {
  CommandReceipt,
  EventBatch,
  ExecutionContext,
  Invocation,
  QueryResult,
} from '@agent-native/runtime';

/** Minimal execution surface shared by all host adapters. No handler implementation lives here. */
export interface ApplicationPort {
  invokeRaw(request: Invocation, context: ExecutionContext): Promise<CommandReceipt>;
  queryRaw(request: Invocation, context: ExecutionContext): Promise<QueryResult>;
  events(after: number, context: ExecutionContext): Promise<EventBatch>;
  deliverEvents(
    after: number,
    context: ExecutionContext,
    deliver: (batch: EventBatch) => void,
  ): Promise<void>;
  discover(context: ExecutionContext): Catalog;
}

/**
 * Attach a per-request cancellation signal to a trusted context. A signal the launcher or host
 * already put on the context still applies: the result aborts when either does, so a request can
 * only narrow cancellation, never lift it.
 */
export function withSignal(context: ExecutionContext, signal?: AbortSignal): ExecutionContext {
  if (!signal) return context;
  return {
    ...context,
    signal: context.signal ? AbortSignal.any([context.signal, signal]) : signal,
  };
}
