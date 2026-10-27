/**
 * The default theme with the overview views registered for `docs/overview.md`. An export that
 * leaves out examples or framework packages has no overview view, and registers none. The
 * tortoise sits before the site title in the nav and on the 404 page.
 */
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import { h, type Component } from 'vue';
import NotFound from './NotFound.vue';
import Tortoise from './Tortoise.vue';
import './style.css';

const views = import.meta.glob<{ default: Component }>('./OverviewView.vue', { eager: true });

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'nav-bar-title-before': () => h(Tortoise, { class: 'nav-tortoise' }),
      'not-found': () => h(NotFound),
    }),
  enhanceApp({ app }) {
    for (const view of Object.values(views)) app.component('OverviewView', view.default);
  },
} satisfies Theme;
