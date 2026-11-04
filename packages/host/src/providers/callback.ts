import { rememberProfile } from './profiles';
import { connectionOf, liveScope, originOf, type ProviderState } from './state';

/** A static result page: no scripts, no styles, no referrer and never cached. */
function callbackPage(success: boolean) {
  return new Response(
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
}

/**
 * The public OAuth callback. It is accepted only for a pending attempt on this origin, whose
 * session is still live in the same local-user scope before and after the exchange; a profile
 * connected while the session was revoked is logged out again. Every failure shows one page.
 */
export async function chatGptCallback(
  state: ProviderState,
  request: Request,
): Promise<Response | undefined> {
  const url = new URL(request.url);
  if (url.pathname !== '/oauth/chatgpt/callback') return undefined;
  const attemptState = url.searchParams.get('state') ?? '';
  const attempt = state.pending.get(attemptState);
  try {
    if (
      request.method !== 'GET' ||
      url.origin !== originOf(state) ||
      request.headers.get('host') !== new URL(originOf(state)).host ||
      request.url.length > 16_384 ||
      !attempt ||
      attempt.expiresAt <= state.now()
    )
      throw new Error('Invalid callback');
    state.pending.delete(attemptState);
    const session = state.options.sessions(attempt.token);
    if (!session || liveScope(state, session) !== attempt.scope)
      throw new Error('Session unavailable');
    const account = connectionOf(state, attempt.scope);
    const profile = await account.complete(request.url, attempt.token);
    try {
      liveScope(state, session);
    } catch {
      await account.logout(profile.id);
      throw new Error('Session revoked during connection');
    }
    rememberProfile(state, attempt.scope, profile);
    state.selected.set(attempt.token, { profileId: profile.id });
    return callbackPage(true);
  } catch {
    return callbackPage(false);
  }
}
