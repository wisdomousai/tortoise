import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { build } from 'vite';
import {
  browserSource,
  directEgress,
  egressExemptions,
  forbiddenBrowserImport,
  hostSourcePath,
  kernelForbiddenImport,
  nonPortableGlobal,
  portableForbiddenImport,
  portableSource,
  pluginBrowserEntry,
  pluginBrowserSource,
  serverSource,
} from './boundary-rules.ts';

const root = resolve(import.meta.dir, '..');
const errors: string[] = [];
async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', 'dist'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (/\.[cm]?[jt]sx?$/.test(path) && !path.includes('.test.') && !path.endsWith('.pw.ts'))
      result.push(path);
  }
  return result;
}
const all = await files(root);
// A plugin whose manifest lists Android or iOS runs its server part on Hermes, so all of its
// source is portable, like the kernel's.
const mobilePlugins: string[] = [];
for (const file of all) {
  const plugin = /^plugins\/([^/]+)\/src\/plugin-manifest\.ts$/.exec(relative(root, file));
  if (plugin && /platforms:\s*\[[^\]]*'(?:android|ios)'/.test(await readFile(file, 'utf8')))
    mobilePlugins.push(plugin[1]!);
}
const isPortable = (name: string) =>
  portableSource.test(name) ||
  mobilePlugins.some((plugin) => name.startsWith(`plugins/${plugin}/src/`));
/** Comments mention APIs without calling them. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const browserRoots = [
  'packages/contracts/',
  'packages/client/',
  'packages/react/',
  'packages/devices/src/',
  'packages/operator-ui/',
  'packages/frame/src/',
  'packages/host/src/manifest.ts',
  'apps/web/src/',
];
// Content's browser entrypoints: contracts, the manifest, screens and their components.
const browserContent =
  /^examples\/[^/]+\/(?:contracts\.ts|contracts\/|manifest\.ts|screens\.tsx|ui\/)/;
// Layers by directory: framework `packages/*`, plugins `plugins/*`, shell `apps/*`,
// content `examples/*`, and driver SDKs `sdks/*`.
// Imports resolve through relative paths and workspace package names alike, so an alias such as
// `@agent-native/line-station` cannot bypass a rule that a relative path would break.
type Layer = 'framework' | 'plugin' | 'shell' | 'content' | 'sdk';
const layerDirectories: Record<string, Layer> = {
  packages: 'framework',
  plugins: 'plugin',
  apps: 'shell',
  examples: 'content',
  sdks: 'sdk',
};
const packageLayers = new Map<string, Layer>();
for (const [directory, layer] of Object.entries(layerDirectories))
  for (const entry of await readdir(resolve(root, directory), { withFileTypes: true }))
    if (entry.isDirectory()) {
      const manifest = await readFile(resolve(root, directory, entry.name, 'package.json'), 'utf8')
        .then((text) => JSON.parse(text) as { name?: string })
        .catch(() => undefined);
      if (manifest?.name) packageLayers.set(manifest.name, layer);
    }
function layerOfPath(path: string): Layer | undefined {
  return layerDirectories[relative(root, path).replaceAll('\\', '/').split('/')[0]!];
}
function layerOfImport(file: string, dependency: string): Layer | undefined {
  if (dependency.startsWith('.')) return layerOfPath(resolve(file, '..', dependency));
  const [scope, name] = dependency.split('/');
  return packageLayers.get(scope!.startsWith('@') ? `${scope}/${name}` : scope!);
}

/** `@agent-native/<plugin>` or a subpath of it that is not one of its browser entrypoints. */
function serverPluginEntry(dependency: string) {
  const [scope, name, ...rest] = dependency.split('/');
  const pkg = `${scope}/${name}`;
  return packageLayers.get(pkg) === 'plugin' && !pluginBrowserEntry.test(rest.join('/'));
}

