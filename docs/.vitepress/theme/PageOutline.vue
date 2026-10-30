<script setup lang="ts">
// The page's sections as a row of links. `page-outline.ts` places it before the first H2; a page
// with fewer than two sections shows none.
import { useData } from 'vitepress';
import { computed } from 'vue';

const { page } = useData();
const sections = computed(() => page.value.headers.filter((header) => header.level === 2));
</script>

<template>
  <nav v-if="sections.length > 1" class="page-outline" aria-labelledby="page-outline-title">
    <p id="page-outline-title" class="page-outline-title">On this page</p>
    <ul>
      <li v-for="section in sections" :key="section.link">
        <a :href="section.link">{{ section.title }}</a>
      </li>
    </ul>
  </nav>
</template>

<style>
.vp-doc .page-outline {
  margin: 32px 0 0;
  padding: 16px 0;
  border-top: 1px solid var(--vp-c-divider);
  border-bottom: 1px solid var(--vp-c-divider);
}

.vp-doc .page-outline-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  line-height: 24px;
}

.vp-doc .page-outline ul {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.vp-doc .page-outline li + li {
  margin-top: 0;
}

.vp-doc .page-outline a {
  font-size: 14px;
  line-height: 24px;
}

.vp-doc .page-outline + h2 {
  margin-top: 40px;
}
</style>
