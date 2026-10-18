/**
 * The data behind the overview map in `docs/overview.md`, written by `bun run generate` to
 * `dist/reference/overview.json`. Workspaces, dependency edges, plugin requirements, example
 * compositions and each example's declared destinations come from manifests, READMEs and the
 * catalog. The request paths, properties and port table come from `overview-curated.ts`, and every
 * file, test name and doc anchor they name is checked here. A check that fails throws, so a stale
 * map fails `bun run check`. Reads files and pure manifests only, like the other generators.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ApplicationManifest } from '@agent-native/host';
import { defaultPorts } from '@agent-native/kernel';
import { deploymentCatalog, deploymentComponents } from '@agent-native/host/components';
import { securityManifest } from '@agent-native/compliance';
import * as curated from './overview-curated';
import { importedPackages, workspaces, type Workspace } from './workspace-manifests';

/** Display names for the layers the root `workspaces` field lists; others use the directory. */
const layerTitles: Record<string, string> = {
  packages: 'Framework',
  plugins: 'Plugins',
  apps: 'Starter',
  examples: 'Examples',
  sdks: 'Driver SDKs',
};

const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');
const stripLinks = (text: string) => text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

/** The heading slug VitePress gives a heading (`@mdit-vue/shared` slugify). */
export function slug(heading: string): string {
  return heading
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

/** The first paragraph after the title, with links reduced to their text. */
function readmeLead(markdown: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line, index) => index > 0 && line.trim() && !line.startsWith('#'));
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && !line.trim());
  return stripLinks(
    lines
      .slice(start, end < 0 ? undefined : end)
      .join(' ')
      .trim(),
  );
}

/** The primitives a README's `## Primitives` section links, by anchor. */
function readmePrimitives(markdown: string) {
  const section = /^## Primitives\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(markdown)?.[1] ?? '';
  const found = new Map<string, string>();
  for (const [, title, anchor] of section.matchAll(
    /\[([^\]]+)\]\([^)#]*primitives\.md#([\w-]+)\)/g,
  ))
    found.set(anchor!, title!);
  return [...found].map(([anchor, title]) => ({ anchor, title }));
}

function skillsOf(root: string, directory: string) {
  const skills = join(root, directory, 'skills');
  if (!existsSync(skills)) return [];
  return readdirSync(skills)
    .filter((name) => existsSync(join(skills, name, 'SKILL.md')))
    .sort()
    .map((name) => ({
      directory: `${directory}/skills/${name}`,
      name:
        /^name:\s*(.+)$/m.exec(read(root, `${directory}/skills/${name}/SKILL.md`))?.[1]?.trim() ??
        name,
    }));
}

/** The longest chain of same-layer dependencies below each workspace, for column order. */
function depths(edges: ReadonlyMap<string, readonly string[]>): Map<string, number> {
  const depth = new Map<string, number>();
  const visit = (name: string, trail: Set<string>): number => {
    const known = depth.get(name);
    if (known !== undefined) return known;
    if (trail.has(name)) throw new Error(`Dependency cycle through ${name}`);
    trail.add(name);
    const below = (edges.get(name) ?? []).map((next) => visit(next, trail) + 1);
    trail.delete(name);
    const value = Math.max(0, ...below);
    depth.set(name, value);
    return value;
  };
  for (const name of edges.keys()) visit(name, new Set());
  return depth;
}

/** The plugin's server entry and manifest files, at `src/` or at the package root. */
const pluginFile = (root: string, directory: string, name: string) =>
  [`${directory}/src/${name}.ts`, `${directory}/${name}.ts`].find((path) =>
    existsSync(join(root, path)),
  );

interface PluginSummary {
  readonly id: string;
  readonly title: string;
  readonly settings: readonly string[];
  readonly platforms: readonly string[];
}

interface PluginBase {
  readonly directory: string;
  readonly name: string;
  readonly requires: readonly string[];
}

