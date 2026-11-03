# Documentation site

The documentation site is an Astro Starlight site over the repository's markdown: the guides in `docs/`, the root README and AGENTS.md, every workspace README and every skill. `scripts/docs-collect.ts` mirrors those pages into `src/content/docs` (generated, not committed) and adds the frontmatter Starlight needs. A page keeps its repository path, so a relative link between pages resolves as it does on GitHub, and a relative link to a source file becomes the GitHub page for it (`src/plugins/repo-links.ts`).

The site reads `dist/reference/overview.json`, which `bun run generate` writes, for the maps on the overview page (`src/components/OverviewView.astro`, `src/overview/`). A tutorial page imports example files with `?raw` and shows a region of them (`src/region.ts`), so a renamed file or region fails the build. `starlight-links-validator` fails the build on a broken internal link.

## Commands

From the repository root:

- `bun run docs:dev` generates the reference, mirrors the pages and serves the site with a watcher that re-mirrors a changed page.
- `bun run docs:build` writes `dist/docs`.
- `bun run docs:preview` serves `dist/docs`.
- `bun run docs:screenshots` regenerates the tutorial screenshots in `docs/assets/screenshots/`.

## References

- [Documentation styleguide](../styleguide.md)
- [Development and testing](../development-and-testing.md)