for (const file of all) {
  const name = relative(root, file).replaceAll('\\', '/');
  const source = await readFile(file, 'utf8');
  const imports = [
    ...source.matchAll(
      /(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g,
    ),
  ].map((match) => match[1] ?? match[2]!);
  for (const dependency of imports) {
    const from = layerOfPath(file);
    const to = layerOfImport(file, dependency);
    if (from === 'framework' && (to === 'shell' || to === 'content' || to === 'plugin'))
      errors.push(`${name}: framework imports ${to} ${dependency}`);
    // A plugin builds on the framework and on plugins it requires; the application lists it, so
    // neither the starter nor the plugin reaches into an application or the starter.
    if (from === 'plugin' && (to === 'shell' || to === 'content'))
      errors.push(`${name}: plugin imports ${to} ${dependency}`);
    if (from === 'shell' && to === 'plugin')
      errors.push(`${name}: shell imports plugin ${dependency}; the application composes plugins`);
    // The starter learns its content only from configuration; content implements framework
    // contracts and never reaches into the starter that happens to host it.
    if (from === 'shell' && to === 'content')
      errors.push(`${name}: shell imports content ${dependency}; name it in app.config.json`);
    if (from === 'content' && to === 'shell')
      errors.push(`${name}: content imports shell ${dependency}`);
    // A language SDK builds on the driver base only. The base and everything above it speak to a
    // driver through the wire protocol, so no host code depends on one language's SDK, and an SDK
    // is proven against the base's reference contract, never an application, so any one can use it.
    if (from !== 'sdk' && to === 'sdk')
      errors.push(
        `${name}: ${from} imports SDK ${dependency}; host code reaches a driver only through the protocol`,
      );
    if (from === 'sdk' && (to === 'shell' || to === 'content'))
      errors.push(
        `${name}: SDK imports ${to} ${dependency}; an SDK is tested against the base's reference contract so that every application can use it`,
      );
    if (
      (name.startsWith('packages/host/src/') || name.startsWith('packages/kernel/src/')) &&
      kernelForbiddenImport.test(
        dependency.startsWith('.')
          ? relative(root, resolve(file, '..', dependency)).replaceAll('\\', '/')
          : dependency,
      )
    )
      errors.push(`${name}: the host imports plugin code ${dependency}; compose it as a plugin`);
    if (
      (browserRoots.some((prefix) => name.startsWith(prefix)) ||
        browserContent.test(name) ||
        pluginBrowserSource.test(name)) &&
      // A server entrypoint inside a browser-safe package (devices/server) is itself host code.
      !hostSourcePath.test(file) &&
      (forbiddenBrowserImport.test(dependency) ||
        serverPluginEntry(dependency) ||
        (dependency.startsWith('.') && hostSourcePath.test(resolve(file, '..', dependency))))
    )
      errors.push(`${name}: browser imports host module ${dependency}`);
    if (isPortable(name) && !portableImport(file, dependency))
      errors.push(`${name}: portable source imports ${dependency}, which needs Node or Bun`);
  }
  if (isPortable(name) && nonPortableGlobal.test(withoutComments(source)))
    errors.push(`${name}: portable source uses a Node or Bun global`);
}
/** Whether portable source may import `dependency`: no built-in or Bun-only package, and a
 * relative import must land in portable source too. */
function portableImport(file: string, dependency: string) {
  if (portableForbiddenImport.test(dependency)) return false;
  // A stylesheet is compiled by the bundler (Uniwind on React Native), not run.
  if (!dependency.startsWith('.') || dependency.endsWith('.css')) return true;
  const target = relative(root, resolve(file, '..', dependency)).replaceAll('\\', '/');
  // An example's browser-safe modules (contracts, manifest) already reach neither Node nor Bun.
  return [target, `${target}.ts`, `${target}.tsx`].some(
    (path) => isPortable(path) || browserContent.test(path),
  );
}
// Server code connects to other hosts only through the egress guard; see `egressExemptions`.
const exemptionUsed = new Set<string>();
for (const file of all) {
  const name = relative(root, file).replaceAll('\\', '/');
  if (!serverSource.test(name) || browserSource.test(name) || pluginBrowserSource.test(name))
    continue;
  const source = withoutComments(await readFile(file, 'utf8'));
  const found = directEgress.filter((rule) => rule.pattern.test(source)).map((rule) => rule.api);
  if (!found.length) continue;
  const exemption = Object.keys(egressExemptions).find((prefix) => name.startsWith(prefix));
  if (exemption) exemptionUsed.add(exemption);
  else errors.push(`${name}: direct ${found.join(', ')} bypasses the egress guard`);
}
for (const exemption of Object.keys(egressExemptions))
  if (!exemptionUsed.has(exemption))
    errors.push(`scripts/boundary-rules.ts: stale egress exemption ${exemption}`);
// Bundling each application with the starter's real config catches transitive host dependencies
// as well as direct ones: the boundary plugin in apps/web/vite.config.ts fails the graph.
const applications = [];
for (const entry of await readdir(resolve(root, 'examples'), { withFileTypes: true }))
  if (
    entry.isDirectory() &&
    (await Bun.file(resolve(root, 'examples', entry.name, 'screens.tsx')).exists())
  )
    applications.push(resolve(root, 'examples', entry.name));
const configured = process.env.AGENT_NATIVE_APPLICATION;
for (const application of applications) {
  process.env.AGENT_NATIVE_APPLICATION = application;
  try {
    await build({
      configFile: resolve(root, 'apps/web/vite.config.ts'),
      logLevel: 'silent',
      build: { write: false, sourcemap: false },
    });
  } catch (error) {
    errors.push(
      `${relative(root, application)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
if (configured === undefined) delete process.env.AGENT_NATIVE_APPLICATION;
else process.env.AGENT_NATIVE_APPLICATION = configured;
if (errors.length) throw new Error(errors.join('\n'));
console.log(
  `Checked ${all.length} source files and the browser dependency graph of ${applications.length} applications`,
);
