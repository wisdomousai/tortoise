import { randomUUID } from 'node:crypto';
import {
  createRemoteJWKSet,
  customFetch,
  type FetchImplementation,
  type JWTVerifyGetKey,
} from 'jose';
import type { CredentialVault } from './credentials';
import { verifyOidcIdentity } from './oidc';
import { acceptCallback, authorizationRequest, type Pending } from './chatgpt/authorization';
import {
  findEnrollment,
  hostId,
  issuer,
  profileIds,
  readProfile,
  safeProfile,
  saveEnrolledProfile,
  writeProfile,
  type StoredProfile,
} from './chatgpt/profile-store';
import {
  grantedScopes,
  inferenceGranted,
  parseTokens,
  resource,
  revokeRefreshToken,
  tokenRequest,
} from './chatgpt/token-endpoint';

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

function assertLoopbackCallback(redirectUri: string) {
  const callback = new URL(redirectUri);
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
}

/** ChatGPT dynamic public-client enrollment. Only opaque safe profile metadata may
 * cross the service boundary. Tokens, ID hints and authorization URLs are secrets:
 * do not persist them in runs, logs, browser storage or the business database. */
export class ChatGptAccountConnection {
  private readonly pending = new Map<string, Pending>();
  private readonly key: JWTVerifyGetKey;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly vault: CredentialVault;
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: ChatGptConnectionOptions) {
    assertLoopbackCallback(options.redirectUri);
    if (!options.appName.trim() || options.appName.length > 120 || /[\r\n\0]/.test(options.appName))
      throw new Error('Stable application name is required');
    this.vault = options.vault;
    this.fetcher = options.fetch ?? fetch;
    this.key =
      options.keyResolver ??
      createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), {
        timeoutDuration: 5_000,
        // Key fetches use the injected (egress-guarded) fetch too, not jose's global one.
        ...(options.fetch
          ? { [customFetch]: options.fetch as unknown as FetchImplementation }
          : {}),
      });
    this.now = options.now ?? Date.now;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.catch(() => {}).then(work);
    this.writes = result;
    return result;
  }
  async profiles(): Promise<ChatGptProfile[]> {
    return this.serial(async () =>
      Promise.all(
        (await profileIds(this.vault)).map(async (id) =>
          safeProfile(await readProfile(this.vault, id)),
        ),
      ),
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
      const profile = profileId ? await readProfile(this.vault, profileId) : undefined;
      const expiresAt = this.now() + 300_000;
      const { url, state, nonce, verifier } = authorizationRequest({
        hostId: await hostId(this.vault),
        redirectUri: this.options.redirectUri,
        appName: this.options.appName,
        profile,
      });
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
  async complete(callbackUrl: string, localSessionId: string): Promise<ChatGptProfile> {
    return this.serial(async () => {
      const { redirectUri } = this.options;
      const { attempt, clientId, code } = acceptCallback(
        this.pending,
        callbackUrl,
        redirectUri,
        localSessionId,
        this.now(),
      );
      const data = await tokenRequest(this.fetcher, {
        grant_type: 'authorization_code',
        code,
        code_verifier: attempt.verifier,
        client_id: clientId,
        redirect_uri: redirectUri,
        resource,
      });
      const tokens = parseTokens(data, this.now());
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
      const granted = grantedScopes(data);
      const ids = await profileIds(this.vault);
      const existing = await findEnrollment(this.vault, ids, clientId, identity.sub);
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
      await saveEnrolledProfile(this.vault, ids, profile);
      return safeProfile(profile);
    });
  }
  /** Authority only; even opaque token introspection must not reach the renderer. */
  async credentials(profileId: string): Promise<ChatGptCredentials> {
    return this.serial(async () => {
      const profile = await readProfile(this.vault, profileId);
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
      const profile = await readProfile(this.vault, profileId);
      const previous = profile.tokens;
      if (!previous?.refreshToken) throw new Error('ChatGPT profile has no refresh grant');
      const data = await tokenRequest(this.fetcher, {
        grant_type: 'refresh_token',
        client_id: profile.clientId,
        refresh_token: previous.refreshToken,
        resource,
      });
      const tokens = parseTokens(data, this.now(), previous);
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
      const granted = grantedScopes(data, profile.scopes);
      const next: StoredProfile = {
        ...profile,
        tokens,
        connected: true,
        scopes: granted,
        planUsageEnabled: inferenceGranted(granted),
        expiresAt: tokens.expiresAt,
      };
      await writeProfile(this.vault, next);
      return safeProfile(next);
    });
  }
  async logout(profileId: string): Promise<{ revocationConfirmed: boolean }> {
    return this.serial(async () => {
      const profile = await readProfile(this.vault, profileId);
      const token = profile.tokens?.refreshToken;
      // Clearing tokens is authoritative even when the provider is unreachable.
      await writeProfile(this.vault, {
        ...safeProfile(profile),
        connected: false,
        planUsageEnabled: false,
        scopes: [],
        expiresAt: undefined,
      });
      for (const [state, attempt] of this.pending)
        if (attempt.profile?.id === profileId) this.pending.delete(state);
      if (!token) return { revocationConfirmed: false };
      return {
        revocationConfirmed: await revokeRefreshToken(this.fetcher, token, profile.clientId),
      };
    });
  }
}
