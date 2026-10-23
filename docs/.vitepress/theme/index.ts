/**
 * The default theme with the overview views registered for `docs/overview.md`. An export that
 * leaves out examples or framework packages has no overview view, and registers none.
 */
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import type { Component } from 'vue';
import './style.css';

const views = import.meta.glob<{ default: Component }>('./OverviewView.vue', { eager: true });

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    for (const view of Object.values(views)) app.component('OverviewView', view.default);
  },
} satisfies Theme;
