import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { CredentialVault } from './credentials';

export interface OidcConfiguration {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  /** Scopes whose absence makes inference unavailable; requested != granted. */
  requiredScopes: readonly string[];
}
export interface ProviderTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  scopes: string[];
  subject: string;
  issuer: string;
}
export function secureEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash)
    throw new Error('Provider endpoints must be trusted HTTPS URLs');
  return url;
}
export function sameSecret(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
const randomSecret = () => randomBytes(32).toString('base64url');

/** Shared OIDC validation for enrolled and dynamically enrolled public clients. */
export async function verifyOidcIdentity(
  token: string,
  key: JWTVerifyGetKey,
  issuer: string,
  clientId: string,
  nonce: string | undefined,
  now: number,
) {
  const { payload } = await jwtVerify(token, key, {
    issuer,
    audience: clientId,
    algorithms: ['RS256', 'ES256'],
    requiredClaims: ['sub', 'exp', 'iat', ...(nonce ? ['nonce'] : [])],
    currentDate: new Date(now),
    maxTokenAge: '10m',
  });
  if (
    !payload.sub ||
    (nonce && (typeof payload.nonce !== 'string' || !sameSecret(payload.nonce, nonce)))
  )
    throw new Error('Provider identity nonce mismatch');
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)
    throw new Error('Provider identity authorized party mismatch');
  return payload;
}

/** Server-side OAuth/OIDC connection primitive. Provider endpoints/client enrollment
 * are trusted host configuration, never browser/model arguments. State is bound to
 * the initiating local session and consumed once before exchanging the code. */
