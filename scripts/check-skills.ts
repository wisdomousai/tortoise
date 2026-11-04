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
 * - AGENTS.md does not list the skill, or the owning workspace does not list it in the coverage
 *   registry.
 *
 * It keeps skills current with the code they describe. `scripts/skill-coverage.json` names the
 * skills covering each tracked workspace, or why none do. The check fails when a
 * workspace's public API (entrypoints and exported names, see `skill-api.ts`) or the root
 * package scripts differ from `scripts/reviewed-api.json`, and names the skills to review;
 * `bun run skills:stamp` records the public API once they are reviewed. When the agents' link
 * directories exist, a missing or stale link fails too.
 *
 * What a skill says is left to its author. Reads files only; writes nothing.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { brokenLinks } from './markdown-links';
import { currentApi } from './skill-api';
import {
  layers,
  linkDirectories,
  installedSkills,
  reviewedApiFile,
  root,
  rootScripts,
  rootScriptSkills,
  skillCoverageFile,
  skills,
  apiWorkspaces,
} from './skills';

const errors: string[] = [];
const found = skills();
const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');

const scripts = new Set<string>();
const packageScripts = (path: string) =>
  Object.keys((JSON.parse(readFileSync(path, 'utf8')) as { scripts?: object }).scripts ?? {});
for (const script of packageScripts(join(root, 'package.json'))) scripts.add(script);
for (const layer of layers)
  for (const name of existsSync(join(root, layer)) ? readdirSync(join(root, layer)) : [])
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
}

// Coverage is structured data, not a requirement on a README's presence or headings.
// An application may cover its own workspace with a skill from an installed framework package.
const byName = new Map([...found, ...installedSkills()].map((skill) => [skill.name, skill]));
const reviewers = new Map<string, readonly string[]>([[rootScripts, rootScriptSkills]]);
const workspaces = apiWorkspaces();
let coverage: Record<string, unknown> = {};
if (workspaces.length) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, skillCoverageFile), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('expected an object keyed by workspace');
    coverage = parsed as Record<string, unknown>;
  } catch (error) {
    errors.push(`${skillCoverageFile}: cannot read coverage (${String(error)})`);
  }
}
for (const key of Object.keys(coverage))
  if (!workspaces.includes(key)) errors.push(`${skillCoverageFile}: unknown workspace ${key}`);
for (const workspace of workspaces) {
  const entry = coverage[workspace];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`${skillCoverageFile}: missing coverage for ${workspace}`);
    continue;
  }
  const { skills: names, reason } = entry as { skills?: unknown; reason?: unknown };
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string' && name)) {
    errors.push(`${skillCoverageFile}: ${workspace} needs a skills array of names`);
    continue;
  }
  if (!names.length && (typeof reason !== 'string' || !reason.trim()))
    errors.push(`${skillCoverageFile}: ${workspace} needs a reason when no skills cover it`);
  if (names.length && reason !== undefined)
    errors.push(`${skillCoverageFile}: ${workspace} has both skills and a no-coverage reason`);
  if (new Set(names).size !== names.length)
    errors.push(`${skillCoverageFile}: ${workspace} repeats a skill`);
  for (const name of names)
    if (!byName.has(name))
      errors.push(`${skillCoverageFile}: ${workspace} names unknown skill ${name}`);
  reviewers.set(workspace, names);
}
for (const skill of found) {
  if (skill.workspace && workspaces.includes(skill.workspace)) {
    const names = reviewers.get(skill.workspace);
    if (names && !names.includes(skill.name))
      errors.push(
        `${skillCoverageFile}: ${skill.workspace} does not list its own skill ${skill.name}`,
      );
  }
}

// Drift: the public API the skills were last reviewed against. An application that installs the
// framework from a registry has no framework workspaces and no record of them.
let recorded: Record<string, string[]> = {};
const tracked = workspaces.length > 0;
try {
  recorded = JSON.parse(readFileSync(join(root, reviewedApiFile), 'utf8'));
} catch {
  if (tracked)
    errors.push(`${reviewedApiFile} is missing; review the skills, then run bun run skills:stamp`);
}
const current = tracked ? currentApi(root) : {};
const listed = (items: string[]) =>
  items.length > 8
    ? `${items.slice(0, 8).join(', ')} and ${items.length - 8} more`
    : items.join(', ');
for (const key of new Set([...Object.keys(current), ...Object.keys(recorded)])) {
  const now = current[key];
  const then = recorded[key];
  const stamp = `bun run skills:stamp ${key === rootScripts ? 'package.json' : key}`;
  if (!now) {
    errors.push(`${reviewedApiFile}: ${key} no longer exists; run ${stamp}`);
    continue;
  }
  const added = now.filter((item) => !then?.includes(item)).map((item) => `+${item}`);
  const removed = (then ?? []).filter((item) => !now.includes(item)).map((item) => `-${item}`);
  if (then && !added.length && !removed.length) continue;
  const names = reviewers.get(key);
  const review = !names
    ? `add coverage for ${key} to ${skillCoverageFile}`
    : names.length
      ? `review ${names.map((name) => `${byName.get(name)?.directory ?? name}/SKILL.md`).join(', ')}`
      : `decide whether ${key} now needs a skill (the registry says none)`;
  errors.push(
    `${key}: ${then ? `public API changed (${listed([...added, ...removed])})` : 'public API not reviewed yet'}; ${review}, then run ${stamp}`,
  );
}

// Discovery: when the agents' link directories exist, every skill is linked to its source.
for (const destination of linkDirectories) {
  if (!existsSync(join(root, destination))) continue;
  for (const skill of found) {
    let target: string | undefined;
    try {
      target = realpathSync(join(root, destination, skill.name));
    } catch {}
    if (target !== realpathSync(join(root, skill.directory)))
      errors.push(`${destination}/${skill.name}: missing or stale; run bun run skills:link`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(
  `${found.length} skills with valid frontmatter, links and paths, all listed, linked and reviewed against the current public API.`,
);
