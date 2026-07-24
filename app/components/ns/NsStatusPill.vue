<script setup lang="ts">
import type { Tone } from '~/data/resume'

defineProps<{ tone: Tone; label: string }>()
</script>

<template>
  <span class="ns-pill" :class="`ns-pill--${tone}`">
    <span class="ns-pill__dot" aria-hidden="true" />
    {{ label }}
  </span>
</template>
