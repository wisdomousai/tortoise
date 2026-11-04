import { ApplicationError, canonicalJson } from '@tortoise/contracts';
import { jsonResponse, type HostSession } from '@tortoise/adapters/http';
import type { Harness } from '@tortoise/agents/types';
import { fetchModelCatalog } from './model-catalog';
import { chooseModel, profileCredentials } from './profiles';
import { connectionOf, liveScope, scopedVault, type ProviderState } from './state';
import { readProviderBody, safeProfile, validModel, validProfileId } from './validation';

/** One provider request, already bound to a live local-user scope. */
interface ProviderRequest {
  readonly state: ProviderState;
  readonly harnesses: readonly Harness[];
  readonly request: Request;
  readonly url: URL;
  readonly session: HostSession;
  readonly key: string;
}
type ProviderRoute = (input: ProviderRequest) => Promise<Response>;

/** Provider status. Reports what was explicitly loaded; never reads the OS vault. */
async function listProviders({ state, harnesses, session, key }: ProviderRequest) {
  return jsonResponse({
    providers: harnesses.map((harness) => ({
      id: harness.id,
      nativeRuntimeConfigured: harness.id === 'ai-sdk' || !!state.options.runtimeManifest,
      credentialsLoaded:
        harness.id === 'codex'
          ? state.profiles.has(key)
          : (state.loadedKeys.get(key)?.has(harness.id as 'claude' | 'ai-sdk') ?? false),
    })),
    profiles: [...(state.profiles.get(key)?.values() ?? [])],
    selection: state.selected.get(session.token) ?? null,
  });
}

/** Begin an OAuth connection; the callback must return within the attempt's lifetime. */
async function connectChatGpt({ state, request, session, key }: ProviderRequest) {
  const input = await readProviderBody(request);
  const id = input.profileId === undefined ? undefined : validProfileId(input.profileId);
  if (id && !state.profiles.get(key)?.has(id))
    throw new ApplicationError('FORBIDDEN', 'Load the profile before reconnecting');
  for (const [attemptState, attempt] of state.pending)
    if (attempt.expiresAt <= state.now()) state.pending.delete(attemptState);
  const result = await connectionOf(state, key).begin(session.token, id);
  liveScope(state, session);
  const attemptState = new URL(result.authorizationUrl).searchParams.get('state');
  if (!attemptState) throw new Error('Connection state missing');
  state.pending.set(attemptState, {
    token: session.token,
    scope: key,
    expiresAt: result.expiresAt,
  });
  return jsonResponse(result);
}

async function loadProfiles({ state, session, key }: ProviderRequest) {
  const result = (await connectionOf(state, key).profiles()).map(safeProfile);
  liveScope(state, session);
  state.profiles.set(key, new Map(result.map((profile) => [profile.id, profile])));
  return jsonResponse({ profiles: result });
}

async function selectModel({ state, request, session, key }: ProviderRequest) {
  const input = await readProviderBody(request);
  const choice = chooseModel(state, key, {
    profileId: validProfileId(input.profileId),
    model: validModel(input.model),
  });
  state.selected.set(session.token, choice);
  return jsonResponse(choice);
}

/** Log a profile out and forget its models and every session selection that named it. */
async function disconnectProfile({ state, request, key }: ProviderRequest) {
  const input = await readProviderBody(request);
  const id = validProfileId(input.profileId);
  if (!state.profiles.get(key)?.has(id))
    throw new ApplicationError('FORBIDDEN', 'Load the profile before disconnecting');
  const result = await connectionOf(state, key).logout(id);
  state.profiles.get(key)?.delete(id);
  state.models.delete(canonicalJson([key, id]));
  for (const [token, choice] of state.selected)
    if (choice.profileId === id) state.selected.delete(token);
  return jsonResponse(result);
}

async function loadModels({ state, request, url, session, key }: ProviderRequest) {
  const input =
    request.method === 'POST'
      ? await readProviderBody(request)
      : { profileId: url.searchParams.get('profileId') };
  const id = validProfileId(input.profileId);
  const tokens = await profileCredentials(state, key, id);
  const listed = await fetchModelCatalog(state, tokens.accessToken, request.signal);
  liveScope(state, session);
  state.models.set(canonicalJson([key, id]), listed);
  return jsonResponse({ models: listed, inferenceVerified: false });
}

/** Save, load or remove an API key; saving or loading marks it usable for this local-user scope. */
async function apiKey(
  { state, request, session, key }: ProviderRequest,
  provider: 'claude' | 'ai-sdk',
  action: 'key' | 'load' | 'disconnect',
) {
  const account = `api.${provider}.key`;
  const store = scopedVault(state, key);
  if (action === 'disconnect') {
    await store.remove(account);
    state.loadedKeys.get(key)?.delete(provider);
    return jsonResponse({ disconnected: true });
  }
  if (action === 'key') {
    const input = await readProviderBody(request);
    if (
      typeof input.key !== 'string' ||
      input.key.length < 8 ||
      input.key.length > 8192 ||
      /[\r\n\0]/.test(input.key)
    )
      throw new ApplicationError('INVALID_INPUT', 'Enter a valid provider API key');
    await store.set(account, input.key);
  } else if (!(await store.get(account)))
    throw new ApplicationError('NOT_FOUND', 'No saved API key for this provider');
  liveScope(state, session);
  let known = state.loadedKeys.get(key);
  if (!known) {
    known = new Set();
    state.loadedKeys.set(key, known);
  }
  known.add(provider);
  return jsonResponse({ configured: true, funding: 'api-key' });
}

const routes: readonly { path: string; methods: readonly string[]; handle: ProviderRoute }[] = [
  { path: '/api/v1/providers', methods: ['GET'], handle: listProviders },
  { path: '/api/v1/providers/chatgpt/connect', methods: ['POST'], handle: connectChatGpt },
  { path: '/api/v1/providers/chatgpt/profiles', methods: ['POST'], handle: loadProfiles },
  { path: '/api/v1/providers/chatgpt/select', methods: ['POST'], handle: selectModel },
  { path: '/api/v1/providers/chatgpt/disconnect', methods: ['POST'], handle: disconnectProfile },
  { path: '/api/v1/providers/chatgpt/models', methods: ['GET', 'POST'], handle: loadModels },
];

function matchRoute(input: ProviderRequest): (() => Promise<Response>) | undefined {
  const { pathname } = input.url;
  const method = input.request.method;
  const route = routes.find((item) => item.path === pathname && item.methods.includes(method));
  if (route) return () => route.handle(input);
  const api = pathname.match(/^\/api\/v1\/providers\/(claude|ai-sdk)\/(key|load|disconnect)$/);
  if (api && method === 'POST')
    return () =>
      apiKey(input, api[1] as 'claude' | 'ai-sdk', api[2] as 'key' | 'load' | 'disconnect');
  return undefined;
}

/**
 * The local user's provider account API. The session must be a live local-user session before anything
 * else runs. Provider failures reach the client as one generic message; details never do.
 */
export async function routeProviders(
  state: ProviderState,
  harnesses: readonly Harness[],
  request: Request,
  session: HostSession,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/v1/providers')) return undefined;
  const key = liveScope(state, session);
  try {
    return await matchRoute({ state, harnesses, request, url, session, key })?.();
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      'INTERNAL',
      'Provider account operation failed; reconnect or check the selected account',
    );
  }
}
