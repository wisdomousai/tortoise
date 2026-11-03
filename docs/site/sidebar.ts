/**
 * The site's sidebar, built from the filesystem so a new workspace or skill appears without a
 * config change. The guide order is the one list here; everything else is collected. Reads only.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { StarlightUserConfig } from '@astrojs/starlight/types';

export const repoRoot = resolve(import.meta.dirname, '../..');

type Guide = readonly [file: string, text: string];

/** The guide pages by group, in reading order: `docs/<file>.md` and the sidebar text. */
export const guides: ReadonlyArray<readonly [group: string, pages: ReadonlyArray<Guide>]> = [
  [
    'Start',
    [
      ['overview', 'Overview'],
      ['getting-started', 'Getting started'],
      ['patterns', 'Patterns'],
    ],
  ],
  [
    'Tutorials',
    [
      ['tutorials/index', 'Tutorials'],
      ['tutorials/tool-store-1-records-and-screens', 'Tool store 1: records and screens'],
      ['tutorials/tool-store-2-counter-terminal', 'Tool store 2: counter terminal'],
      ['tutorials/tool-store-3-connections-and-agents', 'Tool store 3: connections and agents'],
      ['tutorials/tool-store-4-deployment', 'Tool store 4: deployment'],
      ['tutorials/parts-desk-1-records-and-quotes', 'Parts desk 1: records and quotes'],
      ['tutorials/parts-desk-2-assistant', 'Parts desk 2: assistant'],
      ['tutorials/parts-desk-3-context-and-scenarios', 'Parts desk 3: context and scenarios'],
      ['tutorials/parts-desk-4-live-model-and-voice', 'Parts desk 4: live model and voice'],
    ],
  ],
  [
    'Build an application',
    [
      ['architecture', 'Architecture'],
      ['primitives', 'Primitives'],
      ['capability-authoring', 'Capability authoring'],
      ['interaction-contract', 'Interaction contract'],
      ['authorization', 'Authorization'],
      ['state-and-reactivity', 'State and reactivity'],
      ['adapters', 'Adapters'],
    ],
  ],
  [
    'Connect',
    [
      ['systems-of-record', 'Systems of record'],
      ['operator-workstations', 'Operator workstations'],
      ['point-of-work-input', 'Point-of-work input'],
      ['hardware-drivers', 'Hardware drivers'],
      ['agents', 'Agents'],
      ['assignments', 'Assignments'],
      ['providers', 'Providers'],
    ],
  ],
  [
    'Run',
    [
      ['hosting', 'Hosting'],
      ['application-lifecycle', 'Application lifecycle'],
      ['security-and-compliance', 'Security and compliance'],
      ['desktop', 'Desktop'],
      ['mobile', 'Mobile'],
    ],
  ],
  [
    'Reference',
    [
      ['glossary', 'Glossary'],
      ['development-and-testing', 'Development and testing'],
      ['implementation-status', 'Implementation status'],
      ['styleguide', 'Documentation styleguide'],
      ['site/README', 'Documentation site'],
    ],
  ],
];

const layers: ReadonlyArray<readonly [directory: string, text: string]> = [
  ['packages', 'Packages'],
  ['workstations', 'Workstations'],
  ['plugins', 'Plugins'],
  ['apps', 'Apps'],
  ['showcase/examples', 'Examples'],
  ['showcase/patterns', 'Patterns'],
  ['sdks', 'SDKs'],
];

const directories = (layer: string): string[] =>
  existsSync(join(repoRoot, layer))
    ? readdirSync(join(repoRoot, layer))
        .filter((name) => statSync(join(repoRoot, layer, name)).isDirectory())
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

/** `docs/<file>.md` or `.mdx` exists; `site/README` and `tutorials/index` are their directories' pages. */
const guideExists = (file: string) =>
  ['md', 'mdx'].some((extension) => existsSync(join(repoRoot, 'docs', `${file}.${extension}`)));

/** The site route of a guide: `docs/site/README.md` is `/docs/site/`, `docs/tutorials/index.md` `/docs/tutorials/`. */
const guideLink = (file: string) => `/docs/${file.replace(/\/(README|index)$/, '')}`;

export function sidebar(): StarlightUserConfig['sidebar'] {
  const items: NonNullable<StarlightUserConfig['sidebar']> = guides
    .map(([group, pages]) => ({
      label: group,
      items: pages
        .filter(([file]) => guideExists(file))
        .map(([file, text]) => ({ label: text, link: guideLink(file) })),
    }))
    .filter((group) => group.items.length);
  const skills: { label: string; link: string }[] = [];
  for (const [layer, text] of layers) {
    const names = directories(layer);
    const withReadmes = names.filter((name) =>
      existsSync(join(repoRoot, layer, name, 'README.md')),
    );
    if (withReadmes.length)
      items.push({
        label: text,
        collapsed: true,
        items: withReadmes.map((name) => ({ label: name, link: `/${layer}/${name}/` })),
      });
    for (const name of names)
      for (const skill of skillsOf(`${layer}/${name}`))
        skills.push({
          label: skillName(`${layer}/${name}`, skill),
          link: `/${layer}/${name}/skills/${skill}/`,
        });
  }
  if (skills.length)
    items.push({
      label: 'Skills',
      collapsed: true,
      items: skills.sort((a, b) => a.label.localeCompare(b.label)),
    });
  return items;
}
