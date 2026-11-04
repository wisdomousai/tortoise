import type { HostSession, Sessions } from '@tortoise/adapters/http';
import type { UiDeliveryStore } from '@tortoise/adapters/ui-deliveries';
import type { UiSessionStore } from '@tortoise/adapters/ui-sessions';
import type { createRunSupervisor } from '@tortoise/agents/supervisor';
import type { Harness } from '@tortoise/agents/types';
import type { BuildFacts } from '@tortoise/kernel/build';
import type { ShellPort } from '@tortoise/kernel/shell';
import type { HostedApplication } from '../../application';
import type { ShellRelay } from '../shell-relay';
import type { createProviderAccess } from '../../providers';

/** What the host's own API routes reach. Every route also receives the authenticated session. */
export interface HostRouteContext {
  readonly application: HostedApplication;
  readonly sessions: Sessions;
  readonly uiSessions: UiSessionStore;
  /** What OS requests asked each session's frame to show. */
  readonly uiDeliveries: UiDeliveryStore;
  /** The composed shell port; its default refuses every call. */
  readonly shell: ShellPort;
  readonly shellRelay: ShellRelay;
  readonly supervisor: ReturnType<typeof createRunSupervisor>;
  readonly providers: Awaited<ReturnType<typeof createProviderAccess>>;
  /** Harnesses the embedding process and the plugins added; they need no provider selection. */
  readonly harnesses?: readonly Harness[];
  /** When the running binary was built and its best-before date; absent for a run from source. */
  readonly build?: BuildFacts;
  readonly shutdown: {
    /** Present only when the local user is a trusted identity. */
    readonly localUserSession?: HostSession;
    readonly instance: string;
    close(): Promise<void>;
  };
}

/** A route returns a response, or `undefined` when the request is not its own. */
export type HostRoute = (
  request: Request,
  url: URL,
  session: HostSession,
  host: HostRouteContext,
) => Promise<Response | undefined>;
