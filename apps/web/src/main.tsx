import { createRoot } from 'react-dom/client';
import { App } from './app';
import './styles.css';

async function start() {
  // A launch link carries a one-time credential in the fragment; exchange it for the session
  // cookie and drop it from the address bar before any route renders.
  const launch = new URLSearchParams(location.hash.slice(1)).get('launch');
  if (launch) {
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
  createRoot(document.getElementById('root')!).render(<App />);
}
void start().catch((error) => {
  document.getElementById('root')!.textContent =
    error instanceof Error ? error.message : 'Unable to connect';
});
