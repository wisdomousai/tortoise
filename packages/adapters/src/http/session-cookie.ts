/**
 * The browser session cookie. Browsers scope a cookie by host and ignore the port, so two hosts
 * on one machine, such as a fleet on 4340 and a site on 4359, would overwrite each other's
 * session under one name. A host on a port other than its scheme's default names the cookie
 * after its port.
 */
export function sessionCookieName(origin: string) {
  const { port } = new URL(origin);
  return port ? `agent_session_${port}` : 'agent_session';
}

/** The session token the request's cookie carries for `origin`, if any. */
export function readSessionCookie(request: Request, origin: string) {
  const name = sessionCookieName(origin);
  for (const pair of request.headers.get('cookie')?.split(';') ?? []) {
    const [key, value] = pair.trim().split('=', 2);
    if (key === name && value && /^[A-Za-z0-9_-]+$/.test(value)) return value;
  }
  return undefined;
}

/** A `Set-Cookie` value holding `token` for `origin`; an empty token and zero age clear it. */
export function sessionCookie(origin: string, token: string, maxAgeSeconds: number) {
  const secure = new URL(origin).protocol === 'https:' ? '; Secure' : '';
  return `${sessionCookieName(origin)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}
