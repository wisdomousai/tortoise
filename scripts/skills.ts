/**
 * Where the coding-agent skills of a checkout live. Repo-wide skills sit in `skills/<name>/`, and a
 * workspace keeps the skills for its own extension points in `<workspace>/skills/<name>/`, so a
 * skill moves with the code it describes. `check-skills` validates them and `skills-link` exposes
 * them to Claude Code and Codex. Reads files only.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const root = resolve(import.meta.dir, '..');
export const layers = ['packages', 'plugins', 'apps', 'examples', 'sdks'] as const;

export interface Skill {
  /** The directory name, which is also the skill name. */
  readonly name: string;
  /** Repo-relative directory of the skill. */
  readonly directory: string;
  /** Repo-relative workspace that owns it, or undefined for a repo-wide skill. */
  readonly workspace?: string;
  readonly frontmatter: Record<string, string>;
  readonly text: string;
}

const subdirectories = (path: string) =>
  existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
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

/** Every skill in the checkout: repo-wide first, then by workspace. */
export function skills(): Skill[] {
  const found = skillsIn('skills');
  for (const layer of layers)
    for (const name of subdirectories(join(root, layer)))
      found.push(...skillsIn(`${layer}/${name}/skills`, `${layer}/${name}`));
  return found;
}
