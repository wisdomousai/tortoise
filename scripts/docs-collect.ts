/**
 * Mirrors the documentation pages into the site's content directory, `docs/site/src/content/docs`,
 * which Starlight reads and git ignores. A page keeps its path, so a relative link between two
 * pages resolves as it does on GitHub; a README or SKILL.md becomes its directory's index page.
 * Each page gets the frontmatter Starlight needs: the title from the H1, which the page then
 * drops, the first paragraph as the description and the GitHub URL as the edit link.
 * `docs/overview.md` becomes MDX with the overview component imported, or loses its view tags
 * when the export has no `scripts/overview.ts`.
 *
 *   bun scripts/docs-collect.ts [--watch]
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const content = join(root, 'docs/site/src/content/docs');
const repository = 'https://github.com/wisdomousai/agent-native-desktop-starter';

const layers = [
  'packages',
  'workstations',
  'plugins',
  'apps',
  'showcase/examples',
  'showcase/patterns',
  'sdks',
];
const skipped = new Set([
  'node_modules',
  'dist',
  'artifacts',
  'test-results',
  'playwright-report',
  '.workspace',
  'site',
]);
const workspacePattern =
  /^((?:packages|workstations|plugins|apps|showcase\/examples|showcase\/patterns|sdks)\/[^/]+)\/(.*)$/;

/** The site path of a source page, or undefined when the file is not a page. Paths use `/`. */
export function pageOf(source: string): string | undefined {
  if (source === 'README.md') return 'index.md';
  if (source === 'AGENTS.md') return 'AGENTS.md';
  if (source === 'docs/404.md') return '404.md';
  if (source === 'docs/site/README.md') return 'docs/site/index.md';
  if (source.startsWith('docs/') && !source.startsWith('docs/site/') && /\.mdx?$/.test(source))
    return source;
  const workspace = workspacePattern.exec(source);
  if (!workspace) return undefined;
  const directory = workspace[1]!;
  const rest = workspace[2]!;
  if (rest === 'README.md') return `${directory}/index.md`;
  if (rest.startsWith('skills/') && rest.endsWith('.md'))
    return rest.endsWith('/SKILL.md')
      ? `${directory}/${rest.slice(0, -'SKILL.md'.length)}index.md`
      : `${directory}/${rest}`;
  return undefined;
}

/** Every source page under the repository root. */
function sources(): string[] {
  const found: string[] = ['README.md', 'AGENTS.md'];
  const walk = (directory: string) => {
    for (const name of readdirSync(join(root, directory))) {
      if (skipped.has(name) || name.startsWith('.')) continue;
      const path = `${directory}/${name}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (pageOf(path)) found.push(path);
    }
  };
  walk('docs');
  if (existsSync(join(root, 'docs/site/README.md'))) found.push('docs/site/README.md');
  for (const layer of layers) {
    if (!existsSync(join(root, layer))) continue;
    for (const name of readdirSync(join(root, layer))) {
      const workspace = `${layer}/${name}`;
      if (!statSync(join(root, workspace)).isDirectory()) continue;
      if (existsSync(join(root, workspace, 'README.md'))) found.push(`${workspace}/README.md`);
      if (existsSync(join(root, workspace, 'skills'))) walk(`${workspace}/skills`);
    }
  }
  return found.filter((path) => existsSync(join(root, path)));
}

/** Plain text of a markdown line: no links, images, code marks or emphasis. */
const plain = (text: string) =>
  text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();

const yaml = (value: string) => JSON.stringify(value);

/** The page text with Starlight's frontmatter, and whether it needs MDX. */
export function page(source: string, text: string): { body: string; mdx: boolean } {
  let body = text;
  let name: string | undefined;
  let description: string | undefined;
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(body);
  if (frontmatter) {
    name = /^name:\s*(.+)$/m.exec(frontmatter[1]!)?.[1]?.trim();
    description = /^description:\s*(.+)$/m.exec(frontmatter[1]!)?.[1]?.trim();
    body = body.slice(frontmatter[0].length);
  }
  const heading = /^# (.+)$/m.exec(body);
  const title = heading ? plain(heading[1]!) : (name ?? source);
  if (heading) body = body.replace(heading[0], '');
  if (!description) {
    const paragraph = body
      .split(/\r?\n\r?\n/)
      .map((block) => block.trim())
      .find((block) => block && !/^[#<>|\-*`!:[]/.test(block));
    if (paragraph) description = plain(paragraph.replace(/\s+/g, ' '));
  }
  let mdx = source.endsWith('.mdx');
  if (/<OverviewView[^>]*\/>/.test(body)) {
    if (existsSync(join(root, 'scripts/overview.ts'))) {
      mdx = true;
      body = `import OverviewView from '@site/components/OverviewView.astro';\n\n${body}`;
    } else body = body.replace(/<OverviewView[^>]*\/>\n*/g, '');
  }
  const lines = [`title: ${yaml(title)}`];
  if (description) lines.push(`description: ${yaml(description)}`);
  lines.push(`editUrl: ${yaml(`${repository}/edit/main/${source}`)}`, `repoPath: ${yaml(source)}`);
  return { body: `---\n${lines.join('\n')}\n---\n\n${body.replace(/^\n+/, '')}`, mdx };
}

function write(source: string) {
  const target = pageOf(source);
  if (!target) return;
  const { body, mdx } = page(source, readFileSync(join(root, source), 'utf8'));
  const file = join(content, mdx ? target.replace(/\.md$/, '.mdx') : target);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

function remove(source: string) {
  const target = pageOf(source);
  if (!target) return;
  for (const file of [join(content, target), join(content, target.replace(/\.md$/, '.mdx'))])
    if (existsSync(file)) rmSync(file);
}

/** The pages' images, copied beside them so a relative image path resolves. */
function assets() {
  if (existsSync(join(root, 'docs/assets')))
    cpSync(join(root, 'docs/assets'), join(content, 'docs/assets'), { recursive: true });
}

export function collect(): number {
  rmSync(content, { recursive: true, force: true });
  const pages = sources();
  for (const source of pages) write(source);
  assets();
  return pages.length;
}

if (import.meta.main) {
  console.log(`${collect()} pages in docs/site/src/content/docs`);
  if (process.argv.includes('--watch')) {
    const watched = ['docs', 'README.md', 'AGENTS.md', ...layers].filter((path) =>
      existsSync(join(root, path)),
    );
    for (const path of watched)
      watch(join(root, path), { recursive: true }, (_event, name) => {
        const source = name ? join(path, String(name)).split(sep).join('/') : path;
        if (source.startsWith('docs/assets/')) return assets();
        if (!pageOf(source)) return;
        if (existsSync(join(root, source))) write(source);
        else remove(source);
        console.log(`${source} updated`);
      });
    console.log('watching for page changes');
  }
}
