import { createHash } from 'node:crypto';
import { ApplicationError, canonicalJson } from '@tortoise/contracts';
import type { HostSession } from '@tortoise/adapters/http';
import { ChatGptAccountConnection, type ChatGptProfile } from '@tortoise/agents/chatgpt';
import type { CredentialVault } from '@tortoise/agents/credentials';
import type { Connection, ProviderAccessOptions } from '../providers';

export interface SessionSelection {
  profileId?: string;
  model?: string;
}
export interface ModelSummary {
  id: string;
  title: string;
}

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Everything provider access remembers, keyed by owner scope (`[workspaceId, principalId]`) or
 * by session token. Lives in memory only; `close` clears it and refuses further use.
 */
export interface ProviderState {
  readonly options: ProviderAccessOptions;
  readonly workspacePath: string;
  readonly vault: CredentialVault;
  readonly now: () => number;
  readonly fetcher: typeof fetch;
  readonly appName: string;
  readonly connections: Map<string, Connection>;
  readonly profiles: Map<string, Map<string, ChatGptProfile>>;
  readonly models: Map<string, ModelSummary[]>;
  readonly selected: Map<string, SessionSelection>;
  readonly loadedKeys: Map<string, Set<'claude' | 'ai-sdk'>>;
  readonly pending: Map<string, { token: string; scope: string; expiresAt: number }>;
  closed: boolean;
}

export const originOf = (state: ProviderState) =>
  typeof state.options.origin === 'string' ? state.options.origin : state.options.origin();

/** Only the local owner, acting without a delegation, manages provider access. */
export function scopeOf(
  state: ProviderState,
  context: { principalId?: unknown; workspaceId?: unknown; grant?: unknown },
): string {
  if (
    context.principalId !== (state.options.ownerPrincipalId ?? 'owner') ||
    typeof context.workspaceId !== 'string' ||
    !context.workspaceId ||
    context.grant !== undefined
  )
    throw new ApplicationError('FORBIDDEN', 'Only the local owner can manage provider access');
  return canonicalJson([context.workspaceId, context.principalId]);
}

/** The owner scope of a session that is still active, rechecked after every await. */
export function liveScope(state: ProviderState, session: HostSession): string {
  const current = state.options.sessions(session.token);
  if (
    state.closed ||
    !current ||
    current.expiresAt <= state.now() ||
    scopeOf(state, current.context) !== scopeOf(state, session.context)
  )
    throw new ApplicationError('FORBIDDEN', 'Active owner session required');
  return scopeOf(state, current.context);
}

/** The vault namespaced by a digest of the owner scope. */
export function scopedVault(state: ProviderState, key: string): CredentialVault {
  const prefix = `scope.${digest(key).slice(0, 24)}.`;
  return {
    get: (account) => state.vault.get(prefix + account),
    set: (account, value) => state.vault.set(prefix + account, value),
    remove: (account) => state.vault.remove(prefix + account),
  };
}

/** One ChatGPT account connection per owner scope, created on first use. */
export function connectionOf(state: ProviderState, key: string): Connection {
  let account = state.connections.get(key);
  if (!account) {
    const create =
      state.options.factories?.chatgpt ?? ((config) => new ChatGptAccountConnection(config));
    account = create({
      vault: scopedVault(state, key),
      appName: state.appName,
      redirectUri: `${originOf(state)}/oauth/chatgpt/callback`,
      fetch: state.fetcher,
      now: state.now,
    });
    state.connections.set(key, account);
  }
  return account;
}

/** Forget everything and refuse further use. */
export function closeState(state: ProviderState) {
  state.closed = true;
  state.pending.clear();
  state.selected.clear();
  state.profiles.clear();
  state.models.clear();
  state.loadedKeys.clear();
  state.connections.clear();
}
