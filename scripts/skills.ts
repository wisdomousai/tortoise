/**
 * Where the coding-agent skills of a checkout live. A workspace keeps the skills for its own
 * extension points in `<workspace>/skills/<name>/`, so a skill moves with the code it describes and
 * ships in that package; an application may add its own in `skills/<name>/`. In an application that
 * installs the framework from a registry, the framework's skills come from
 * `node_modules/@tortoise/<package>/skills/`. `check-skills` validates the skills in the checkout and
 * `skills-link` exposes all of them to Claude Code and Codex. Reads files only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const root = resolve(import.meta.dir, '..');
export const layers = [
  'packages',
  'workstations',
  'plugins',
  'apps',
  'showcase/examples',
  'showcase/patterns',
  'sdks',
] as const;

export interface Skill {
  /** The directory name, which is also the skill name. */
  readonly name: string;
  /** Repo-relative directory of the skill. */
  readonly directory: string;
  /** Repo-relative workspace that owns it, or undefined for one in the root `skills/`. */
  readonly workspace?: string;
  readonly frontmatter: Record<string, string>;
  readonly text: string;
}

// Follows symlinks: an installed package is often a link into the package manager's store.
const subdirectories = (path: string) =>
  existsSync(path)
    ? readdirSync(path)
        .filter((name) => statSync(join(path, name), { throwIfNoEntry: false })?.isDirectory())
        .sort()
    : [];

/** The `key: value` lines between the opening `---` fences; values are single-line. */
export function frontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const fields: Record<string, string> = {};
  for (const line of match?.[1]?.split('\n') ?? []) {
    const field = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1]!] = field[2]!.replace(/^'(.*)'$|^"(.*)"$/, '$1$2');
  }
  return fields;
}

function skillsIn(directory: string, workspace?: string): Skill[] {
  return subdirectories(join(root, directory))
    .filter((name) => existsSync(join(root, directory, name, 'SKILL.md')))
    .map((name) => {
      const text = readFileSync(join(root, directory, name, 'SKILL.md'), 'utf8');
      return {
        name,
        directory: `${directory}/${name}`,
        workspace,
        frontmatter: frontmatter(text),
        text,
      };
    });
}

/** Every skill authored in the checkout: root `skills/` first, then by workspace. */
export function skills(): Skill[] {
  const found = skillsIn('skills');
  for (const layer of layers)
    for (const name of subdirectories(join(root, layer)))
      found.push(...skillsIn(`${layer}/${name}/skills`, `${layer}/${name}`));
  return found;
}

/** Workspaces whose public API the skills are reviewed against. */
export const apiLayers = ['packages', 'workstations', 'plugins', 'sdks'] as const;
/** The key under which the root package scripts are recorded, and the skills that cover them. */
export const rootScripts = 'package.json scripts';
export const rootScriptSkills = ['check-a-change', 'create-agent-native-app'];
/** Coverage of each framework workspace, independent of its README. */
export const skillCoverageFile = 'scripts/skill-coverage.json';
export const reviewedApiFile = 'scripts/reviewed-api.json';
/** Where Claude Code and Codex read project skills; `skills-link` fills both. */
export const linkDirectories = ['.claude/skills', '.agents/skills'];

export function apiWorkspaces(): string[] {
  return apiLayers.flatMap((layer) =>
    subdirectories(join(root, layer))
      .filter((name) => existsSync(join(root, layer, name, 'package.json')))
      .map((name) => `${layer}/${name}`),
  );
}

/**
 * Skills of framework packages installed from a registry rather than present as workspaces, as
 * `node_modules/@tortoise/<package>/skills/<name>`. They were checked where they were authored.
 */
export function installedSkills(): Skill[] {
  const local = new Set(skills().map((skill) => skill.name));
  const scope = 'node_modules/@tortoise';
  return subdirectories(join(root, scope))
    .flatMap((name) => skillsIn(`${scope}/${name}/skills`, `${scope}/${name}`))
    .filter((skill) => !local.has(skill.name));
}
