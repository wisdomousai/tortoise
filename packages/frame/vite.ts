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
 * Build-time wiring of the web frame for the starter's configured application:
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
      // Tailwind only scans the Vite root and explicit `@source` paths. The frame and the
      // application's screens live outside the starter, so without this their classes (the
      // shell layout among them) are never generated. Added to the stylesheet that imports
      // Tailwind, before the Tailwind plugin reads it.
      name: 'agent-native-tailwind-sources',
      enforce: 'pre',
      async transform(code, id) {
        if (!id.endsWith('.css') || !/@import\s+['"]tailwindcss['"]/.test(code)) return null;
        const entry = await this.resolve(screens, join(options.appSource, 'main.tsx'));
        if (!entry) throw new Error(`Cannot resolve the application's screens: ${screens}`);
        const sources = [join(import.meta.dirname, 'src'), dirname(entry.id)];
        return `${code}\n${sources.map((path) => `@source ${JSON.stringify(path)};`).join('\n')}\n`;
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
