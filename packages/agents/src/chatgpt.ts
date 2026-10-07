import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { CredentialVault } from './credentials';
import { sameSecret, verifyOidcIdentity } from './oidc';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const scopes = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  'chatgpt.tokens.use.direct',
];
const inferenceGranted = (granted: string[]) =>
  ['resource.invoke', 'chatgpt.tokens.use.direct'].every((scope) => granted.includes(scope));
const secret = () => randomBytes(32).toString('base64url');
export interface ChatGptProfile {
  id: string;
  clientId: string;
  subject: string;
  issuer: string;
  email?: string;
  connected: boolean;
  planUsageEnabled: boolean;
  scopes: string[];
  expiresAt?: number;
}
export interface ChatGptCredentials {
  accessToken: string;
  refreshToken?: string;
  idToken: string;
  expiresAt: number;
  /** Provider scheduling hint retained without inventing its units or semantics. */
  earliestRefreshAt?: unknown;
}
type StoredProfile = ChatGptProfile & { tokens?: ChatGptCredentials };
type Pending = {
  session: string;
  verifier: string;
  nonce: string;
  expires: number;
  profile?: StoredProfile;
};
export interface ChatGptConnectionOptions {
  vault: CredentialVault;
  /** Stable product identity, also used in the Codex initialize clientInfo. */
  appName: string;
  /** The host starts this loopback listener before exposing begin(). */
  redirectUri: string;
  fetch?: typeof fetch;
  keyResolver?: JWTVerifyGetKey;
  now?: () => number;
}

/** ChatGPT dynamic public-client enrollment. Only opaque safe profile metadata may
 * cross the service boundary. Tokens, ID hints and authorization URLs are secrets:
 * do not persist them in runs, logs, browser storage or the business database. */
