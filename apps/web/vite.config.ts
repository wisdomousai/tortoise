import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { readApplicationIdentity } from '../desktop/src/application-identity.ts';
import { browserBoundary } from '../../scripts/vite-browser-boundary.ts';

const repository = resolve(import.meta.dirname, '../..');
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

/** The window title comes from the trusted application identity, never from the template. */
function applicationTitle(): Plugin {
  return {
    name: 'application-title',
    transformIndexHtml(html) {
      if (!/<title>[\s\S]*?<\/title>/i.test(html))
        throw new Error('Browser HTML template requires a title');
      const { displayName } = readApplicationIdentity(resolve(repository, 'app.config.json'));
      return html.replace(
        /<title>[\s\S]*?<\/title>/i,
        () => `<title>${escapeHtml(displayName)}</title>`,
      );
    },
  };
}

// Output stays at dist/web with flat file names: the local authority serves a flat directory
// under a strict CSP (no inline scripts or styles), and Electron packages it unchanged.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [browserBoundary(repository), react(), tailwindcss(), applicationTitle()],
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src') } },
  build: {
    outDir: resolve(repository, 'dist/web'),
    emptyOutDir: true,
    assetsDir: '',
    sourcemap: true,
    modulePreload: { polyfill: false },
    // Served from loopback or the packaged app, so one bundle beats extra round trips.
    chunkSizeWarningLimit: 1_000,
  },
});
