import { createHash } from 'node:crypto';
import { access, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { ApplicationError, canonicalJson } from '@agent-native/contracts';
import { jsonResponse, type HostSession } from '@agent-native/adapters/http';
import {
  ChatGptAccountConnection,
  type ChatGptConnectionOptions,
  type ChatGptProfile,
} from '@agent-native/agents/chatgpt';
import { OsCredentialVault, type CredentialVault } from '@agent-native/agents/credentials';
import { CodexHarness, chatGptCodexOptions, type CodexOptions } from '@agent-native/agents/codex';
import { ClaudeHarness } from '@agent-native/agents/claude';
import { AiSdkHarness } from '@agent-native/agents/ai-sdk';
import type { Harness, HarnessTurn } from '@agent-native/agents/types';
import { loadRuntimeManifest, resourcePath } from './runtime-manifest';

type Connection = Pick<
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
interface SessionSelection {
  profileId?: string;
  model?: string;
}
interface ModelSummary {
  id: string;
  title: string;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Host-owned provider access. Status/availability never reads the OS vault. Explicit
 * profile loading, connection or key entry authorizes subsequent selected-run access. */
export async function createProviderAccess(options: ProviderAccessOptions) {
  const workspacePath = await realpath(options.workspacePath);
  const vault =
    options.vault ?? new OsCredentialVault(`agent-native.${digest(workspacePath).slice(0, 32)}`);
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? fetch;
  const appName = options.appName ?? 'agent-native-desktop-starter';
  const connections = new Map<string, Connection>();
  const profiles = new Map<string, Map<string, ChatGptProfile>>();
  const models = new Map<string, ModelSummary[]>();
  const selected = new Map<string, SessionSelection>();
  const loadedKeys = new Map<string, Set<'claude' | 'ai-sdk'>>();
  const pending = new Map<string, { token: string; scope: string; expiresAt: number }>();
  let closed = false;
  const origin = () => (typeof options.origin === 'string' ? options.origin : options.origin());
  const scope = (context: { principalId?: unknown; workspaceId?: unknown; grant?: unknown }) => {
    if (
      context.principalId !== (options.ownerPrincipalId ?? 'owner') ||
      typeof context.workspaceId !== 'string' ||
      !context.workspaceId ||
      context.grant !== undefined
    )
      throw new ApplicationError('FORBIDDEN', 'Only the local owner can manage provider access');
    return canonicalJson([context.workspaceId, context.principalId]);
  };
  const live = (session: HostSession): string => {
    const current = options.sessions(session.token);
    if (
      closed ||
      !current ||
      current.expiresAt <= now() ||
      scope(current.context) !== scope(session.context)
    )
      throw new ApplicationError('FORBIDDEN', 'Active owner session required');
    return scope(current.context);
  };
  function scopedVault(key: string): CredentialVault {
    const prefix = `scope.${digest(key).slice(0, 24)}.`;
    return {
      get: (account) => vault.get(prefix + account),
      set: (account, value) => vault.set(prefix + account, value),
      remove: (account) => vault.remove(prefix + account),
    };
  }
  function connection(key: string) {
    let account = connections.get(key);
    if (!account) {
      account = (options.factories?.chatgpt ?? ((config) => new ChatGptAccountConnection(config)))({
        vault: scopedVault(key),
        appName,
        redirectUri: `${origin()}/oauth/chatgpt/callback`,
        fetch: fetcher,
        now,
      });
      connections.set(key, account);
    }
    return account;
  }
  function safeProfile(profile: ChatGptProfile): ChatGptProfile {
    if (
      typeof profile.id !== 'string' ||
      typeof profile.clientId !== 'string' ||
      typeof profile.subject !== 'string' ||
      profile.issuer !== 'https://auth.openai.com' ||
      typeof profile.connected !== 'boolean' ||
      typeof profile.planUsageEnabled !== 'boolean' ||
      !Array.isArray(profile.scopes) ||
      profile.scopes.some((scope) => typeof scope !== 'string') ||
      (profile.email !== undefined && typeof profile.email !== 'string') ||
      (profile.expiresAt !== undefined && !Number.isFinite(profile.expiresAt))
    )
      throw new Error('Invalid safe provider metadata');
    return {
      id: profile.id,
      clientId: profile.clientId,
      subject: profile.subject,
      issuer: profile.issuer,
      connected: profile.connected,
      planUsageEnabled: profile.planUsageEnabled,
      scopes: [...profile.scopes],
      ...(profile.email === undefined ? {} : { email: profile.email }),
      ...(profile.expiresAt === undefined ? {} : { expiresAt: profile.expiresAt }),
    };
  }
  function remember(key: string, profile: ChatGptProfile) {
    let known = profiles.get(key);
    if (!known) {
      known = new Map();
      profiles.set(key, known);
    }
    known.set(profile.id, safeProfile(profile));
  }
  function knownProfile(key: string, profileId: string): ChatGptProfile {
    const profile = profiles.get(key)?.get(profileId);
    if (!profile || !profile.connected || !profile.planUsageEnabled)
      throw new ApplicationError(
        'FORBIDDEN',
        'Load and select a connected ChatGPT plan profile first',
      );
    return profile;
  }
  async function credentials(key: string, profileId: string) {
    const profile = knownProfile(key, profileId);
    const account = connection(key);
    if (profile.expiresAt === undefined || profile.expiresAt <= now() + 60_000) {
      const refreshed = await account.refresh(profileId);
      remember(key, refreshed);
      knownProfile(key, profileId);
    }
    return account.credentials(profileId);
  }
  function model(value: unknown): string {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value))
      throw new ApplicationError('INVALID_INPUT', 'Select a valid model');
    return value;
  }
  function profileId(value: unknown): string {
    if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/i.test(value))
      throw new ApplicationError('INVALID_INPUT', 'Select a valid profile');
    return value;
  }
  function choose(key: string, selection: SessionSelection): ProviderSelection {
    const id = profileId(selection.profileId);
    knownProfile(key, id);
    const selectedModel = model(selection.model);
    if (!models.get(canonicalJson([key, id]))?.some((item) => item.id === selectedModel))
      throw new ApplicationError(
        'INVALID_INPUT',
        'Load models for the selected profile before choosing one',
      );
    return { profileId: id, model: selectedModel };
  }
  /** Capture only safe funding/model identifiers in the run. A later UI selection
   * cannot change them; keys and OAuth hints are never part of run context. */
  function resolveSelection(
    session: HostSession,
    body: { harnessId?: unknown; profileId?: unknown; model?: unknown },
  ): ProviderSelection | {} {
    if (body.harnessId !== 'codex' && body.harnessId !== 'claude' && body.harnessId !== 'ai-sdk')
      return {};
    const key = live(session);
    if (body.harnessId === 'codex') {
      const current = selected.get(session.token);
      const choice = choose(key, {
        profileId: typeof body.profileId === 'string' ? body.profileId : current?.profileId,
        model: typeof body.model === 'string' ? body.model : current?.model,
      });
      selected.set(session.token, choice);
      return choice;
    }
    if (body.harnessId === 'claude' || body.harnessId === 'ai-sdk') {
      if (!loadedKeys.get(key)?.has(body.harnessId))
        throw new ApplicationError(
          'FORBIDDEN',
          'Explicitly load or save this provider API key first',
        );
      return { model: model(body.model), providerAccount: `${body.harnessId}-api` };
    }
    return {};
  }
  async function runtime(kind: 'codex' | 'claude'): Promise<string> {
    if (!options.runtimeManifest || !isAbsolute(options.runtimeManifest))
      throw new ApplicationError('NOT_FOUND', 'A bundled native runtime manifest is required');
    const root = await realpath(dirname(options.runtimeManifest));
    if ((await realpath(options.runtimeManifest)) !== join(root, 'runtime-manifest.json'))
      throw new ApplicationError(
        'INVALID_INPUT',
        'Runtime manifest must use its packaged filename',
      );
    const manifest = await loadRuntimeManifest(root);
    const descriptor = manifest.runtimes[kind];
    if (!descriptor.files.some((file) => file.path === descriptor.executable))
      throw new ApplicationError('INVALID_INPUT', 'Runtime executable digest is missing');
    for (const file of descriptor.files) {
      const path = await realpath(resourcePath(root, file.path));
      const boundary = relative(root, path);
      if (
        !boundary ||
        boundary === '..' ||
        boundary.startsWith(`..${sep}`) ||
        isAbsolute(boundary) ||
        !(await stat(path)).isFile()
      )
        throw new ApplicationError(
          'INVALID_INPUT',
          'Runtime resource escapes its packaged directory',
        );
      const bytes = await readFile(path);
      if (
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        createHash('sha256').update(bytes).digest('hex') !== file.sha256
      )
        throw new ApplicationError('INVALID_INPUT', 'Native runtime integrity check failed');
    }
    const executable = await realpath(resourcePath(root, descriptor.executable));
    await access(executable, constants.X_OK);
    return executable;
  }
  async function directories(turn: HarnessTurn, kind: string, key: string) {
    const cwd = join(workspacePath, 'provider-runs', digest(turn.runId).slice(0, 32), kind, 'work');
    // Native thread/session persistence is conversation-scoped, while funding profiles
    // stay isolated. A per-run HOME would silently make the next resume unavailable.
    const home = join(
      workspacePath,
      'provider-conversations',
      digest(
        canonicalJson([
          key,
          turn.conversationId,
          kind,
          turn.context.profileId ?? turn.context.providerAccount ?? null,
        ]),
      ).slice(0, 32),
      'home',
    );
    await mkdir(cwd, { recursive: true, mode: 0o700 });
    await mkdir(home, { recursive: true, mode: 0o700 });
    return { cwd, home };
  }
  function lazy(
    id: 'codex' | 'claude' | 'ai-sdk',
    features: Harness['features'],
    build: (turn: HarnessTurn, key: string) => Promise<Harness>,
  ): Harness {
    return {
      id,
      features,
      async availability() {
        if (closed) return { available: false, reason: 'Provider access is closed' };
        return id === 'ai-sdk' || options.runtimeManifest
          ? { available: true }
          : { available: false, reason: 'Bundled native runtime manifest not configured' };
      },
      async *run(turn) {
        try {
          turn.signal.throwIfAborted();
          const key = scope(turn.context);
          if (closed) throw new Error('Provider access closed');
          const harness = await build(turn, key);
          turn.signal.throwIfAborted();
          if (closed) throw new Error('Provider access closed');
          if (id === 'codex')
            choose(key, {
              profileId:
                typeof turn.context.profileId === 'string' ? turn.context.profileId : undefined,
              model: typeof turn.context.model === 'string' ? turn.context.model : undefined,
            });
          else if (!loadedKeys.get(key)?.has(id))
            throw new ApplicationError(
              'FORBIDDEN',
              'Provider credentials were disconnected before execution',
            );
          yield* harness.run(turn);
        } catch (error) {
          if (turn.signal.aborted)
            throw new ApplicationError('CANCELLED', 'Provider run cancelled');
          if (error instanceof ApplicationError) throw error;
          throw new ApplicationError(
            'INTERNAL',
            'Provider execution failed; reconnect the selected account or check its configuration',
          );
        }
      },
    };
  }
  const harnesses: Harness[] = [
    lazy('codex', { questions: true, approvals: false, resume: true }, async (turn, key) => {
      const selection = choose(key, {
        profileId: typeof turn.context.profileId === 'string' ? turn.context.profileId : undefined,
        model: typeof turn.context.model === 'string' ? turn.context.model : undefined,
      });
      const tokens = await credentials(key, selection.profileId!);
      const executable = await runtime('codex');
      const paths = await directories(turn, 'codex', key);
      return (options.factories?.codex ?? ((config) => new CodexHarness(config)))({
        executable,
        ...paths,
        model: selection.model,
        ...chatGptCodexOptions(tokens.accessToken, appName),
      });
    }),
    lazy('claude', { questions: false, approvals: false, resume: true }, async (turn, key) => {
      if (turn.context.providerAccount !== 'claude-api' || !loadedKeys.get(key)?.has('claude'))
        throw new ApplicationError('FORBIDDEN', 'Explicit Claude API key selection required');
      const apiKey = await scopedVault(key).get('api.claude.key');
      if (!apiKey) throw new ApplicationError('FORBIDDEN', 'Claude API key unavailable');
      return (options.factories?.claude ?? ((config) => new ClaudeHarness(config)))({
        apiKey,
        model: model(turn.context.model),
        executable: await runtime('claude'),
        ...(await directories(turn, 'claude', key)),
      });
    }),
    lazy('ai-sdk', { questions: false, approvals: false, resume: false }, async (turn, key) => {
      if (turn.context.providerAccount !== 'ai-sdk-api' || !loadedKeys.get(key)?.has('ai-sdk'))
        throw new ApplicationError('FORBIDDEN', 'Explicit API-key funding selection required');
      const apiKey = await scopedVault(key).get('api.ai-sdk.key');
      if (!apiKey) throw new ApplicationError('FORBIDDEN', 'API key unavailable');
      const selectedModel = model(turn.context.model);
      if (options.factories?.aiSdk)
        return options.factories.aiSdk({ apiKey, model: selectedModel });
      const { createOpenAI } = await import('@ai-sdk/openai');
      return new AiSdkHarness({
        model: createOpenAI({
          apiKey,
          baseURL: 'https://api.openai.com/v1',
          fetch: fetcher,
        }).responses(selectedModel),
      });
    }),
  ];
  async function body(request: Request): Promise<Record<string, unknown>> {
    if (!request.headers.get('content-type')?.startsWith('application/json'))
      throw new ApplicationError('INVALID_INPUT', 'JSON content type required');
    const reader = request.body?.getReader();
    if (!reader) throw new ApplicationError('INVALID_INPUT', 'JSON body required');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > 32_000) {
          await reader.cancel();
          throw new ApplicationError('INVALID_INPUT', 'Provider request exceeds limit');
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    try {
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new ApplicationError('INVALID_INPUT', 'JSON object required');
    }
  }
  async function route(request: Request, session: HostSession): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/v1/providers')) return undefined;
    const key = live(session);
    try {
      if (url.pathname === '/api/v1/providers' && request.method === 'GET')
        return jsonResponse({
          providers: harnesses.map((harness) => ({
            id: harness.id,
            nativeRuntimeConfigured: harness.id === 'ai-sdk' || !!options.runtimeManifest,
            credentialsLoaded:
              harness.id === 'codex'
                ? profiles.has(key)
                : (loadedKeys.get(key)?.has(harness.id as 'claude' | 'ai-sdk') ?? false),
          })),
          profiles: [...(profiles.get(key)?.values() ?? [])],
          selection: selected.get(session.token) ?? null,
        });
      if (url.pathname === '/api/v1/providers/chatgpt/connect' && request.method === 'POST') {
        const input = await body(request);
        const id = input.profileId === undefined ? undefined : profileId(input.profileId);
        if (id && !profiles.get(key)?.has(id))
          throw new ApplicationError('FORBIDDEN', 'Load the profile before reconnecting');
        for (const [state, attempt] of pending)
          if (attempt.expiresAt <= now()) pending.delete(state);
        const result = await connection(key).begin(session.token, id);
        live(session);
        const state = new URL(result.authorizationUrl).searchParams.get('state');
        if (!state) throw new Error('Connection state missing');
        pending.set(state, { token: session.token, scope: key, expiresAt: result.expiresAt });
        return jsonResponse(result);
      }
      if (url.pathname === '/api/v1/providers/chatgpt/profiles' && request.method === 'POST') {
        const result = (await connection(key).profiles()).map(safeProfile);
        live(session);
        profiles.set(key, new Map(result.map((profile) => [profile.id, profile])));
        return jsonResponse({ profiles: result });
      }
      if (url.pathname === '/api/v1/providers/chatgpt/select' && request.method === 'POST') {
        const input = await body(request);
        const choice = choose(key, {
          profileId: profileId(input.profileId),
          model: model(input.model),
        });
        selected.set(session.token, choice);
        return jsonResponse(choice);
      }
      if (url.pathname === '/api/v1/providers/chatgpt/disconnect' && request.method === 'POST') {
        const input = await body(request);
        const id = profileId(input.profileId);
        if (!profiles.get(key)?.has(id))
          throw new ApplicationError('FORBIDDEN', 'Load the profile before disconnecting');
        const result = await connection(key).logout(id);
        profiles.get(key)?.delete(id);
        models.delete(canonicalJson([key, id]));
        for (const [token, choice] of selected) if (choice.profileId === id) selected.delete(token);
        return jsonResponse(result);
      }
      if (
        url.pathname === '/api/v1/providers/chatgpt/models' &&
        (request.method === 'GET' || request.method === 'POST')
      ) {
        const input =
          request.method === 'POST'
            ? await body(request)
            : { profileId: url.searchParams.get('profileId') };
        const id = profileId(input.profileId);
        const tokens = await credentials(key, id);
        const response = await fetcher('https://api.openai.com/v1/models', {
          headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
          redirect: 'error',
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok) throw new Error('Account model catalog unavailable');
        const text = await response.text();
        if (text.length > 1_048_576) throw new Error('Model catalog exceeds limit');
        const payload: unknown = JSON.parse(text);
        if (
          !payload ||
          typeof payload !== 'object' ||
          !('models' in payload) ||
          !Array.isArray(payload.models)
        )
          throw new Error('Invalid model catalog');
        // Account-specific SIWC catalog: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
        const listed = payload.models.flatMap((value: unknown): ModelSummary[] => {
          if (
            !value ||
            typeof value !== 'object' ||
            !('visibility' in value) ||
            value.visibility !== 'list' ||
            !('slug' in value) ||
            typeof value.slug !== 'string'
          )
            return [];
          const id = model(value.slug);
          const title =
            'display_name' in value && typeof value.display_name === 'string'
              ? value.display_name.slice(0, 200)
              : id;
          return [{ id, title }];
        });
        live(session);
        models.set(canonicalJson([key, id]), listed);
        return jsonResponse({ models: listed, inferenceVerified: false });
      }
      const api = url.pathname.match(
        /^\/api\/v1\/providers\/(claude|ai-sdk)\/(key|load|disconnect)$/,
      );
      if (api && request.method === 'POST') {
        const provider = api[1] as 'claude' | 'ai-sdk';
        const account = `api.${provider}.key`;
        const store = scopedVault(key);
        if (api[2] === 'disconnect') {
          await store.remove(account);
          loadedKeys.get(key)?.delete(provider);
          return jsonResponse({ disconnected: true });
        }
        if (api[2] === 'key') {
          const input = await body(request);
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
        live(session);
        let known = loadedKeys.get(key);
        if (!known) {
          known = new Set();
          loadedKeys.set(key, known);
        }
        known.add(provider);
        return jsonResponse({ configured: true, funding: 'api-key' });
      }
      return undefined;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(
        'INTERNAL',
        'Provider account operation failed; reconnect or check the selected account',
      );
    }
  }
  async function callback(request: Request): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.pathname !== '/oauth/chatgpt/callback') return undefined;
    const page = (success: boolean) =>
      new Response(
        `<!doctype html><html><head><meta charset="utf-8"><title>Account connection</title></head><body><p>${success ? 'ChatGPT account connected. Return to the application to select a model.' : 'ChatGPT connection failed or expired. Return to the application and try again.'}</p><a href="/">Return to application</a></body></html>`,
        {
          status: success ? 200 : 400,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy':
              "default-src 'none'; style-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          },
        },
      );
    const state = url.searchParams.get('state') ?? '';
    const attempt = pending.get(state);
    try {
      if (
        request.method !== 'GET' ||
        url.origin !== origin() ||
        request.headers.get('host') !== new URL(origin()).host ||
        request.url.length > 16_384 ||
        !attempt ||
        attempt.expiresAt <= now()
      )
        throw new Error('Invalid callback');
      pending.delete(state);
      const session = options.sessions(attempt.token);
      if (!session || live(session) !== attempt.scope) throw new Error('Session unavailable');
      const account = connection(attempt.scope);
      const profile = await account.complete(request.url, attempt.token);
      try {
        live(session);
      } catch {
        await account.logout(profile.id);
        throw new Error('Session revoked during connection');
      }
      remember(attempt.scope, profile);
      selected.set(attempt.token, { profileId: profile.id });
      return page(true);
    } catch {
      return page(false);
    }
  }
  return {
    harnesses,
    route,
    callback,
    resolveSelection,
    close() {
      closed = true;
      pending.clear();
      selected.clear();
      profiles.clear();
      models.clear();
      loadedKeys.clear();
      connections.clear();
    },
  };
}
