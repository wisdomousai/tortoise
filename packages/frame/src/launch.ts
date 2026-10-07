/**
 * Exchange a launch link's one-time credential for the session cookie, before any route renders.
 * The credential travels in the fragment, so it never reaches a server log; it is dropped from
 * the address bar first. Fails when the link expired or was already used.
 */
export async function exchangeLaunch() {
  const launch = new URLSearchParams(location.hash.slice(1)).get('launch');
  if (!launch) return;
  history.replaceState(null, '', location.pathname);
  const response = await fetch('/api/v1/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ launch }),
  });
  if (!response.ok)
    throw new Error(
      'This launch link expired or was already used. Open a fresh link from the local host.',
    );
}