/** A workspace under `plugins/`: a host plugin with a manifest, or a connector library. */
export type PluginEntry =
  | (PluginBase & { readonly kind: 'host-plugin' } & PluginSummary)
  | (PluginBase & { readonly kind: 'library' });

/** The fields of a host plugin manifest this script reads. */
interface ManifestFields {
  readonly id: string;
  readonly title: string;
  readonly settings?: readonly { readonly key: string }[];
  readonly platforms?: readonly string[];
}

const isManifest = (value: unknown): value is ManifestFields =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  typeof (value as { title?: unknown }).title === 'string' &&
  Array.isArray((value as { modules?: unknown }).modules);

/** A plugin manifest module exports the manifest, or a factory such as `driverPluginManifest`. */
async function pluginManifest(path: string): Promise<PluginSummary> {
  const exports = Object.values((await import(path)) as Record<string, unknown>);
  const value =
    exports.find(isManifest) ??
    exports
      .filter(
        (entry): entry is (contracts: readonly never[]) => unknown => typeof entry === 'function',
      )
      .map((factory) => {
        try {
          return factory([]);
        } catch {
          return undefined;
        }
      })
      .find(isManifest);
  if (!value) throw new Error(`${path} exports no plugin manifest`);
  return {
    id: value.id,
    title: value.title,
    settings: (value.settings ?? []).map((setting) => setting.key),
    platforms: value.platforms ?? ['bun'],
  };
}

function checkFile(root: string, path: string, where: string) {
  if (!existsSync(join(root, path))) throw new Error(`${where}: ${path} does not exist`);
}

