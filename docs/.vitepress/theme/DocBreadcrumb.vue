<script setup lang="ts">
// The site title and the sidebar group of the current page, above the page title. A page that
// is not in the sidebar, such as the home page or AGENTS.md, shows none.
import { useData, withBase, type DefaultTheme } from 'vitepress';
import { computed } from 'vue';

const { site, theme, page } = useData<DefaultTheme.Config>();

/** `docs/overview.md` is linked as `/docs/overview`, `packages/host/index.md` as `/packages/host/`. */
const link = computed(
  () => '/' + page.value.relativePath.replace(/\.md$/, '').replace(/(^|\/)index$/, '$1'),
);

const group = computed(() => {
  const sidebar = theme.value.sidebar;
  if (!Array.isArray(sidebar)) return undefined;
  return sidebar.find((item) => item.items?.some((entry) => entry.link === link.value))?.text;
});
</script>

<template>
  <nav v-if="group" class="doc-breadcrumb" aria-label="Breadcrumb">
    <a :href="withBase('/')">{{ site.title }}</a>
    <span aria-hidden="true"> / </span>
    <span>{{ group }}</span>
  </nav>
</template>

<style>
.doc-breadcrumb {
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 20px;
  color: var(--vp-c-text-2);
}

.doc-breadcrumb a {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
