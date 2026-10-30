<script setup lang="ts">
// A search field at the top of the sidebar. Submitting it opens the theme's local search box with
// the typed text. The theme keeps that text in session storage under the key below and opens the
// box on Ctrl+K or Cmd+K. If a theme update changes either, the box opens empty or not at all.
import { ref } from 'vue';

const query = ref('');

function search() {
  sessionStorage.setItem('vitepress:local-search-filter', query.value);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: true }));
}
</script>

<template>
  <form class="sidebar-search" role="search" @submit.prevent="search">
    <label for="sidebar-search-input">Search the documentation</label>
    <div class="sidebar-search-row">
      <input id="sidebar-search-input" v-model="query" type="search" placeholder="Search" />
      <button type="submit">Search</button>
    </div>
  </form>
</template>

<style>
.sidebar-search {
  padding: 24px 0 16px;
}

.sidebar-search label {
  display: block;
  margin-bottom: 6px;
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
  color: var(--vp-c-text-1);
}

.sidebar-search-row {
  display: flex;
  gap: 6px;
}

.sidebar-search :is(input, button) {
  height: 36px;
  border: 1px solid var(--vp-c-border);
  border-radius: 4px;
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.sidebar-search input {
  flex: 1;
  min-width: 0;
  padding: 0 10px;
  background-color: var(--vp-c-bg);
}

.sidebar-search button {
  padding: 0 12px;
  background-color: var(--vp-c-bg-soft);
}

.sidebar-search button:hover {
  border-color: var(--vp-c-brand-1);
}

.sidebar-search :is(input, button):focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -1px;
}
</style>
