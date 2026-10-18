/** The default theme with the overview views registered for `docs/overview.md`. */
import DefaultTheme from 'vitepress/theme';
import type { Theme } from 'vitepress';
import OverviewView from './OverviewView.vue';
import './style.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('OverviewView', OverviewView);
  },
} satisfies Theme;
