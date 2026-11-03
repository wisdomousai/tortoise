/**
 * Places the page outline before a page's first H2, below its introduction: the H2s as a row of
 * links under "On this page". A page with fewer than two sections gets none. The heading ids
 * are the ones the page has when the hook runs, or the same slugs Astro gives them.
 */
import GithubSlugger from 'github-slugger';
import type { Element, ElementContent } from 'hast';
import type { HastPluginEntry } from 'satteri';

const element = (
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[],
): Element => ({ type: 'element', tagName, properties, children });

export function pageOutline(): HastPluginEntry {
  return {
    name: 'page-outline',
    after(root, ctx) {
      const sections = root.children.filter(
        (node): node is Element => node.type === 'element' && node.tagName === 'h2',
      );
      if (sections.length < 2) return;
      const slugger = new GithubSlugger();
      const items = sections.map((section) => {
        const text = ctx.textContent(section);
        const id =
          typeof section.properties?.id === 'string' ? section.properties.id : slugger.slug(text);
        return element('li', {}, [
          element('a', { href: `#${id}` }, [{ type: 'text', value: text }]),
        ]);
      });
      ctx.insertBefore(
        sections[0]!,
        element('nav', { className: ['page-outline'], ariaLabelledBy: 'page-outline-title' }, [
          element('p', { id: 'page-outline-title', className: ['page-outline-title'] }, [
            { type: 'text', value: 'On this page' },
          ]),
          element('ul', {}, items),
        ]),
      );
    },
  };
}
