/**
 * The documentation site: Astro Starlight over the pages `scripts/docs-collect.ts` mirrors into
 * `src/content/docs`. The site holds the guides, the root README and AGENTS.md, every workspace
 * README and every skill. `bun run docs:build` writes `dist/docs` at the repository root.
 */
import { satteri } from '@astrojs/markdown-satteri';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import mermaid from 'astro-mermaid';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import starlightLinksValidator from 'starlight-links-validator';
import { repoRoot, sidebar } from './sidebar';
import { pageOutline } from './src/plugins/page-outline';
import { repoLinks } from './src/plugins/repo-links';

const repository = 'https://github.com/wisdomousai/tortoise';
const base = '/tortoise';
const site = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  site: 'https://wisdomousai.github.io',
  base,
  outDir: '../../dist/docs',
  markdown: {
    processor: satteri({
      mdastPlugins: [
        repoLinks({ repoRoot, contentRoot: join(site, 'content/docs'), base, repository }),
      ],
      hastPlugins: [pageOutline()],
    }),
  },
  integrations: [
    // Renders in the browser, so the build needs no browser. It must come before Starlight.
    mermaid({ autoTheme: true }),
    starlight({
      title: 'Tortoise',
      description:
        'A TypeScript framework for small applications at the edge that serve a specialized process.',
      favicon: '/tortoise.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repository }],
      editLink: { baseUrl: `${repository}/edit/main/` },
      lastUpdated: false,
      // The outline sits in the page, above the first H2, instead of in a column beside it.
      tableOfContents: false,
      customCss: ['./src/styles/manual.css'],
      sidebar: sidebar(),
      components: {
        Sidebar: './src/components/Sidebar.astro',
        Search: './src/components/Search.astro',
        PageTitle: './src/components/PageTitle.astro',
        SiteTitle: './src/components/SiteTitle.astro',
      },
      plugins: [starlightLinksValidator()],
    }),
  ],
  vite: {
    resolve: {
      alias: {
        '@repo': repoRoot,
        '@site': site,
        '@reference': join(repoRoot, 'dist/reference'),
      },
    },
    server: { fs: { allow: [repoRoot] } },
  },
});
