/**
 * The documentation site. The source directory is the repository root, so a guide's relative link
 * to a workspace README or a skill resolves the same way it does on GitHub. The site holds the guides, the root README and AGENTS.md, every
 * workspace README and every skill. `bun run docs:build` writes `dist/docs`.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { defineConfig } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';
import { repoRoot, sidebar } from './sidebar';

const repository = 'https://github.com/wisdomousai/agent-native-desktop-starter';

/**
 * The tortoise as the site icon. It is inlined as a data URL, because the site's public directory
 * would be `public/` at the repository root.
 */
const tortoise = readFileSync(join(repoRoot, 'docs/assets/tortoise.svg'), 'utf8');
const icon = `data:image/svg+xml,${encodeURIComponent(tortoise)}`;

/**
 * A relative link to a source file or a directory has no page on the site. It points at the same
 * path on GitHub instead, so a README's `src/app.tsx` link keeps working.
 */
function sourceLink(href: string, pagePath: string): string | undefined {
  if (/^[a-z][a-z+.-]*:|^[#/]/i.test(href)) return undefined;
  const [file] = href.split('#');
  if (!file || /\.md$/i.test(file)) return undefined;
  const target = normalize(join(dirname(pagePath), file));
  if (target.startsWith('..')) return undefined;
  const absolute = join(repoRoot, target);
  if (!existsSync(absolute)) return undefined;
  const kind = statSync(absolute).isDirectory() ? 'tree' : 'blob';
  return `${repository}/${kind}/main/${target.split('\\').join('/')}`;
}

export default withMermaid(
  defineConfig({
    title: 'Tortoise',
    description:
      'A TypeScript reference architecture for applications at the point of work that deliver to systems of record.',
    base: '/agent-native-desktop-starter/',
    head: [['link', { rel: 'icon', type: 'image/svg+xml', href: icon }]],
    srcDir: '..',
    outDir: '../dist/docs',
    cacheDir: '../dist/docs-cache',
    srcExclude: [
      '**/node_modules/**',
      'dist/**',
      'artifacts/**',
      'test-results/**',
      'playwright-report/**',
      '**/.workspace/**',
      '**/CHANGELOG.md',
    ],
    rewrites: {
      'README.md': 'index.md',
      'packages/:name/README.md': 'packages/:name/index.md',
      'plugins/:name/README.md': 'plugins/:name/index.md',
      'apps/:name/README.md': 'apps/:name/index.md',
      'examples/:name/README.md': 'examples/:name/index.md',
      'patterns/:name/README.md': 'patterns/:name/index.md',
      'sdks/:name/README.md': 'sdks/:name/index.md',
      ':layer/:name/skills/:skill/SKILL.md': ':layer/:name/skills/:skill/index.md',
    },
    markdown: {
      config(md) {
        const render = md.renderer.rules.link_open;
        md.renderer.rules.link_open = (tokens, index, options, env, self) => {
          const token = tokens[index]!;
          const href = token.attrGet('href');
          const page = (env as { relativePath?: string }).relativePath;
          const external = href && page ? sourceLink(href, page) : undefined;
          if (external) {
            token.attrSet('href', external);
            token.attrSet('target', '_blank');
            token.attrSet('rel', 'noreferrer');
          }
          return render
            ? render(tokens, index, options, env, self)
            : self.renderToken(tokens, index, options);
        };
      },
    },
    cleanUrls: true,
    lastUpdated: false,
    ignoreDeadLinks: false,
    themeConfig: {
      nav: [
        { text: 'Guides', link: '/docs/overview' },
        { text: 'Glossary', link: '/docs/glossary' },
        { text: 'AGENTS.md', link: '/AGENTS' },
      ],
      sidebar: sidebar(),
      search: { provider: 'local' },
      socialLinks: [{ icon: 'github', link: repository }],
      outline: [2, 3],
    },
  }),
);
