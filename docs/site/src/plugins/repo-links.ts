/**
 * Rewrites a page's relative links. The pages keep their repository paths, so a link to another
 * page becomes that page's site route and a link to a source file or directory, which has no
 * page, becomes the same path on GitHub in a new tab, as does a link to a page an export left
 * out. Absolute URLs and anchors stay. A page
 * names its source in the `repoPath` frontmatter the collector writes; a page without one is
 * resolved from its place in the content directory, which mirrors the repository.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MdastPluginEntry } from 'satteri';
import { pageOf } from '../../../../scripts/docs-collect';

export interface RepoLinkOptions {
  repoRoot: string;
  contentRoot: string;
  base: string;
  repository: string;
}

/** The site route of a page's repository path. */
export function routeOf(source: string, base: string): string {
  if (source === 'README.md') return `${base}/`;
  const path = source.replace(/\.mdx?$/, '').replace(/\/(README|SKILL|index)$/, '');
  return `${base}/${path.toLowerCase()}/`;
}

export function repoLinks(options: RepoLinkOptions): MdastPluginEntry {
  const { repoRoot, contentRoot, base, repository } = options;
  return ({ fileURL, data }) => {
    if (!fileURL) return;
    const frontmatter = (data as { astro?: { frontmatter?: { repoPath?: string } } }).astro
      ?.frontmatter;
    const source =
      frontmatter?.repoPath ?? relative(contentRoot, fileURLToPath(fileURL)).split(sep).join('/');
    const directory = dirname(source);
    return {
      name: 'repo-links',
      link(node, ctx) {
        const href = node.url;
        if (/^[a-z][a-z+.-]*:|^[#/]/i.test(href)) return;
        const [file, anchor] = href.split('#');
        if (!file) return;
        const target = normalize(join(directory, file)).split(sep).join('/');
        if (target.startsWith('..')) return;
        const absolute = join(repoRoot, target);
        if (!existsSync(absolute)) return;
        // A page the repository holds is a route; a page an export left out, such as an example's
        // README or a tutorial of that example, is the page in the upstream repository.
        const page = pageOf(target);
        if (page && existsSync(join(contentRoot, page))) {
          ctx.setProperty(node, 'url', `${routeOf(target, base)}${anchor ? `#${anchor}` : ''}`);
          return;
        }
        const kind = statSync(absolute).isDirectory() ? 'tree' : 'blob';
        ctx.setProperty(node, 'url', `${repository}/${kind}/main/${target}`);
        ctx.setProperty(node, 'data', {
          hProperties: { target: '_blank', rel: 'noreferrer' },
        });
      },
    };
  };
}
