<script setup lang="ts">
// One overview view, rendered in the browser after hydration from the generated data. The
// views build their own DOM, so the same code renders the standalone page.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { withBase } from 'vitepress';
import { data } from '../overview.data';
import { mount, type Links, type ViewName } from './overview';

const props = defineProps<{ view: ViewName }>();
const root = ref<HTMLElement>();
const repository = 'https://github.com/youtiger/agent-native-desktop-starter';

const links: Links = {
  doc: (reference) => {
    const [page, anchor] = reference.split('#');
    return withBase(`/docs/${page}${anchor ? `#${anchor}` : ''}`);
  },
  workspace: (directory) => withBase(`/${directory}/`),
  source: (path) => `${repository}/blob/main/${path}`,
};

let unmount: (() => void) | undefined;
onMounted(() => {
  unmount = mount(props.view, root.value!, data, links);
  // On the first load the router measures the anchor before this view has a height and
  // scrolls there in the next animation frame; scroll again after it when the view pushed the
  // anchor down.
  const target =
    location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target && root.value!.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING)
    requestAnimationFrame(() => target.scrollIntoView());
});
onBeforeUnmount(() => unmount?.());
</script>

<template>
  <div ref="root" class="overview-view" />
</template>
