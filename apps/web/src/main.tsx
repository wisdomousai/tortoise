import { createRoot } from 'react-dom/client';
import { exchangeLaunch } from '@/launch';
import { App } from './app';
import './styles.css';

async function start() {
  await exchangeLaunch();
  createRoot(document.getElementById('root')!).render(<App />);
}
void start().catch((error) => {
  document.getElementById('root')!.textContent =
    error instanceof Error ? error.message : 'Unable to connect';
});
