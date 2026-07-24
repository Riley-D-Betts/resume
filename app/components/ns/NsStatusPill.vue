<script setup lang="ts">
import type { Tone } from '~/data/resume'

/** Compact status indicator used inside lists and sublists. */
defineProps<{ tone: Tone; label: string }>()
</script>

<template>
  <span class="ns-pill" :class="`ns-pill--${tone}`">{{ label }}</span>
</template>
