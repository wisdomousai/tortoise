/**
 * Exposes every skill of the checkout to the coding agents that read project skills: Claude Code
 * from `.claude/skills/` and Codex from `.agents/skills/`. Each entry is a relative directory
 * symlink to the skill's source in `skills/` or `<workspace>/skills/`, so editing the source is
 * enough and nothing is copied. Both directories are ignored by Git and left out of a scaffold
 * export. `bun install` runs it as the root `postinstall`; run it by hand after adding or renaming
 * a skill, which `bun run check:skills` reports.
 *
 * It replaces only symlinks, and removes only symlinks that point into this checkout and no longer
 * name a skill. A real file or directory at a skill's name is left alone and reported.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { linkDirectories, root, skills } from './skills';

// `--postinstall` (from `bun install`) reports a blocked link instead of failing the install.
const postinstall = process.argv.includes('--postinstall');
const destinations = linkDirectories;
const found = skills();
const blocked: string[] = [];
let changed = 0;

for (const destination of destinations) {
  const directory = join(root, destination);
  mkdirSync(directory, { recursive: true });
  const wanted = new Map(
    found.map((skill) => [skill.name, relative(directory, join(root, skill.directory))]),
  );

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (!lstatSync(path).isSymbolicLink() || wanted.has(entry)) continue;
    const target = resolve(directory, readlinkSync(path));
    if (target.startsWith(`${root}/`)) {
      rmSync(path);
      changed++;
    }
  }

  for (const [name, target] of wanted) {
    const path = join(directory, name);
    const existing = existsSync(path) || isLink(path) ? lstatSync(path) : undefined;
    if (existing && !existing.isSymbolicLink()) {
      blocked.push(`${destination}/${name}`);
      continue;
    }
    if (existing && readlinkSync(path) === target) continue;
    if (existing) rmSync(path);
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path, 'dir');
    changed++;
  }
}

function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

if (blocked.length) {
  console.error(`Not a symlink, left alone: ${blocked.join(', ')}`);
  if (!postinstall) process.exit(1);
}
console.log(
  `${found.length} skills linked into ${destinations.join(' and ')}${changed ? ` (${changed} links changed)` : ''}.`,
);
