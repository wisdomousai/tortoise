/**
 * Generates the operator registry from `packages/operator-ui/registry.manifest.ts`:
 *
 * - `packages/operator-ui/registry.json`, the input of `shadcn build`;
 * - `packages/operator-ui/src/styles/operator.css`, the same theme as plain CSS for apps in this
 *   repository, which import the sources directly instead of pulling them.
 *
 * It also checks that every item can be pulled into an unrelated shadcn app: each `@/` import in an
 * item's files must be declared as a registry dependency (or be another file of the same item), and
 * each package import as a dependency.
 * An undeclared import works in this monorepo and breaks for everyone who runs `shadcn add`.
 *
 * `--check` fails when the generated files are out of date instead of writing them.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import {
  items,
  operatorTheme,
  registryName,
  type ManifestItem,
} from '../packages/operator-ui/registry.manifest';

const root = join(import.meta.dir, '..', 'packages', 'operator-ui');
const check = process.argv.includes('--check');

/** Packages every shadcn app already has; importing them needs no declaration. */
const ambient = new Set(['react', 'react-dom']);

const registryReference = (name: string) =>
  name.startsWith(`${registryName}:`)
    ? `@${registryName}/${name.slice(registryName.length + 1)}`
    : name;

function fileType(item: ManifestItem, path: string) {
  if (item.type !== 'registry:block') return item.type;
  return path.startsWith('src/hooks/')
    ? 'registry:hook'
    : path.startsWith('src/lib/')
      ? 'registry:lib'
      : 'registry:component';
}

/** Map an import specifier to the registry dependency that provides it, or the npm package. */
function requirement(specifier: string): { registry?: string; npm?: string } | undefined {
  if (specifier.startsWith('.')) return { registry: '(relative import)' };
  if (specifier === '@/lib/utils') return { registry: 'utils' };
  const ui = /^@\/components\/ui\/(.+)$/.exec(specifier);
  if (ui) return { registry: ui[1] };
  const own = /^@\/(?:components|hooks|lib)\/(.+)$/.exec(specifier);
  if (own) return { registry: `${registryName}:${own[1]}` };
  const [first = specifier, second] = specifier.split('/');
  const npm = first.startsWith('@') ? `${first}/${second}` : first;
  return ambient.has(npm) ? undefined : { npm };
}

const problems: string[] = [];
for (const item of items) {
  // A block's files ship together, so they may import each other without a declaration.
  const together = new Set(
    (item.files ?? []).map((path) => path.replace(/^src\//, '@/').replace(/\.tsx?$/, '')),
  );
  for (const path of item.files ?? []) {
    const source = readFileSync(join(root, path), 'utf8');
    for (const [, specifier = ''] of source.matchAll(
      /^\s*(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]/gm,
    )) {
      if (together.has(specifier)) continue;
      const needed = requirement(specifier);
      if (!needed) continue;
      if (needed.registry === '(relative import)')
        problems.push(`${item.name}: ${path} uses relative import ${specifier}; use an @/ alias`);
      else if (needed.registry && !item.registryDependencies?.includes(needed.registry))
        problems.push(
          `${item.name}: ${path} imports ${specifier}; add "${needed.registry}" to registryDependencies`,
        );
      else if (needed.npm && !item.dependencies?.includes(needed.npm))
        problems.push(
          `${item.name}: ${path} imports ${specifier}; add "${needed.npm}" to dependencies`,
        );
    }
  }
  for (const dependency of item.registryDependencies ?? []) {
    if (!dependency.startsWith(`${registryName}:`)) continue;
    const name = dependency.slice(registryName.length + 1);
    if (!items.some((candidate) => candidate.name === name))
      problems.push(
        `${item.name}: registry dependency ${dependency} is not an item of this registry`,
      );
  }
}

const registry = {
  $schema: 'https://ui.shadcn.com/schema/registry.json',
  name: registryName,
  homepage: 'https://registry.example.invalid/operator',
  items: items.map((item) => ({
    name: item.name,
    type: item.type,
    title: item.title,
    description: item.description,
    ...(item.dependencies?.length ? { dependencies: [...item.dependencies] } : {}),
    ...(item.registryDependencies?.length
      ? { registryDependencies: item.registryDependencies.map(registryReference) }
      : {}),
    ...(item.type === 'registry:theme'
      ? { cssVars: operatorTheme.cssVars, css: operatorTheme.css }
      : {}),
    ...(item.files?.length
      ? { files: item.files.map((path) => ({ path, type: fileType(item, path) })) }
      : {}),
  })),
};

type Block = { readonly [key: string]: string | Block };
function css(selector: string, block: Block, indent = ''): string {
  const lines = Object.entries(block).map(([key, value]) =>
    typeof value === 'string' ? `${indent}  ${key}: ${value};` : css(key, value, `${indent}  `),
  );
  return `${indent}${selector} {\n${lines.join('\n')}\n${indent}}`;
}
const prefixed = (vars: Readonly<Record<string, string>>) =>
  Object.fromEntries(Object.entries(vars).map(([key, value]) => [`--${key}`, value]));

const stylesheet = [
  '/* Generated by scripts/build-operator-registry.ts from registry.manifest.ts. Do not edit. */',
  css(':root', prefixed(operatorTheme.cssVars.light)),
  css('.dark', prefixed(operatorTheme.cssVars.dark)),
  css('@theme inline', prefixed(operatorTheme.cssVars.theme)),
  ...Object.entries(operatorTheme.css).map(([selector, block]) => css(selector, block as Block)),
  '',
].join('\n\n');

const outputs = [
  [join(root, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`],
  [join(root, 'src', 'styles', 'operator.css'), stylesheet],
] as const;

for (const [path, raw] of outputs) {
  // Generated files follow the repository's formatting so `check:format` and `--check` agree.
  const content = await format(raw, { ...(await resolveConfig(path)), filepath: path });
  let current: string | undefined;
  try {
    current = readFileSync(path, 'utf8');
  } catch {
    current = undefined;
  }
  if (current === content) continue;
  if (check) problems.push(`${path} is out of date; run bun run build:registry:operator`);
  else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

if (problems.length) {
  console.error(problems.map((problem) => `- ${problem}`).join('\n'));
  process.exit(1);
}
console.log(check ? 'Operator registry is up to date.' : 'Operator registry generated.');
