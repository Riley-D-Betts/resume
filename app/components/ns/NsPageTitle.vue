<script setup lang="ts">
/** A list/page heading, styled like NetSuite's record-type heading. */
defineProps<{ title: string; subtitle?: string }>()
</script>

<template>
  <div class="ns-pagetitle">
    <div class="ns-pagetitle__first">
      <h1 class="ns-record-type">{{ title }}</h1>
      <div v-if="$slots.actions" class="ns-pagetitle__menu">
        <slot name="actions" />
      </div>
    </div>
    <p v-if="subtitle" class="ns-pagesub">{{ subtitle }}</p>
  </div>
</template>
