import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { canonicalJson } from '@agent-native/contracts';
import { addDependency, addWorkspace, type GeneratedContent } from './content';
import { excludedExamples, pruneLockfile, type ExcludedExample } from './examples';
import { binaryFile, collect } from './file-rules';
import {
  frameworkFile,
  publishedContent,
  publishedFiles,
  publishedFramework,
  pruneScripts,
  type PublishedFramework,
} from './published';

export interface ScaffoldOptions {
  readonly target: string;
  readonly name: string;
  readonly displayName?: string;
  readonly sourceRoot?: string;
  /**
   * Export only this example (`examples/<example>`) as the application's content, configured as
   * the application the starter hosts. Without it, every example is exported and the source's
   * configured application is kept.
   */
  readonly example?: string;
  /**
   * Generated content to host instead of any example: every example is left out, this workspace
   * is added to the root manifest and lockfile, and the starter is configured to host it.
   */
  readonly content?: GeneratedContent;
  /**
   * Install the framework from a registry at the checkout's framework version instead of
   * copying `packages/*` and `plugins/*`; `registry` serves the `@agent-native` scope. Only for
   * generated content: the examples' own tests read plugin and SDK source by path.
   */
  readonly published?: { readonly registry?: string };
}
export interface ScaffoldManifest {
  readonly formatVersion: 1;
  readonly frameworkVersion: string;
  readonly application: {
    readonly name: string;
    readonly displayName: string;
    readonly appId: string;
    /** The content the starter hosts (`app.config.json` `application`). */
    readonly application?: string;
  };
  /** The single example exported as content, when one was selected. */
  readonly example?: string;
  /** The generated content workspace, for a new application. */
  readonly content?: string;
  /** Present when the export installs the framework instead of carrying its source. */
  readonly framework?: { readonly version: string; readonly registry?: string };
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

/** Resolve existing ancestors without creating directories or following the absent target. */
async function targetPath(path: string): Promise<string> {
  const suffix = [basename(path)];
  let parent = dirname(path);
  for (;;) {
    try {
      return join(await realpath(parent), ...suffix);
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      suffix.unshift(basename(parent));
      const next = dirname(parent);
      if (next === parent) throw error;
      parent = next;
    }
  }
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );

/** Source checkout and target, refusing a target inside the source or one that already exists. */
async function resolveLocations(options: ScaffoldOptions) {
  const requestedSourceRoot = resolve(options.sourceRoot ?? join(import.meta.dir, '../../..'));
  const sourceRoot = await realpath(requestedSourceRoot);
  const target = await targetPath(resolve(options.target));
  const withinSource = relative(sourceRoot, target);
  if (
    !withinSource ||
    (!withinSource.startsWith(`..${sep}`) && withinSource !== '..' && !isAbsolute(withinSource))
  )
    throw new Error('Scaffold target must be outside the source checkout');
  if (await exists(target)) throw new Error(`Refusing to overwrite existing target: ${target}`);
  return { requestedSourceRoot, sourceRoot, target };
}

export function displayNameOf(options: Pick<ScaffoldOptions, 'name' | 'displayName'>): string {
  const displayName =
    options.displayName ??
    options.name
      .split('-')
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join(' ');
  if (!displayName.trim() || displayName.length > 120 || /[\r\n\x00-\x1f]/.test(displayName))
    throw new Error('Display name must be nonempty single-line text of at most 120 characters');
  return displayName;
}

/** The exported application's identity and the examples a single-example export leaves out. */
async function applicationOf(options: ScaffoldOptions, sourceRoot: string, displayName: string) {
  const sourceConfig = JSON.parse(
    await readFile(join(sourceRoot, 'app.config.json'), 'utf8').catch(() => '{}'),
  ) as { application?: string };
  const excluded =
    options.example || options.content
      ? await excludedExamples(sourceRoot, options.content ? undefined : options.example)
      : [];
  const hosted = options.content
    ? options.content.packageName
    : options.example
      ? (JSON.parse(
          await readFile(join(sourceRoot, 'examples', options.example, 'package.json'), 'utf8'),
        ).name as string)
      : sourceConfig.application;
  const application: ScaffoldManifest['application'] = {
    name: options.name,
    displayName,
    appId: `dev.agentnative.${options.name}`,
    ...(hosted ? { application: hosted } : {}),
  };
  return { application, excluded };
}

interface ExportContext {
  readonly sourceName: string;
  readonly name: string;
  readonly displayName: string;
  readonly application: ScaffoldManifest['application'];
  readonly excluded: readonly ExcludedExample[];
  readonly content?: GeneratedContent;
  readonly framework?: PublishedFramework;
}

/** Rename the package and rewrite the files the exported application owns. */
function exportedContent(path: string, source: string, context: ExportContext): string {
  const { excluded } = context;
  let content = source.replaceAll(context.sourceName, context.name);
  // Native application names and browser titles are explicitly owned by the exported app.
  if (path === 'apps/web/index.html')
    content = content.replace(
      /<title>[^<]*<\/title>/,
      `<title>${context.displayName.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</title>`,
    );
  if (path === 'app.config.json') content = JSON.stringify(context.application, null, 2) + '\n';
  if (path === 'package.json' && excluded.length) {
    const root = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    for (const { packageName } of excluded) delete root.dependencies?.[packageName];
    // A script that runs a left-out example's files, such as one example's sandbox test.
    if (root.scripts)
      root.scripts = pruneScripts(root.scripts, (_name, command) =>
        excluded.some(({ directory }) => command.includes(`${directory}/`)),
      );
    content = JSON.stringify(root, null, 2) + '\n';
  }
  if (path === 'bun.lock' && excluded.length) content = pruneLockfile(content, excluded);
  if (context.content && path === 'package.json')
    content = addDependency(content, context.content.packageName);
  if (context.content && path === 'bun.lock') content = addWorkspace(content, context.content);
  if (context.framework) content = publishedContent(path, content, context.framework);
  return content;
}

/** Whether a path belongs to an example the export leaves out. */
const leftOut = (path: string, excluded: readonly ExcludedExample[]) =>
  excluded.some(({ directory }) => path.startsWith(`${directory}/`));

async function exportedFiles(
  locations: { requestedSourceRoot: string; sourceRoot: string },
  context: ExportContext,
) {
  const { sourceRoot, requestedSourceRoot } = locations;
  const paths = (await collect(sourceRoot)).filter(
    (path) => !leftOut(path, context.excluded) && !(context.framework && frameworkFile(path)),
  );
  const files: { path: string; content: string | Uint8Array; sha256: string }[] = [];
  for (const path of paths) {
    if (binaryFile(path)) {
      const content = new Uint8Array(await readFile(join(sourceRoot, path)));
      files.push({ path, content, sha256: createHash('sha256').update(content).digest('hex') });
      continue;
    }
    const source = await readFile(join(sourceRoot, path), 'utf8');
    if (source.includes(sourceRoot) || source.includes(requestedSourceRoot))
      throw new Error(`Source file contains checkout-specific absolute path: ${path}`);
    if (path.endsWith('.pem') && /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/.test(source))
      throw new Error(`Source file contains a private key: ${path}`);
    const content = exportedContent(path, source, context);
    files.push({ path, content, sha256: createHash('sha256').update(content).digest('hex') });
  }
  // Generated content is written as given; it holds no source paths or checkout data.
  const generated = {
    ...Object.fromEntries(
      Object.entries(context.content?.files ?? {}).map(([file, content]) => [
        `${context.content!.directory}/${file}`,
        content,
      ]),
    ),
    ...(context.framework ? publishedFiles(context.framework) : {}),
  };
  for (const [path, content] of Object.entries(generated))
    files.push({ path, content, sha256: createHash('sha256').update(content).digest('hex') });
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * Prepare all bytes before reserving the target. An exclusive mkdir refuses existing targets,
 * including empty directories and symlinks; rename publishes only our reserved empty directory.
 */
async function publish(
  target: string,
  files: readonly { path: string; content: string | Uint8Array }[],
  manifest: ScaffoldManifest,
) {
  await mkdir(dirname(target), { recursive: true });
  const staging = await mkdtemp(join(dirname(target), '.scaffold-'));
  let reserved = false;
  try {
    for (const file of files) {
      await mkdir(dirname(join(staging, file.path)), { recursive: true });
      await writeFile(join(staging, file.path), file.content, { flag: 'wx' });
    }
    await writeFile(
      join(staging, 'scaffold.manifest.json'),
      JSON.stringify(JSON.parse(canonicalJson(manifest)), null, 2) + '\n',
      { flag: 'wx' },
    );
    await mkdir(target);
    reserved = true;
    await rename(staging, target);
  } catch (error) {
    if (reserved) await rmdir(target).catch(() => undefined); // Never remove concurrent user files.
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Export the complete canonical starter as local source; it does not invent a new business domain. */
export async function scaffold(options: ScaffoldOptions): Promise<ScaffoldManifest> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(options.name) || options.name.length > 100)
    throw new Error('Application name must be a lowercase npm-style name');
  const locations = await resolveLocations(options);
  const sourcePackage = JSON.parse(
    await readFile(join(locations.sourceRoot, 'package.json'), 'utf8'),
  ) as { name: string; version: string };
  const displayName = displayNameOf(options);
  if (options.published && !options.content)
    throw new Error('Only a new application installs the framework; an example export copies it');
  const framework = options.published
    ? await publishedFramework(locations.sourceRoot, options.published.registry)
    : undefined;
  const { application, excluded } = await applicationOf(options, locations.sourceRoot, displayName);
  const files = await exportedFiles(locations, {
    sourceName: sourcePackage.name,
    name: options.name,
    displayName,
    application,
    excluded,
    ...(options.content ? { content: options.content } : {}),
    ...(framework ? { framework } : {}),
  });
  const manifest: ScaffoldManifest = {
    formatVersion: 1,
    frameworkVersion: sourcePackage.version,
    application,
    ...(options.example ? { example: options.example } : {}),
    ...(options.content ? { content: options.content.directory } : {}),
    ...(framework
      ? {
          framework: {
            version: framework.version,
            ...(framework.registry ? { registry: framework.registry } : {}),
          },
        }
      : {}),
    files: files.map(({ path, sha256 }) => ({ path, sha256 })),
  };
  await publish(locations.target, files, manifest);
  return manifest;
}
