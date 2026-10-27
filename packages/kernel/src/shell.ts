import {
  ApplicationError,
  type OsActionOutcome,
  type OsActionRequest,
  type OsActionResult,
  type OsInstruction,
  type OsPlatform,
  type OsRequestOutcome,
  type RawOsRequest,
} from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';

/**
 * Platform code that talks to the operating system: Electron main, a browser page, the Expo
 * runtime. It performs instructions the shell port built from declarations; it never decides
 * what may be performed.
 */
export interface ShellAdapter {
  readonly platform: OsPlatform;
  /** Run one instruction. Rejects or returns `ok: false` when the OS refused it. */
  perform(instruction: OsInstruction): Promise<OsActionResult>;
}

/**
 * The kernel port between the application and the operating system: requests the OS delivers
 * under declared OS handlers, and declared OS actions the application asks the OS to perform.
 * Without a plugin that provides it, every call throws UNAVAILABLE.
 *
 * Trust boundary: `raw` comes from an unauthenticated sender on the device. The context is the
 * session that submitted it, which only says where to deliver; the request never sets the
 * principal, workspace or grant, and an unsolicited request never commits a command.
 */
export interface ShellPort {
  /** Match `raw` to a handler and route it to its target. Refusals are outcomes, not errors. */
  receive(
    context: ExecutionContext,
    raw: RawOsRequest,
    platform: OsPlatform,
  ): Promise<OsRequestOutcome>;
  /**
   * Check and build a declared action as `context`, then relay it to the adapter attached for
   * that principal, or return the instruction for the caller to run when none is.
   */
  perform(context: ExecutionContext, request: OsActionRequest): Promise<OsActionOutcome>;
  /** Attach an adapter for `context`'s principal until the returned function is called. */
  attach(context: ExecutionContext, adapter: ShellAdapter): () => void;
}

const unavailable = () =>
  new ApplicationError(
    'UNAVAILABLE',
    'The operating system is unreachable: this application composes no plugin that provides the shell port',
  );

/** No OS integration: nothing is received, performed or attached. */
export const noShell: ShellPort = Object.freeze({
  receive: async () => Promise.reject(unavailable()),
  perform: async () => Promise.reject(unavailable()),
  attach: () => {
    throw unavailable();
  },
});
