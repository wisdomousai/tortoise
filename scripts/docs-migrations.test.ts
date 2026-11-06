import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { brokenLinks } from './markdown-links';
import { retiredDocs, retiredTarget } from './docs-migrations';
import { primitivesByWorkspace } from './overview-ownership';

const root = resolve(import.meta.dir, '..');

test('retired pages and their published fragments resolve to current documentation', () => {
  for (const [page, entry] of Object.entries(retiredDocs)) {
    expect(retiredTarget(page, '#unknown-fragment')).toBe(entry.target);
    for (const fragment of ['', ...Object.keys(entry.fragments)]) {
      const reference = retiredTarget(page, fragment);
      const [target, anchor] = reference.split('#');
      expect(
        brokenLinks(
          resolve(root, 'docs/redirect-check.md'),
          `[target](${target}.md${anchor ? '#' + anchor : ''})`,
        ),
      ).toEqual([]);
    }
  }
});

test('architecture concept ownership references existing workspaces and definitions', () => {
  for (const [workspace, anchors] of Object.entries(primitivesByWorkspace)) {
    const links =
      `[workspace](../${workspace}/package.json)\n` +
      anchors.map((anchor) => `[concept](primitives.md#${anchor})`).join('\n');
    expect(brokenLinks(resolve(root, 'docs/ownership-check.md'), links)).toEqual([]);
  }
});
