/**
 * The default theme without its Inter font files, with the overview views registered for
 * `docs/overview.md`. An export that leaves out examples or framework packages has no overview
 * view, and registers none. The tortoise sits before the site title in the nav and on the 404
 * page. The sidebar starts with a search field; a page starts with its sidebar group and lists
 * its sections before the first H2.
 */
import DefaultTheme from 'vitepress/theme-without-fonts';
import type { Theme } from 'vitepress';
import { h, type Component } from 'vue';
import DocBreadcrumb from './DocBreadcrumb.vue';
import NotFound from './NotFound.vue';
import PageOutline from './PageOutline.vue';
import SidebarSearch from './SidebarSearch.vue';
import Tortoise from './Tortoise.vue';
import './style.css';

const views = import.meta.glob<{ default: Component }>('./OverviewView.vue', { eager: true });

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'nav-bar-title-before': () => h(Tortoise, { class: 'nav-tortoise' }),
      'sidebar-nav-before': () => h(SidebarSearch),
      'doc-before': () => h(DocBreadcrumb),
      'not-found': () => h(NotFound),
    }),
  enhanceApp({ app }) {
    app.component('PageOutline', PageOutline);
    for (const view of Object.values(views)) app.component('OverviewView', view.default);
  },
} satisfies Theme;
