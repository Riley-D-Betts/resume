<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; meta?: string }>()
</script>

<template>
  <div class="ns-titlebar">
    <div class="ns-titlebar__main">
      <h1 class="ns-title">
        {{ title }}<small v-if="meta">{{ meta }}</small>
      </h1>
      <p v-if="subtitle" class="ns-subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="ns-titlebar__actions">
      <slot name="actions" />
    </div>
  </div>
</template>
