import { lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { applyGenerated } from './apply';
import { prettierJson } from './json';
import { appNames } from './new';
import type { AppNames } from './templates/application';
import { capability, type CapabilitySpec } from './templates/capability';
import { collection, type Generated } from './templates/collection';
import { names } from './templates/names';
import { target } from './templates/target';

/** What `scaffold add` generates into an application created by `scaffold new`. */
export type AddRequest =
  | { readonly kind: 'collection'; readonly name: string }
  | ({ readonly kind: 'capability' } & CapabilitySpec)
  | { readonly kind: 'target'; readonly name: string; readonly collection: string };

export interface AddOptions {
  /** The checkout root; the current directory when omitted. */
  readonly root?: string;
  /** The application's directory relative to the root; the hosted application when omitted. */
  readonly application?: string;
}

const exists = (path: string) =>
  lstat(path).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );

/** The directory of the application `app.config.json` hosts, found by its package name. */
async function hostedDirectory(root: string): Promise<string> {
  const config = JSON.parse(await readFile(join(root, 'app.config.json'), 'utf8')) as {
    application?: string;
  };
  for (const entry of await readdir(join(root, 'examples'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = join(root, 'examples', entry.name, 'package.json');
    if (!(await exists(manifest))) continue;
    if (JSON.parse(await readFile(manifest, 'utf8')).name === config.application)
      return join(root, 'examples', entry.name);
  }
  throw new Error(`No examples/* workspace is the hosted application ${config.application}`);
}

/** The names an application was generated with, read back from its manifest. */
async function readAppNames(directory: string): Promise<AppNames> {
  const manifest = await readFile(join(directory, 'manifest.ts'), 'utf8');
  const id = /\bid: '([a-z0-9-]+)'/.exec(manifest)?.[1];
  // Formatting may have turned the generated double-quoted title into a single-quoted one.
  const quoted = /\btitle: ('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/.exec(manifest)?.[1];
  if (!id || !quoted || !(await exists(join(directory, 'policy.ts'))))
    throw new Error(`${directory} was not created by scaffold new; extend it by hand`);
  const title = quoted.startsWith('"')
    ? (JSON.parse(quoted) as string)
    : quoted.slice(1, -1).replace(/\\(.)/g, '$1');
  const app = appNames(id, title);
  const packageName = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')).name;
  return { ...app, packageName };
}

async function partFor(request: AddRequest, app: AppNames, directory: string): Promise<Generated> {
  if (request.kind === 'collection') return collection(app, names(request.name, 'Collection type'));
  if (request.kind === 'capability') return capability(app, request);
  const one = names(request.collection, 'Collection type');
  if (!(await exists(join(directory, 'contracts', `${one.kebab}.ts`))))
    throw new Error(`No collection ${one.kebab}; add it first with scaffold add collection`);
  return target(app, names(request.name, 'Target name'), one);
}

/**
 * The desktop site policy with a new target's destination listed as disabled, or undefined when
 * there is no policy or it already names the destination. A target's destination is required,
 * so a policy that names neither a binding nor a deliberate switch-off fails `site check`;
 * disabled, effects stay queued until someone binds it to the system of record's URL.
 */
async function policyWithTarget(root: string, name: string): Promise<string | undefined> {
  const path = join(root, 'apps/desktop/site-policy.json');
  if (!(await exists(path))) return;
  const policy = JSON.parse(await readFile(path, 'utf8')) as {
    destinations?: Record<string, unknown>;
  };
  const id = `${names(name, 'Target name').kebab}-api`;
  if (policy.destinations?.[id]) return;
  policy.destinations = {
    ...policy.destinations,
    [id]: { disabled: true, reason: `Bind to the ${name} system of record's URL to deliver.` },
  };
  return `${prettierJson(policy)}\n`;
}

/**
 * Generate one part into an application created by `scaffold new`: its contract, handler,
 * policy rules, screens where it has any, and a behavioral test, inserted at the application's
 * `// scaffold:<list>` markers. Nothing is written unless every file can be produced, and no
 * existing file is overwritten except at a marker. Run `bun run generate` afterwards.
 */
export async function scaffoldAdd(request: AddRequest, options: AddOptions = {}) {
  const root = resolve(options.root ?? process.cwd());
  const directory = options.application
    ? resolve(root, options.application)
    : await hostedDirectory(root);
  const app = await readAppNames(directory);
  const part = await partFor(request, app, directory);
  const current: Record<string, string> = {};
  for (const path of Object.keys(part.insertions))
    current[path] = await readFile(join(directory, path), 'utf8');
  for (const path of Object.keys(part.files))
    if (await exists(join(directory, path))) throw new Error(`Refusing to overwrite ${path}`);
  const next = applyGenerated(current, part);
  const policy = request.kind === 'target' ? await policyWithTarget(root, request.name) : undefined;
  for (const [path, content] of Object.entries(next)) {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(join(directory, path), content, {
      flag: Object.hasOwn(part.files, path) ? 'wx' : 'w',
    });
  }
  if (policy) await writeFile(join(root, 'apps/desktop/site-policy.json'), policy);
  return {
    directory: relative(root, directory),
    written: Object.keys(next).sort(),
    ...(policy ? { policy: 'apps/desktop/site-policy.json' } : {}),
  };
}
