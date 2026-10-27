<script setup lang="ts">
// The tortoise from docs/assets/tortoise.svg, inlined so its head, legs and tail can move. It pulls
// them in while it or the nav title link is hovered. A tucked tortoise keeps them in and puts
// them out while hovered.
import drawing from '../../assets/tortoise.svg?raw';

defineProps<{ tucked?: boolean }>();
</script>

<template>
  <span class="tortoise" :class="{ tucked }" aria-hidden="true" v-html="drawing" />
</template>

<style>
.tortoise {
  display: inline-block;
  flex-shrink: 0;
  line-height: 0;
}

.tortoise svg {
  display: block;
  width: 100%;
  height: auto;
}

.tortoise :is(.head, .legs, .tail) {
  transition: transform 0.4s ease;
}

.tortoise:hover .head,
a:hover > .tortoise .head,
.tortoise.tucked .head {
  transform: translateX(-50px);
}

.tortoise:hover .legs,
a:hover > .tortoise .legs,
.tortoise.tucked .legs {
  transform: translateY(-12px);
}

.tortoise:hover .tail,
a:hover > .tortoise .tail,
.tortoise.tucked .tail {
  transform: translateX(8px);
}

.tortoise.tucked:hover :is(.head, .legs, .tail) {
  transform: none;
}

@media (prefers-reduced-motion: reduce) {
  .tortoise :is(.head, .legs, .tail) {
    transition: none;
  }
}
</style>
