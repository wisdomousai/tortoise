import type { ChatGptCredentials } from '../chatgpt';
import { issuer } from './profile-store';

export const resource = 'https://api.openai.com/v1';

/** Whether the granted scopes allow inference on the person's ChatGPT plan. */
export const inferenceGranted = (granted: string[]) =>
  ['resource.invoke', 'chatgpt.tokens.use.direct'].every((scope) => granted.includes(scope));

/** One bounded token-endpoint exchange; redirects and oversized responses are refused. */
export async function tokenRequest(
  fetcher: typeof fetch,
  parameters: Record<string, string>,
): Promise<Record<string, unknown>> {
  const response = await fetcher(`${issuer}/api/accounts/oauth/token`, {
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

/** Bearer tokens from a response; a refresh may omit the identity and refresh tokens. */
export function parseTokens(
  data: Record<string, unknown>,
  now: number,
  previous?: ChatGptCredentials,
): ChatGptCredentials {
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
    expiresAt: now + expires * 1_000,
    earliestRefreshAt: data.earliest_refresh_at,
  };
}

export function grantedScopes(data: Record<string, unknown>, previous?: string[]) {
  if (data.scope !== undefined && typeof data.scope !== 'string')
    throw new Error('Invalid ChatGPT granted scopes');
  return typeof data.scope === 'string'
    ? data.scope.split(/\s+/).filter(Boolean)
    : (previous ?? []);
}

/**
 * Revoke a refresh token at the endpoint the issuer's discovery document names, if it is on
 * the issuer's origin. Any failure reports an unconfirmed revocation instead of throwing.
 */
export async function revokeRefreshToken(
  fetcher: typeof fetch,
  token: string,
  clientId: string,
): Promise<boolean> {
  try {
    const discovery = await fetcher(`${issuer}/.well-known/openid-configuration`, {
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!discovery.ok) return false;
    const raw = await discovery.text();
    if (raw.length > 128_000) return false;
    const metadata = JSON.parse(raw);
    const endpoint = new URL(metadata.revocation_endpoint);
    if (
      metadata.issuer !== issuer ||
      endpoint.origin !== issuer ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash
    )
      return false;
    const revoked = await fetcher(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, token_type_hint: 'refresh_token', client_id: clientId }),
    });
    return revoked.status === 200;
  } catch {
    return false;
  }
}