export class OidcAccountConnection {
  private readonly pending = new Map<
    string,
    { verifier: string; nonce: string; session: string; expires: number }
  >();
  private readonly key: JWTVerifyGetKey;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  // Credential writes run one at a time, like the ChatGPT account: a logout queued behind an
  // in-flight refresh or sign-in removes what that operation stored, never the other way round.
  private writes: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly config: OidcConfiguration,
    private readonly vault: CredentialVault,
    private readonly account: string,
    options: { fetch?: typeof fetch; keyResolver?: JWTVerifyGetKey; now?: () => number } = {},
  ) {
    for (const endpoint of [
      config.issuer,
      config.authorizationEndpoint,
      config.tokenEndpoint,
      config.jwksUri,
    ])
      secureEndpoint(endpoint);
    const redirect = new URL(config.redirectUri);
    if (
      redirect.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(redirect.hostname) ||
      redirect.hash ||
      redirect.username ||
      redirect.password
    )
      throw new Error('Local sign-in redirect must use a loopback HTTP callback');
    if (!config.clientId || !config.scopes.includes('openid'))
      throw new Error('OIDC client ID and openid scope are required');
    this.key =
      options.keyResolver ??
      createRemoteJWKSet(new URL(config.jwksUri), { timeoutDuration: 5_000 });
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.writes.catch(() => {}).then(work);
    this.writes = result;
    return result;
  }
  begin(localSessionId: string): { authorizationUrl: string; expiresAt: number } {
    if (!localSessionId) throw new Error('Trusted local session required');
    for (const [state, pending] of this.pending)
      if (pending.expires <= this.now()) this.pending.delete(state);
    if (this.pending.size >= 32) throw new Error('Too many pending provider connections');
    const state = randomSecret();
    const nonce = randomSecret();
    const verifier = randomSecret();
    const expiresAt = this.now() + 5 * 60_000;
    this.pending.set(state, { nonce, verifier, session: localSessionId, expires: expiresAt });
    const url = new URL(this.config.authorizationEndpoint);
    for (const [key, value] of Object.entries({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state,
      nonce,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    }))
      url.searchParams.set(key, value);
    return { authorizationUrl: url.toString(), expiresAt };
  }
  private async tokenRequest(parameters: Record<string, string>): Promise<Record<string, unknown>> {
    const response = await this.fetcher(this.config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(parameters),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Provider token exchange was rejected');
    const text = await response.text();
    if (text.length > 128_000) throw new Error('Provider token response exceeded limit');
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new Error('Invalid provider token response');
    return data as Record<string, unknown>;
  }
  private scopes(value: unknown, fallback?: string[]): string[] {
    const scopes = typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : fallback;
    // An omitted initial scope does not establish inference permission. Refresh may
    // retain the already verified grant when the provider omits an unchanged scope.
    if (!scopes || this.config.requiredScopes.some((scope) => !scopes.includes(scope)))
      throw new Error('Provider did not grant the required scopes');
    return scopes;
  }
  complete(
    callbackUrl: string,
    localSessionId: string,
  ): Promise<{ subject: string; scopes: string[]; expiresAt: number }> {
    return this.serial(() => this.completeNow(callbackUrl, localSessionId));
  }
  private async completeNow(
    callbackUrl: string,
    localSessionId: string,
  ): Promise<{ subject: string; scopes: string[]; expiresAt: number }> {
    const url = new URL(callbackUrl);
    const expected = new URL(this.config.redirectUri);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash)
      throw new Error('Provider callback target mismatch');
    const state = url.searchParams.get('state') ?? '';
    const pending = this.pending.get(state);
    if (!pending || !sameSecret(pending.session, localSessionId))
      throw new Error('Invalid provider connection state');
    this.pending.delete(state);
    if (pending.expires <= this.now()) throw new Error('Provider connection expired');
    if (url.searchParams.has('error')) throw new Error('Provider connection was declined');
    const code = url.searchParams.get('code');
    if (!code || code.length > 8_192)
      throw new Error('Provider callback has no valid authorization code');
    const data = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      code_verifier: pending.verifier,
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
    });
    if (
      typeof data.id_token !== 'string' ||
      typeof data.access_token !== 'string' ||
      data.token_type !== 'Bearer'
    )
      throw new Error('Provider token response is incomplete');
    const { payload } = await jwtVerify(data.id_token, this.key, {
      issuer: this.config.issuer,
      audience: this.config.clientId,
      algorithms: ['RS256', 'ES256'],
      requiredClaims: ['sub', 'exp', 'iat', 'nonce'],
      currentDate: new Date(this.now()),
      maxTokenAge: '10m',
    });
    if (
      typeof payload.nonce !== 'string' ||
      !sameSecret(payload.nonce, pending.nonce) ||
      !payload.sub
    )
      throw new Error('Provider identity nonce mismatch');
    if (
      Array.isArray(payload.aud) &&
      payload.aud.length > 1 &&
      payload.azp !== this.config.clientId
    )
      throw new Error('Provider identity authorized party mismatch');
    const scopes = this.scopes(data.scope);
    const expires = Number(data.expires_in);
    if (!Number.isFinite(expires) || expires <= 0 || expires > 366 * 86_400)
      throw new Error('Invalid provider token lifetime');
    const tokens: ProviderTokens = {
      accessToken: data.access_token,
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
      expiresAt: this.now() + expires * 1_000,
      scopes,
      subject: payload.sub,
      issuer: this.config.issuer,
    };
    await this.vault.set(this.account, JSON.stringify(tokens));
    return { subject: tokens.subject, scopes, expiresAt: tokens.expiresAt };
  }
  /** Authority-only token retrieval. Never expose this method over renderer IPC/API. */
  async credentials(): Promise<ProviderTokens | undefined> {
    const stored = await this.vault.get(this.account);
    if (!stored) return undefined;
    const value = JSON.parse(stored) as ProviderTokens;
    if (
      value.issuer !== this.config.issuer ||
      typeof value.accessToken !== 'string' ||
      typeof value.subject !== 'string'
    )
      throw new Error('Stored provider profile does not match configured issuer');
    return value;
  }
  refresh(): Promise<{ expiresAt: number; scopes: string[] }> {
    return this.serial(() => this.refreshNow());
  }
  private async refreshNow(): Promise<{ expiresAt: number; scopes: string[] }> {
    const previous = await this.credentials();
    if (!previous?.refreshToken) throw new Error('Provider profile has no refresh grant');
    const data = await this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: previous.refreshToken,
      client_id: this.config.clientId,
    });
    if (typeof data.access_token !== 'string' || data.token_type !== 'Bearer')
      throw new Error('Provider refresh response is incomplete');
    const scopes = this.scopes(data.scope, previous.scopes);
    const expires = Number(data.expires_in);
    if (!Number.isFinite(expires) || expires <= 0 || expires > 366 * 86_400)
      throw new Error('Invalid provider token lifetime');
    const next = {
      ...previous,
      accessToken: data.access_token,
      refreshToken:
        typeof data.refresh_token === 'string' ? data.refresh_token : previous.refreshToken,
      scopes,
      expiresAt: this.now() + expires * 1_000,
    };
    await this.vault.set(this.account, JSON.stringify(next));
    return { expiresAt: next.expiresAt, scopes };
  }
  logout(): Promise<boolean> {
    this.pending.clear();
    return this.serial(() => this.vault.remove(this.account));
  }
}
