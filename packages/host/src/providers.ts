import { realpath } from 'node:fs/promises';
import type { HostSession } from '@tortoise/adapters/http';
import type { ChatGptAccountConnection, ChatGptConnectionOptions } from '@tortoise/agents/chatgpt';
import { OsCredentialVault, type CredentialVault } from '@tortoise/agents/credentials';
import type { CodexOptions } from '@tortoise/agents/codex';
import type { ClaudeHarness } from '@tortoise/agents/claude';
import type { Harness } from '@tortoise/agents/types';
import { chatGptCallback } from './providers/callback';
import { createProviderHarnesses } from './providers/harnesses';
import { resolveSelection } from './providers/profiles';
import { routeProviders } from './providers/routes';
import { closeState, digest, type ProviderState } from './providers/state';

/** The ChatGPT account operations provider access uses; a fixture may replace the connection. */
export type Connection = Pick<
  ChatGptAccountConnection,
  'begin' | 'complete' | 'profiles' | 'credentials' | 'refresh' | 'logout'
>;
type ClaudeOptions = ConstructorParameters<typeof ClaudeHarness>[0];
export interface ProviderAccessOptions {
  readonly workspacePath: string;
  readonly origin: string | (() => string);
  readonly sessions: (token: string) => HostSession | undefined;
  readonly vault?: CredentialVault;
  readonly runtimeManifest?: string;
  readonly ownerPrincipalId?: string;
  readonly appName?: string;
  readonly now?: () => number;
  readonly fetch?: typeof fetch;
  /**
   * Environment for a declared provider child process (`codex-app-server`, `claude-code`),
   * normally the egress proxy settings. Never carries credentials.
   */
  readonly childEnvironment?: (processId: string) => Record<string, string>;
  /** Fixture seams do not discover ambient credentials or execute native providers. */
  readonly factories?: {
    readonly chatgpt?: (options: ChatGptConnectionOptions) => Connection;
    readonly codex?: (options: CodexOptions) => Harness;
    readonly claude?: (options: ClaudeOptions) => Harness;
    readonly aiSdk?: (options: { apiKey: string; model: string }) => Harness | Promise<Harness>;
  };
}
export interface ProviderSelection {
  readonly profileId?: string;
  readonly model: string;
  readonly providerAccount?: string;
}

/** Host-owned provider access. Status/availability never reads the OS vault. Explicit
 * profile loading, connection or key entry authorizes subsequent selected-run access. */
export async function createProviderAccess(options: ProviderAccessOptions) {
  const workspacePath = await realpath(options.workspacePath);
  const state: ProviderState = {
    options,
    workspacePath,
    vault: options.vault ?? new OsCredentialVault(`tortoise.${digest(workspacePath).slice(0, 32)}`),
    now: options.now ?? Date.now,
    // The only default network client; every provider request in providers/ goes through it.
    fetcher: options.fetch ?? fetch,
    appName: options.appName ?? 'tortoise-starter',
    connections: new Map(),
    profiles: new Map(),
    models: new Map(),
    selected: new Map(),
    loadedKeys: new Map(),
    pending: new Map(),
    closed: false,
  };
  const harnesses = createProviderHarnesses(state);
  return {
    harnesses,
    route: (request: Request, session: HostSession) =>
      routeProviders(state, harnesses, request, session),
    callback: (request: Request) => chatGptCallback(state, request),
    resolveSelection: (
      session: HostSession,
      body: { harnessId?: unknown; profileId?: unknown; model?: unknown },
    ) => resolveSelection(state, session, body),
    close: () => closeState(state),
  };
}
