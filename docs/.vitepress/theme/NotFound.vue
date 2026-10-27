<script setup lang="ts">
// The page for a path the site does not have: a tucked tortoise and a link to the home page.
import { withBase } from 'vitepress';
import Tortoise from './Tortoise.vue';
</script>

<template>
  <div class="not-found">
    <Tortoise class="not-found-tortoise" tucked />
    <p class="not-found-code">404</p>
    <h1 class="not-found-title">Page not found</h1>
    <a class="not-found-link" :href="withBase('/')">Home</a>
  </div>
</template>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 64px 24px 96px;
  text-align: center;
}

.not-found-tortoise {
  width: min(240px, 70vw);
  margin-bottom: 16px;
}

.not-found-code {
  font-size: 48px;
  font-weight: 600;
  line-height: 1;
  color: var(--vp-c-text-2);
}

.not-found-title {
  font-size: 20px;
  font-weight: 600;
}

.not-found-link {
  margin-top: 12px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 16px;
  padding: 3px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  transition:
    border-color 0.25s,
    color 0.25s;
}

.not-found-link:hover {
  border-color: var(--vp-c-brand-2);
  color: var(--vp-c-brand-2);
}
</style>
