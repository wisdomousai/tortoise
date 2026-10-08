import { createHash, randomBytes } from 'node:crypto';
import { sameSecret } from '../oidc';
import { issuer, type StoredProfile } from './profile-store';
import { resource } from './token-endpoint';

const scopes = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  'chatgpt.tokens.use.direct',
];
const secret = () => randomBytes(32).toString('base64url');

/** One authorization in flight, bound to the local session that began it. */
export type Pending = {
  session: string;
  verifier: string;
  nonce: string;
  expires: number;
  profile?: StoredProfile;
};

/** A PKCE authorization request with fresh state, nonce and verifier. */
export function authorizationRequest(options: {
  readonly hostId: string;
  readonly redirectUri: string;
  readonly appName: string;
  readonly profile?: StoredProfile;
}) {
  const { profile } = options;
  const state = secret();
  const nonce = secret();
  const verifier = secret();
  const url = new URL(`${issuer}/api/accounts/authorize`);
  const parameters: Record<string, string> = {
    client_id: profile?.clientId ?? 'dynamic_agent_client',
    ext_agent_host_id: options.hostId,
    response_type: 'code',
    redirect_uri: options.redirectUri,
    scope: scopes.join(' '),
    resource,
    state,
    nonce,
    code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
  if (!profile) parameters.agent_name_hint = options.appName;
  // This URL crosses the renderer boundary. Omit the optional identity-token
  // hint so no stored provider token enters browser state or navigation URLs.
  // Returning identity is still verified against the saved subject at completion.
  if (profile?.email) parameters.login_hint = profile.email;
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return { url, state, nonce, verifier };
}

/**
 * Check a callback against its pending attempt and return the attempt, issued client ID and
 * code. The attempt is consumed even when a later check fails, so it cannot be replayed.
 */
export function acceptCallback(
  pending: Map<string, Pending>,
  callbackUrl: string,
  redirectUri: string,
  localSessionId: string,
  now: number,
) {
  const url = new URL(callbackUrl);
  const expected = new URL(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash)
    throw new Error('ChatGPT callback target mismatch');
  for (const name of ['state', 'code', 'client_id', 'error'])
    if (url.searchParams.getAll(name).length > 1) throw new Error('Ambiguous ChatGPT callback');
  const state = url.searchParams.get('state') ?? '';
  const attempt = pending.get(state);
  if (!attempt || !sameSecret(attempt.session, localSessionId))
    throw new Error('Invalid ChatGPT connection state');
  pending.delete(state);
  if (attempt.expires <= now) throw new Error('ChatGPT connection expired');
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
  return { attempt, clientId, code };
}
