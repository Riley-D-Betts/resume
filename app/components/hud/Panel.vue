<script setup lang="ts">
defineProps<{
  title?: string
  /** tint the chrome teal (fobech section) */
  teal?: boolean
}>()
</script>

<template>
  <div class="panel" :class="{ 'panel--teal': teal }">
    <span class="panel__corner panel__corner--tl" aria-hidden="true" />
    <span class="panel__corner panel__corner--tr" aria-hidden="true" />
    <span class="panel__corner panel__corner--bl" aria-hidden="true" />
    <span class="panel__corner panel__corner--br" aria-hidden="true" />
    <div v-if="title" class="panel__title label">{{ title }}</div>
    <div class="panel__body">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.panel {
  position: relative;
  background: var(--bg-1);
  border: 1px solid var(--hairline);
}

.panel--teal {
  border-color: rgba(0, 116, 132, 0.55);
  background: rgba(1, 42, 49, 0.45);
}

.panel__corner {
  position: absolute;
  width: 9px;
  height: 9px;
  border: 1px solid var(--text-dim);
  transition: border-color 0.25s, width 0.25s, height 0.25s;
}

.panel--teal .panel__corner {
  border-color: var(--teal-hot);
}

.panel__corner--tl { top: -1px; left: -1px; border-right: none; border-bottom: none; }
.panel__corner--tr { top: -1px; right: -1px; border-left: none; border-bottom: none; }
.panel__corner--bl { bottom: -1px; left: -1px; border-right: none; border-top: none; }
.panel__corner--br { bottom: -1px; right: -1px; border-left: none; border-top: none; }

.panel:hover .panel__corner {
  border-color: var(--teal-hot);
  width: 14px;
  height: 14px;
}

.panel__title {
  position: absolute;
  top: -0.55em;
  left: var(--space-3);
  padding: 0 var(--space-2);
  background: var(--bg-0);
  color: var(--text-dim);
  white-space: nowrap;
}

.panel__body {
  padding: var(--space-3);
}
</style>