export class ChatGptAccountConnection {
  private readonly pending = new Map<string, Pending>();
  private readonly key: JWTVerifyGetKey;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: ChatGptConnectionOptions) {
    const callback = new URL(options.redirectUri);
    if (
      callback.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(callback.hostname) ||
      callback.username ||
      callback.password ||
      callback.hash ||
      callback.search ||
      !callback.port
    )
      throw new Error('ChatGPT requires a bound loopback callback with an explicit port');
    if (!options.appName.trim() || options.appName.length > 120 || /[\r\n\0]/.test(options.appName))
      throw new Error('Stable application name is required');
    this.fetcher = options.fetch ?? fetch;
    this.key =
      options.keyResolver ??
      createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 5_000 });
    this.now = options.now ?? Date.now;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.catch(() => {}).then(work);
    this.writes = result;
    return result;
  }
  private async hostId() {
    let id = await this.options.vault.get('chatgpt.host-id');
    if (!id) {
      id = `urn:uuid:${randomUUID()}`;
      await this.options.vault.set('chatgpt.host-id', id);
    }
    if (!/^urn:uuid:[a-f0-9-]{36}$/i.test(id)) throw new Error('Invalid stored host identity');
    return id;
  }
  private async ids(): Promise<string[]> {
    const raw = await this.options.vault.get('chatgpt.profiles');
    if (!raw) return [];
    const ids: unknown = JSON.parse(raw);
    if (
      !Array.isArray(ids) ||
      ids.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))
    )
      throw new Error('Invalid stored profile index');
    return ids;
  }
  private async read(id: string): Promise<StoredProfile> {
    if (!(await this.ids()).includes(id)) throw new Error('Unknown ChatGPT profile');
    const raw = await this.options.vault.get(`chatgpt.profile.${id}`);
    if (!raw) throw new Error('ChatGPT profile is unavailable');
    const profile = JSON.parse(raw) as StoredProfile;
    if (
      profile.id !== id ||
      profile.issuer !== issuer ||
      !profile.subject ||
      !profile.clientId ||
      profile.clientId === 'dynamic_agent_client' ||
      !Array.isArray(profile.scopes)
    )
      throw new Error('Invalid stored ChatGPT profile');
    return profile;
  }
  private safe(profile: StoredProfile): ChatGptProfile {
    const { tokens: _tokens, ...metadata } = profile;
    return structuredClone(metadata);
  }
  async profiles(): Promise<ChatGptProfile[]> {
    return this.serial(async () =>
      Promise.all((await this.ids()).map(async (id) => this.safe(await this.read(id)))),
    );
  }
  async begin(
    localSessionId: string,
    profileId?: string,
  ): Promise<{ authorizationUrl: string; expiresAt: number }> {
    return this.serial(async () => {
      if (!localSessionId) throw new Error('Trusted local session required');
      for (const [state, attempt] of this.pending)
        if (attempt.expires <= this.now()) this.pending.delete(state);
      if (this.pending.size >= 32) throw new Error('Too many pending ChatGPT connections');
      const profile = profileId ? await this.read(profileId) : undefined;
      const state = secret();
      const nonce = secret();
      const verifier = secret();
      const expiresAt = this.now() + 300_000;
      const url = new URL(`${issuer}/api/accounts/authorize`);
      const parameters: Record<string, string> = {
        client_id: profile?.clientId ?? 'dynamic_agent_client',
        ext_agent_host_id: await this.hostId(),
        response_type: 'code',
        redirect_uri: this.options.redirectUri,
        scope: scopes.join(' '),
        resource,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      };
      if (!profile) parameters.agent_name_hint = this.options.appName;
      // This URL crosses the renderer boundary. Omit the optional identity-token
      // hint so no stored provider token enters browser state or navigation URLs.
      // Returning identity is still verified against the saved subject at completion.
      if (profile?.email) parameters.login_hint = profile.email;
      for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
      this.pending.set(state, {
        session: localSessionId,
        nonce,
        verifier,
        expires: expiresAt,
        profile,
      });
      return { authorizationUrl: url.toString(), expiresAt };
    });
  }
  private async request(parameters: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetcher(`${issuer}/api/accounts/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(parameters),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('ChatGPT token exchange was rejected');
    const text = await response.text();
    if (text.length > 128_000) throw new Error('ChatGPT token response exceeded limit');
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid ChatGPT token response');
    return data as Record<string, unknown>;
  }
  private tokens(data: Record<string, unknown>, previous?: ChatGptCredentials): ChatGptCredentials {
    const expires = Number(data.expires_in);
    if (
      typeof data.access_token !== 'string' ||
      !data.access_token ||
      data.token_type !== 'Bearer' ||
      !Number.isFinite(expires) ||
      expires <= 0 ||
      expires > 366 * 86_400
    )
      throw new Error('Incomplete ChatGPT token response');
    const idToken = typeof data.id_token === 'string' ? data.id_token : previous?.idToken;
    if (!idToken) throw new Error('ChatGPT identity token is required');
    return {
      accessToken: data.access_token,
      idToken,
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : previous?.refreshToken,
      expiresAt: this.now() + expires * 1_000,
      earliestRefreshAt: data.earliest_refresh_at,
    };
  }
  private granted(data: Record<string, unknown>, previous?: string[]) {
    if (data.scope !== undefined && typeof data.scope !== 'string')
      throw new Error('Invalid ChatGPT granted scopes');
    return typeof data.scope === 'string'
      ? data.scope.split(/\s+/).filter(Boolean)
      : (previous ?? []);
  }
  async complete(callbackUrl: string, localSessionId: string): Promise<ChatGptProfile> {
    return this.serial(async () => {
      const url = new URL(callbackUrl);
      const expected = new URL(this.options.redirectUri);
      if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash)
        throw new Error('ChatGPT callback target mismatch');
      for (const name of ['state', 'code', 'client_id', 'error'])
        if (url.searchParams.getAll(name).length > 1) throw new Error('Ambiguous ChatGPT callback');
      const state = url.searchParams.get('state') ?? '';
      const attempt = this.pending.get(state);
      if (!attempt || !sameSecret(attempt.session, localSessionId))
        throw new Error('Invalid ChatGPT connection state');
      this.pending.delete(state);
      if (attempt.expires <= this.now()) throw new Error('ChatGPT connection expired');
      if (url.searchParams.has('error')) throw new Error('ChatGPT connection was declined');
      const clientId = url.searchParams.get('client_id') ?? attempt.profile?.clientId;
      if (
        !clientId ||
        clientId === 'dynamic_agent_client' ||
        clientId.length > 256 ||
        /[\s\0]/.test(clientId) ||
        (attempt.profile && clientId !== attempt.profile.clientId)
      )
        throw new Error('ChatGPT did not return the expected issued client ID');
      const code = url.searchParams.get('code');
      if (!code || code.length > 8192)
        throw new Error('ChatGPT callback has no valid authorization code');
      const data = await this.request({
        grant_type: 'authorization_code',
        code,
        code_verifier: attempt.verifier,
        client_id: clientId,
        redirect_uri: this.options.redirectUri,
        resource,
      });
      const tokens = this.tokens(data);
      const identity = await verifyOidcIdentity(
        tokens.idToken,
        this.key,
        issuer,
        clientId,
        attempt.nonce,
        this.now(),
      );
      if (attempt.profile && identity.sub !== attempt.profile.subject)
        throw new Error('ChatGPT selected account does not match the saved profile');
      const granted = this.granted(data);
      const ids = await this.ids();
      // Re-enrollment of the same issued client/subject updates its one token record.
      let existing: StoredProfile | undefined;
      for (const id of ids) {
        const candidate = await this.read(id);
        if (candidate.clientId === clientId && candidate.subject === identity.sub)
          existing = candidate;
      }
      const profile: StoredProfile = {
        id: attempt.profile?.id ?? existing?.id ?? randomUUID(),
        clientId,
        subject: identity.sub!,
        issuer,
        email: typeof identity.email === 'string' ? identity.email : undefined,
        connected: true,
        planUsageEnabled: inferenceGranted(granted),
        scopes: granted,
        expiresAt: tokens.expiresAt,
        tokens,
      };
      await this.options.vault.set(`chatgpt.profile.${profile.id}`, JSON.stringify(profile));
      if (!ids.includes(profile.id))
        try {
          await this.options.vault.set('chatgpt.profiles', JSON.stringify([...ids, profile.id]));
        } catch (error) {
          // OS vaults do not provide multi-entry transactions. Do not leave a newly
          // written renewable token behind after its registration index fails.
          await this.options.vault.remove(`chatgpt.profile.${profile.id}`).catch(() => false);
          throw error;
        }
      return this.safe(profile);
    });
  }
  /** Authority only; even opaque token introspection must not reach the renderer. */
  async credentials(profileId: string): Promise<ChatGptCredentials> {
    return this.serial(async () => {
      const profile = await this.read(profileId);
      if (!profile.connected || !profile.planUsageEnabled || !profile.tokens)
        throw new Error('ChatGPT plan usage is not enabled for this profile');
      if (profile.tokens.expiresAt <= this.now())
        throw new Error('ChatGPT access token expired; refresh is required');
      return structuredClone(profile.tokens);
    });
  }
  async refresh(profileId: string): Promise<ChatGptProfile> {
    // Serialize the entire rotating refresh-token exchange, including persistence.
    return this.serial(async () => {
      const profile = await this.read(profileId);
      const previous = profile.tokens;
      if (!previous?.refreshToken) throw new Error('ChatGPT profile has no refresh grant');
      const data = await this.request({
        grant_type: 'refresh_token',
        client_id: profile.clientId,
        refresh_token: previous.refreshToken,
        resource,
      });
      const tokens = this.tokens(data, previous);
      if (typeof data.id_token === 'string') {
        const identity = await verifyOidcIdentity(
          data.id_token,
          this.key,
          issuer,
          profile.clientId,
          undefined,
          this.now(),
        );
        if (identity.sub !== profile.subject) throw new Error('ChatGPT refresh identity mismatch');
      }
      const granted = this.granted(data, profile.scopes);
      const next: StoredProfile = {
        ...profile,
        tokens,
        connected: true,
        scopes: granted,
        planUsageEnabled: inferenceGranted(granted),
        expiresAt: tokens.expiresAt,
      };
      await this.options.vault.set(`chatgpt.profile.${profileId}`, JSON.stringify(next));
      return this.safe(next);
    });
  }
  async logout(profileId: string): Promise<{ revocationConfirmed: boolean }> {
    return this.serial(async () => {
      const profile = await this.read(profileId);
      const token = profile.tokens?.refreshToken;
      // Clearing tokens is authoritative even when the provider is unreachable.
      const next: StoredProfile = {
        ...this.safe(profile),
        connected: false,
        planUsageEnabled: false,
        scopes: [],
        expiresAt: undefined,
      };
      await this.options.vault.set(`chatgpt.profile.${profileId}`, JSON.stringify(next));
      for (const [state, attempt] of this.pending)
        if (attempt.profile?.id === profileId) this.pending.delete(state);
      if (!token) return { revocationConfirmed: false };
      try {
        const discovery = await this.fetcher(`${issuer}/.well-known/openid-configuration`, {
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        if (!discovery.ok) return { revocationConfirmed: false };
        const raw = await discovery.text();
        if (raw.length > 128_000) return { revocationConfirmed: false };
        const metadata = JSON.parse(raw);
        const endpoint = new URL(metadata.revocation_endpoint);
        if (
          metadata.issuer !== issuer ||
          endpoint.origin !== issuer ||
          endpoint.username ||
          endpoint.password ||
          endpoint.hash
        )
          return { revocationConfirmed: false };
        const revoked = await this.fetcher(endpoint, {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token,
            token_type_hint: 'refresh_token',
            client_id: profile.clientId,
          }),
        });
        return { revocationConfirmed: revoked.status === 200 };
      } catch {
        return { revocationConfirmed: false };
      }
    });
  }
}
