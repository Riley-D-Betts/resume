<script setup lang="ts">
import type { Tone } from '~/data/resume'

defineProps<{
  type: string
  name: string
  subtitle?: string
  glyph?: string
  statusTone?: Tone
  statusLabel?: string
}>()
</script>

<template>
  <div class="ns-record__band">
    <div v-if="glyph" class="ns-record__avatar" aria-hidden="true">{{ glyph }}</div>
    <div class="ns-record__id">
      <div class="ns-record__type">{{ type }}</div>
      <div class="ns-record__name">
        {{ name }}<small v-if="subtitle">{{ subtitle }}</small>
      </div>
    </div>
    <div class="ns-record__actions">
      <NsStatusPill v-if="statusLabel && statusTone" :tone="statusTone" :label="statusLabel" />
      <slot name="actions" />
    </div>
  </div>
</template>
