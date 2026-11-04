import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { deploymentCatalog } from '@tortoise/host/components';
import { loadManifest, readStarterConfig, type StarterConfig } from '@tortoise/host/config';
import type { ApplicationManifest } from '@tortoise/host/manifest';
import { webManifestOs } from '@tortoise/shell';

const SCREENS = 'virtual:agent-native/screens';
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  );

/** A monogram icon from the display name, so an installed web app has an icon of its own. */
function iconSvg(displayName: string) {
  const letter = escapeHtml(displayName.trim().charAt(0).toUpperCase() || 'A');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#18181b"/><text x="256" y="256" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="300" font-weight="600" fill="#fafafa">${letter}</text></svg>\n`;
}

/**
 * The web app manifest: the trusted identity's name and an icon, plus the protocol and file
 * handlers and shortcuts generated from the application's declared OS handlers. A Chromium
 * browser registers them only when the person installs the application.
 */
function webManifest(config: StarterConfig, manifest: ApplicationManifest) {
  const os = webManifestOs(deploymentCatalog(manifest).os, {
    appId: config.appId,
    scheme: config.scheme,
    displayName: config.displayName,
  });
  return `${JSON.stringify(
    {
      id: './',
      name: config.displayName,
      short_name: config.displayName,
      start_url: './',
      scope: './',
      display: 'standalone',
      icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      ...os,
    },
    null,
    2,
  )}\n`;
}

/** The window title from the trusted identity, and the manifest and icon links. */
function titlePlugin(displayName: string): Plugin {
  return {
    name: 'application-title',
    transformIndexHtml(html) {
      if (!/<title>[\s\S]*?<\/title>/i.test(html))
        throw new Error('Browser HTML template requires a title');
      return {
        html: html.replace(
          /<title>[\s\S]*?<\/title>/i,
          () => `<title>${escapeHtml(displayName)}</title>`,
        ),
        tags: [
          { tag: 'link', attrs: { rel: 'manifest', href: './manifest.webmanifest' } },
          { tag: 'link', attrs: { rel: 'icon', href: './icon.svg', type: 'image/svg+xml' } },
        ],
      };
    },
  };
}

/** Serve `manifest.webmanifest` and `icon.svg` in development and emit them into the build. */
function webManifestPlugin(config: StarterConfig, manifest: ApplicationManifest): Plugin {
  const files: Record<string, { type: string; body: string }> = {
    'manifest.webmanifest': {
      type: 'application/manifest+json',
      body: webManifest(config, manifest),
    },
    'icon.svg': { type: 'image/svg+xml', body: iconSvg(config.displayName) },
  };
  return {
    name: 'application-web-manifest',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = request.url ? files[request.url.split('?')[0]!.slice(1)] : undefined;
        if (!file) return next();
        response.setHeader('Content-Type', file.type);
        response.end(file.body);
      });
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(files))
        this.emitFile({ type: 'asset', fileName, source: file.body });
    },
  };
}

/**
 * Build-time wiring of the web frame for the starter's configured application:
 *
 * - `virtual:agent-native/screens` resolves to that application's `screens` entrypoint, so the
 *   starter's source never names content;
 * - `@/` resolves against the starter's own `src` first, then the frame and operator registry
 *   sources. Registry files import `@/components/ui/button` exactly as they will after `shadcn
 *   add`; here they are used in place, so a starter file at the same path shadows the frame's;
 * - the window title comes from the trusted starter identity, never from the template;
 * - `manifest.webmanifest` and `icon.svg` are generated from that identity and the declared OS
 *   handlers, served in development and emitted into the build.
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
    join(dirname(require.resolve('@tortoise/operator-ui/package.json')), 'src'),
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
    titlePlugin(config.displayName),
    webManifestPlugin(config, manifest),
  ];
  return { plugins, manifest, outDir: join(options.outRoot, manifest.id) };
}
