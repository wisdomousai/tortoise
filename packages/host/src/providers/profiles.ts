import { ApplicationError, canonicalJson } from '@tortoise/contracts';
import type { HostSession } from '@tortoise/adapters/http';
import type { ChatGptProfile } from '@tortoise/agents/chatgpt';
import type { ProviderSelection } from '../providers';
import { connectionOf, liveScope, type ProviderState, type SessionSelection } from './state';
import { safeProfile, validModel, validProfileId } from './validation';

export function rememberProfile(state: ProviderState, key: string, profile: ChatGptProfile) {
  let known = state.profiles.get(key);
  if (!known) {
    known = new Map();
    state.profiles.set(key, known);
  }
  known.set(profile.id, safeProfile(profile));
}

/** A loaded profile that is connected and funded by a ChatGPT plan, or FORBIDDEN. */
export function knownProfile(state: ProviderState, key: string, profileId: string): ChatGptProfile {
  const profile = state.profiles.get(key)?.get(profileId);
  if (!profile || !profile.connected || !profile.planUsageEnabled)
    throw new ApplicationError(
      'FORBIDDEN',
      'Load and select a connected ChatGPT plan profile first',
    );
  return profile;
}

/** Fresh tokens for a known profile, refreshing within a minute of expiry. */
export async function profileCredentials(state: ProviderState, key: string, profileId: string) {
  const profile = knownProfile(state, key, profileId);
  const account = connectionOf(state, key);
  if (profile.expiresAt === undefined || profile.expiresAt <= state.now() + 60_000) {
    const refreshed = await account.refresh(profileId);
    rememberProfile(state, key, refreshed);
    knownProfile(state, key, profileId);
  }
  return account.credentials(profileId);
}

/** A profile and one of the models loaded for it. */
export function chooseModel(
  state: ProviderState,
  key: string,
  selection: SessionSelection,
): ProviderSelection {
  const id = validProfileId(selection.profileId);
  knownProfile(state, key, id);
  const selectedModel = validModel(selection.model);
  if (!state.models.get(canonicalJson([key, id]))?.some((item) => item.id === selectedModel))
    throw new ApplicationError(
      'INVALID_INPUT',
      'Load models for the selected profile before choosing one',
    );
  return { profileId: id, model: selectedModel };
}

/** The selection a provider turn carries in its run context. */
export const turnSelection = (context: Readonly<Record<string, unknown>>): SessionSelection => ({
  profileId: typeof context.profileId === 'string' ? context.profileId : undefined,
  model: typeof context.model === 'string' ? context.model : undefined,
});

/**
 * Capture only safe funding/model identifiers in the run. A later UI selection cannot change
 * them; keys and OAuth hints are never part of run context.
 */
export function resolveSelection(
  state: ProviderState,
  session: HostSession,
  body: { harnessId?: unknown; profileId?: unknown; model?: unknown },
): ProviderSelection | {} {
  if (body.harnessId !== 'codex' && body.harnessId !== 'claude' && body.harnessId !== 'ai-sdk')
    return {};
  const key = liveScope(state, session);
  if (body.harnessId === 'codex') {
    const current = state.selected.get(session.token);
    const choice = chooseModel(state, key, {
      profileId: typeof body.profileId === 'string' ? body.profileId : current?.profileId,
      model: typeof body.model === 'string' ? body.model : current?.model,
    });
    state.selected.set(session.token, choice);
    return choice;
  }
  if (!state.loadedKeys.get(key)?.has(body.harnessId))
    throw new ApplicationError('FORBIDDEN', 'Explicitly load or save this provider API key first');
  return { model: validModel(body.model), providerAccount: `${body.harnessId}-api` };
}
