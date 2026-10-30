/**
 * Places the page outline before a page's first H2, below its introduction. The markdown holds
 * only the component tag; the component lists the H2s from the page data. The local search index
 * reads the rendered markdown, so it does not get the section titles a second time.
 */
import type { MarkdownRenderer } from 'vitepress';

export function pageOutline(md: MarkdownRenderer): void {
  md.core.ruler.push('page_outline', (state) => {
    const first = state.tokens.findIndex(
      (token) => token.type === 'heading_open' && token.tag === 'h2' && token.level === 0,
    );
    if (first < 0) return;
    const outline = new state.Token('html_block', '', 0);
    outline.content = '<PageOutline />\n';
    state.tokens.splice(first, 0, outline);
  });
}
