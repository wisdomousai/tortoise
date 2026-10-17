import type { HostSession, Sessions } from '@agent-native/adapters/http';
import type { UiDeliveryStore } from '@agent-native/adapters/ui-deliveries';
import type { UiSessionStore } from '@agent-native/adapters/ui-sessions';
import type { createRunSupervisor } from '@agent-native/agents/supervisor';
import type { Harness } from '@agent-native/agents/types';
import type { ShellPort } from '@agent-native/kernel/shell';
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
  /** Harnesses the embedding process added; they need no provider selection. */
  readonly harnesses?: readonly Harness[];
  readonly shutdown: {
    /** Present only when the local owner is a trusted identity. */
    readonly ownerSession?: HostSession;
    readonly instance: string;
    close(): Promise<void>;
  };
}

/** A route answers with a response, or `undefined` when the request is not its own. */
export type HostRoute = (
  request: Request,
  url: URL,
  session: HostSession,
  host: HostRouteContext,
) => Promise<Response | undefined>;
