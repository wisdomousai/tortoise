import { createRoot } from 'react-dom/client';
import { exchangeLaunch } from '@/launch';
import { App } from './app';
// Bundled, so the typeface works offline and under the `font-src 'self'` policy.
import '@fontsource-variable/ibm-plex-sans';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles.css';

// The `.dark` tokens in styles.css apply under this class; follow the OS color scheme.
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');
const applyScheme = () => document.documentElement.classList.toggle('dark', darkScheme.matches);
applyScheme();
darkScheme.addEventListener('change', applyScheme);

async function start() {
  await exchangeLaunch();
  createRoot(document.getElementById('root')!).render(<App />);
}
void start().catch((error) => {
  document.getElementById('root')!.textContent =
    error instanceof Error ? error.message : 'Unable to connect';
});