function checkTest(root: string, reference: curated.TestReference, where: string) {
  checkFile(root, reference.file, where);
  const source = read(root, reference.file);
  const quoted = ["'", '"', '`'].map((quote) => {
    const escaped = reference.test.replaceAll(quote, `\\${quote}`);
    return `${quote}${escaped}${quote}`;
  });
  if (!quoted.some((text) => new RegExp(`\\b(?:test|it)\\(\\s*${escapeRegExp(text)}`).test(source)))
    throw new Error(`${where}: no test named "${reference.test}" in ${reference.file}`);
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Checks that a guide and heading exist and returns the link title, such as "Agents: Proposals". */
function checkDoc(root: string, reference: curated.DocReference, where: string): string {
  const [page, anchor] = reference.split('#');
  const path = `docs/${page}.md`;
  checkFile(root, path, where);
  const markdown = read(root, path);
  const title = stripLinks(/^# (.+)$/m.exec(markdown)?.[1] ?? page!);
  if (!anchor) return title;
  const heading = [...markdown.matchAll(/^#{2,6}\s+(.+)$/gm)]
    .map(([, text]) => text!)
    .find((text) => slug(text) === anchor);
  if (!heading) throw new Error(`${where}: ${path} has no heading #${anchor}`);
  return `${title}: ${stripLinks(heading).replace(/^./, (letter) => letter.toLowerCase())}`;
}

export async function overview(root: string, manifests: readonly ApplicationManifest[]) {
  const layers = (JSON.parse(read(root, 'package.json')) as { workspaces: string[] }).workspaces
    .map((pattern) => pattern.replace(/\/\*$/, ''))
    .map((directory) => ({ directory, title: layerTitles[directory] ?? directory }));

  // Workspaces and their framework dependencies. Packages and plugins declare theirs in
  // package.json; apps, examples and other layers declare none, so their imports are scanned.
  const found = workspaces(
    root,
    layers.map((layer) => layer.directory),
  );
  const byName = new Map(found.map((workspace) => [workspace.manifest.name, workspace]));
  const dependencies = (workspace: Workspace) => {
    const declared = Object.keys(workspace.manifest.dependencies ?? {});
    const names = declared.length ? declared : [...importedPackages(root, workspace)];
    return names.filter((name) => name !== workspace.manifest.name && byName.has(name)).sort();
  };
  const edges = new Map(
    found.map((workspace) => [workspace.manifest.name, dependencies(workspace)]),
  );
  const layerOf = (workspace: Workspace) => workspace.directory.split('/')[0]!;
  const sameLayer = new Map(
    found.map((workspace) => [
      workspace.manifest.name,
      edges
        .get(workspace.manifest.name)!
        .filter((name) => layerOf(byName.get(name)!) === layerOf(workspace)),
    ]),
  );
  const depth = depths(sameLayer);

  // Host plugins have a manifest; connector packages under plugins/ are libraries.
  const plugins: PluginEntry[] = [];
  for (const workspace of found.filter((entry) => layerOf(entry) === 'plugins')) {
    const manifestPath = pluginFile(root, workspace.directory, 'plugin-manifest');
    const serverPath = pluginFile(root, workspace.directory, 'plugin');
    const requires = serverPath
      ? [...read(root, serverPath).matchAll(/\brequires:\s*\[([^\]]*)\]/g)].flatMap(([, list]) =>
          [...list!.matchAll(/'([a-z0-9-]+)'/g)].map(([, id]) => id!),
        )
      : [];
    const base = {
      directory: workspace.directory,
      name: workspace.manifest.name,
      requires: [...new Set(requires)].sort(),
    };
    plugins.push(
      manifestPath
        ? { ...base, kind: 'host-plugin', ...(await pluginManifest(join(root, manifestPath))) }
        : { ...base, kind: 'library' },
    );
  }
  const pluginIds = new Set(
    plugins.flatMap((plugin) => (plugin.kind === 'host-plugin' ? [plugin.id] : [])),
  );
  for (const plugin of plugins)
    for (const required of plugin.requires)
      if (!pluginIds.has(required))
        throw new Error(`${plugin.directory} requires "${required}", which no plugin declares`);

  // Curated entries: every file, test and doc anchor must exist. Link titles come from the guides.
  const docs: Record<string, string> = {};
  for (const path of curated.paths)
    for (const step of path.steps) {
      const where = `request path ${path.id}, step ${step.id}`;
      docs[step.doc] = checkDoc(root, step.doc, where);
      for (const source of step.sources) checkFile(root, source, where);
      for (const test of step.tests) checkTest(root, test, where);
    }
  for (const property of curated.properties) {
    docs[property.doc] = checkDoc(root, property.doc, `property "${property.property}"`);
    for (const test of property.tests) checkTest(root, test, `property "${property.property}"`);
  }
  const portKeys = new Set([...Object.keys(defaultPorts()), 'eventLog']);
  const listed = new Set(curated.ports.map((entry) => entry.port));
  if (portKeys.size !== listed.size || [...portKeys].some((key) => !listed.has(key)))
    throw new Error(`The port table lists ${[...listed]}, the kernel has ${[...portKeys]}`);
  for (const entry of curated.ports)
    for (const provider of entry.providers) {
      checkFile(root, provider.source, `port ${entry.port}`);
      // The key appears in the object the plugin returns as `ports`, within its first lines.
      const returned = [...read(root, provider.source).matchAll(/\bports:\s*\{[\s\S]{0,800}/g)];
      const key = new RegExp(`(?:^|[\\s{,])${entry.port}\\s*[:,}]`);
      if (!returned.some(([text]) => key.test(text)))
        throw new Error(`port ${entry.port}: ${provider.source} does not provide it`);
      if (!pluginIds.has(provider.plugin))
        throw new Error(`port ${entry.port}: no plugin "${provider.plugin}"`);
    }
  checkFile(root, curated.boundarySource, 'boundary rules');
  checkFile(root, curated.phaseSource, 'effect phases');
  const phases = [
    ...(
      /export type EffectPhase =([^;]+);/.exec(read(root, curated.phaseSource))?.[1] ?? ''
    ).matchAll(/'([a-z]+)'/g),
  ].map(([, phase]) => phase!);
  // The phase descriptions are the bullets of the doc comment above the type.
  const descriptions: Record<string, string> = {};
  for (const [, names, text] of read(root, curated.phaseSource).matchAll(
    /^ \* - ((?:`[a-z]+`(?:, )?)+): ([\s\S]*?)(?=\n \* -|\n \*\n|\n \*\/)/gm,
  ))
    for (const [, phase] of names!.matchAll(/`([a-z]+)`/g))
      descriptions[phase!] = text!.replace(/\n \*\s+/g, ' ').trim();
  for (const phase of phases)
    if (!descriptions[phase]) throw new Error(`${curated.phaseSource} does not describe ${phase}`);
  for (const [from, to] of curated.phaseTransitions)
    if (!phases.includes(from) || !phases.includes(to))
      throw new Error(`Effect transition ${from} to ${to} names a phase the runtime does not have`);

  // Examples: composition from the manifest, declarations from the security manifest.
  const examples = manifests
    .filter((manifest) => existsSync(join(root, 'examples', manifest.id)))
    .map((manifest) => {
      const directory = `examples/${manifest.id}`;
      const route = curated.exampleRoutes[manifest.id];
      if (!route) throw new Error(`${directory} has no entry in exampleRoutes`);
      for (const source of route.sources) checkFile(root, source, `example ${manifest.id}`);
      const catalog = deploymentCatalog(manifest);
      const security = securityManifest({
        application: manifest.id,
        catalog,
        components: deploymentComponents(manifest),
      });
      const pluginModules = new Set(
        (manifest.plugins ?? []).flatMap((plugin) => plugin.modules.map((module) => module.id)),
      );
      const targets = new Set(
        catalog.operations.flatMap((operation) => [
          ...(operation.integration ? [operation.integration.target] : []),
          ...(operation.remote ? [operation.remote.target] : []),
        ]),
      );
      return {
        id: manifest.id,
        title: manifest.title,
        directory,
        lead: readmeLead(read(root, `${directory}/README.md`)),
        input: route.input,
        record: route.record,
        sources: route.sources,
        plugins: (manifest.plugins ?? []).map((plugin) => plugin.id),
        modules: manifest.modules.map((module) => module.id).filter((id) => !pluginModules.has(id)),
        commands: catalog.operations.filter((operation) => operation.kind === 'command').length,
        queries: catalog.operations.filter((operation) => operation.kind === 'query').length,
        targets: [...targets].sort(),
        network: security.network.map((entry) => ({
          id: entry.id,
          direction: entry.direction,
          scope: entry.scope,
          availability: entry.availability,
          offline: 'offline' in entry ? entry.offline : undefined,
          owner: entry.owner,
          purpose: entry.purpose,
        })),
        devices: security.devices.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          owner: entry.owner,
          purpose: entry.purpose,
        })),
        processes: security.processes.map((entry) => ({
          id: entry.id,
          owner: entry.owner,
          purpose: entry.purpose,
        })),
        folders: security.folders.map((entry) => ({
          id: entry.id,
          owner: entry.owner,
          purpose: entry.purpose,
        })),
      };
    });

  return {
    format: 1,
    layers,
    workspaces: found.map((workspace) => {
      const markdown = existsSync(join(root, workspace.directory, 'README.md'))
        ? read(root, `${workspace.directory}/README.md`)
        : '';
      return {
        directory: workspace.directory,
        name: workspace.manifest.name,
        layer: layerOf(workspace),
        depth: depth.get(workspace.manifest.name) ?? 0,
        dependsOn: edges.get(workspace.manifest.name)!,
        lead: readmeLead(markdown),
        primitives: readmePrimitives(markdown),
        skills: skillsOf(root, workspace.directory),
      };
    }),
    plugins,
    docs,
    ports: curated.ports,
    lanes: curated.lanes,
    paths: curated.paths,
    phases: {
      source: curated.phaseSource,
      phases: phases.map((id) => ({ id, description: descriptions[id]! })),
      transitions: curated.phaseTransitions,
    },
    properties: curated.properties,
    boundary: { source: curated.boundarySource, rules: curated.boundaryRules },
    examples,
  };
}

export type Overview = Awaited<ReturnType<typeof overview>>;
