/**
 * The site's sidebar, built from the filesystem so a new workspace or skill appears without a
 * config change. The guide order is the one list here; everything else is collected. Reads only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DefaultTheme } from 'vitepress';

export const repoRoot = resolve(import.meta.dirname, '../..');

/** The guide pages in reading order: `docs/<file>.md` and the sidebar text. */
export const guides: ReadonlyArray<readonly [file: string, text: string]> = [
  ['overview', 'Overview'],
  ['getting-started', 'Getting started'],
  ['architecture', 'Architecture'],
  ['primitives', 'Primitives'],
  ['glossary', 'Glossary'],
  ['capability-authoring', 'Capability authoring'],
  ['interaction-contract', 'Interaction contract'],
  ['authorization', 'Authorization'],
  ['state-and-reactivity', 'State and reactivity'],
  ['adapters', 'Adapters'],
  ['systems-of-record', 'Systems of record'],
  ['operator-workstations', 'Operator workstations'],
  ['point-of-work-input', 'Point-of-work input'],
  ['hardware-drivers', 'Hardware drivers'],
  ['agents', 'Agents'],
  ['hosting', 'Hosting'],
  ['providers', 'Providers'],
  ['security-and-compliance', 'Security and compliance'],
  ['desktop', 'Desktop'],
  ['mobile', 'Mobile'],
  ['development-and-testing', 'Development and testing'],
  ['implementation-status', 'Implementation status'],
  ['styleguide', 'Documentation styleguide'],
];

const layers: ReadonlyArray<readonly [directory: string, text: string]> = [
  ['packages', 'Packages'],
  ['plugins', 'Plugins'],
  ['apps', 'Apps'],
  ['examples', 'Examples'],
  ['sdks', 'SDKs'],
];

const workspaces = (layer: string): string[] =>
  existsSync(join(repoRoot, layer))
    ? readdirSync(join(repoRoot, layer))
        .filter(
          (name) =>
            statSync(join(repoRoot, layer, name)).isDirectory() &&
            existsSync(join(repoRoot, layer, name, 'README.md')),
        )
        .sort()
    : [];

const skillsOf = (workspace: string): string[] => {
  const directory = join(repoRoot, workspace, 'skills');
  return existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => existsSync(join(directory, name, 'SKILL.md')))
        .sort()
    : [];
};

/** The `name:` of a skill's frontmatter, or the directory name. */
const skillName = (workspace: string, skill: string): string => {
  const text = readFileSync(join(repoRoot, workspace, 'skills', skill, 'SKILL.md'), 'utf8');
  return /^name:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? skill;
};

export function sidebar(): DefaultTheme.Sidebar {
  const items: DefaultTheme.SidebarItem[] = [
    {
      text: 'Guides',
      items: guides
        .filter(([file]) => existsSync(join(repoRoot, 'docs', `${file}.md`)))
        .map(([file, text]) => ({ text, link: `/docs/${file}` })),
    },
  ];
  const skills: DefaultTheme.SidebarItem[] = [];
  for (const [layer, text] of layers) {
    const names = workspaces(layer);
    if (!names.length) continue;
    items.push({
      text,
      collapsed: true,
      items: names.map((name) => ({ text: name, link: `/${layer}/${name}/` })),
    });
    for (const name of names)
      for (const skill of skillsOf(`${layer}/${name}`))
        skills.push({
          text: skillName(`${layer}/${name}`, skill),
          link: `/${layer}/${name}/skills/${skill}/`,
        });
  }
  if (skills.length)
    items.push({
      text: 'Skills',
      collapsed: true,
      items: skills.sort((a, b) => a.text!.localeCompare(b.text!)),
    });
  return items;
}
