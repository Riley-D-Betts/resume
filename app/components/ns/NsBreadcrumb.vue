<script setup lang="ts">
defineProps<{ items: { label: string; to?: string }[] }>()
</script>

<template>
  <nav class="ns-crumbs" aria-label="Breadcrumb">
    <template v-for="(c, i) in items" :key="c.label">
      <NuxtLink v-if="c.to" :to="c.to">{{ c.label }}</NuxtLink>
      <span v-else>{{ c.label }}</span>
      <span v-if="i < items.length - 1" class="ns-crumbs__sep" aria-hidden="true">›</span>
    </template>
  </nav>
</template>
