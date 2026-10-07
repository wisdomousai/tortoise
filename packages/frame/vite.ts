import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { loadManifest, readStarterConfig } from '@agent-native/host/config';

const SCREENS = 'virtual:agent-native/screens';
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

/**
 * Build-time wiring of the web frame for the starter's configured application (P11):
 *
 * - `virtual:agent-native/screens` resolves to that application's `screens` entrypoint, so the
 *   starter's source never names content;
 * - `@/` resolves against the starter's own `src` first, then the frame and operator registry
 *   sources. Registry files import `@/components/ui/button` exactly as they will after `shadcn
 *   add`; here they are used in place, so a starter file at the same path shadows the frame's;
 * - the window title comes from the trusted starter identity, never from the template.
 *
 * Returns the plugins and the output directory `dist/web/<application id>` under `repository`.
 * Fails when the configuration is invalid or the application has no manifest.
 */
export async function frame(options: { appSource: string; configPath: string; outRoot: string }) {
  const config = readStarterConfig(options.configPath);
  const manifest = await loadManifest(config);
  const require = createRequire(import.meta.url);
  const roots = [
    options.appSource,
    join(import.meta.dirname, 'src'),
    join(dirname(require.resolve('@agent-native/operator-ui/package.json')), 'src'),
  ];
  const screens = isAbsolute(config.application)
    ? join(config.application, 'screens')
    : `${config.application}/screens`;
  const plugins: Plugin[] = [
    {
      name: 'agent-native-application-screens',
      resolveId: (source) => (source === SCREENS ? `\0${SCREENS}` : null),
      load: (id) =>
        id === `\0${SCREENS}` ? `export { default } from ${JSON.stringify(screens)};` : null,
    },
    {
      name: 'registry-fallback-alias',
      enforce: 'pre',
      async resolveId(source, importer, resolveOptions) {
        if (!source.startsWith('@/')) return null;
        for (const base of roots) {
          const resolved = await this.resolve(resolve(base, source.slice(2)), importer, {
            ...resolveOptions,
            skipSelf: true,
          });
          if (resolved) return resolved;
        }
        return null;
      },
    },
    {
      name: 'application-title',
      transformIndexHtml(html) {
        if (!/<title>[\s\S]*?<\/title>/i.test(html))
          throw new Error('Browser HTML template requires a title');
        return html.replace(
          /<title>[\s\S]*?<\/title>/i,
          () => `<title>${escapeHtml(config.displayName)}</title>`,
        );
      },
    },
  ];
  return { plugins, manifest, outDir: join(options.outRoot, manifest.id) };
}
