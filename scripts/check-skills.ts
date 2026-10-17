/**
 * Keeps the coding-agent skills discoverable and current. For every skill in `skills/*` and
 * `<workspace>/skills/*` it fails when:
 *
 * - the frontmatter `name` differs from the directory, is not kebab-case or is taken by another
 *   skill (the links share one flat directory), or the `description` is missing or too long;
 * - a relative link in any of the skill's Markdown files is broken;
 * - a `bun run <script>` names no script of the root or a workspace `package.json`;
 * - a path in code that starts with a layer, `docs/`, `scripts/` or `skills/` does not exist, so a
 *   skill cannot keep naming a file after it moved. Paths with `<placeholder>` or globs are skipped;
 * - AGENTS.md does not list the skill, or the owning workspace's README does not link it.
 *
 * What a skill says is left to its author. Reads files only; writes nothing.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brokenLinks } from './markdown-links';
import { layers, root, skills } from './skills';

const errors: string[] = [];
const found = skills();
const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');

const scripts = new Set<string>();
const packageScripts = (path: string) =>
  Object.keys((JSON.parse(readFileSync(path, 'utf8')) as { scripts?: object }).scripts ?? {});
for (const script of packageScripts(join(root, 'package.json'))) scripts.add(script);
for (const layer of layers)
  for (const name of readdirSync(join(root, layer)))
    if (existsSync(join(root, layer, name, 'package.json')))
      for (const script of packageScripts(join(root, layer, name, 'package.json')))
        scripts.add(script);

const pathPrefix = new RegExp(`^(?:${[...layers, 'docs', 'scripts', 'skills'].join('|')})/`);
/** Words inside inline code and fenced blocks that look like repo paths. */
function codePaths(text: string): string[] {
  const code = [
    ...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g),
    ...text.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g),
  ].map((match) => match[1]!);
  return code
    .flatMap((snippet) => snippet.split(/\s+/))
    .map((word) => word.replace(/^[('"]+|[)'",.;:]+$/g, '').split('#')[0]!)
    .filter((word) => pathPrefix.test(word) && !/[<>*{}$]/.test(word));
}

function markdownFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.md'))
    .map((path) => `${directory}/${path}`);
}

const names = new Map<string, string>();
for (const skill of found) {
  const report = (problem: string) => errors.push(`${skill.directory}: ${problem}`);
  const { name, description } = skill.frontmatter;

  if (name !== skill.name) report(`frontmatter name must be "${skill.name}"`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name)) report('name must be kebab-case');
  const other = names.get(skill.name);
  if (other) report(`name already used by ${other}`);
  names.set(skill.name, skill.directory);
  if (!description) report('frontmatter description is missing');
  else if (description.length > 1024) report('description is longer than 1024 characters');

  for (const file of markdownFiles(skill.directory)) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const problem of brokenLinks(join(root, file), text)) errors.push(`${file}: ${problem}`);
    for (const [, script] of text.matchAll(/\bbun run ([a-z][\w:.-]*)/g))
      if (!scripts.has(script!)) errors.push(`${file}: no package script "${script}"`);
    for (const path of new Set(codePaths(text)))
      if (!existsSync(join(root, path))) errors.push(`${file}: names missing path ${path}`);
  }

  if (!agents.includes(`${skill.directory}/SKILL.md`)) report('not listed in AGENTS.md');
  if (skill.workspace) {
    const readme = join(root, skill.workspace, 'README.md');
    if (
      !existsSync(readme) ||
      !readFileSync(readme, 'utf8').includes(`skills/${skill.name}/SKILL.md`)
    )
      report(`not linked from ${skill.workspace}/README.md`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${found.length} skills with valid frontmatter, links and paths, all listed.`);
