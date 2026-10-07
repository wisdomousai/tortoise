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

/**
 * `@/` resolves against this app first, then against the operator registry sources. Registry
 * items import `@/components/ui/button` and `@/hooks/use-scanner` exactly as they will after
 * `shadcn add`; here they are used in place, so the app's own primitives and `lib/utils` satisfy
 * their imports and the registry copies never drift from what consumers pull.
 */
function registryFallback(roots: readonly string[]): Plugin {
  return {
    name: 'registry-fallback-alias',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!source.startsWith('@/')) return null;
      for (const base of roots) {
        const resolved = await this.resolve(resolve(base, source.slice(2)), importer, {
          ...options,
          skipSelf: true,
        });
        if (resolved) return resolved;
      }
      return null;
    },
  };
}

// Output stays at dist/web with flat file names: the local authority serves a flat directory
// under a strict CSP (no inline scripts or styles), and Electron packages it unchanged.
export default defineConfig({
  root: import.meta.dirname,
  base: './',
  plugins: [
    registryFallback([
      resolve(import.meta.dirname, 'src'),
      resolve(repository, 'packages/operator-ui/src'),
    ]),
    browserBoundary(repository),
    react(),
    tailwindcss(),
    applicationTitle(),
  ],
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
