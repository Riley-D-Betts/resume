<script setup lang="ts">
defineProps<{
  num: string
  title: string
  tag?: string
}>()
</script>

<template>
  <header class="sec-header">
    <div class="sec-header__row">
      <span class="sec-header__num">{{ num }}</span>
      <h2 class="sec-header__title display">{{ title }}</h2>
    </div>
    <div v-if="tag" class="sec-header__tag label">{{ tag }}</div>
    <div class="sec-header__rule" aria-hidden="true" />
  </header>
</template>

<style scoped>
.sec-header {
  margin-bottom: var(--space-4);
}

.sec-header__row {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
}

.sec-header__num {
  font-size: var(--fs-data);
  color: var(--teal-hot);
  letter-spacing: 0.14em;
}

.sec-header__num::after {
  content: ' //';
  color: var(--text-faint);
}

.sec-header__title {
  font-size: clamp(1.4rem, 3.5vw, 2.6rem);
}

.sec-header__tag {
  margin-top: var(--space-1);
  color: var(--text-faint);
}

.sec-header__rule {
  margin-top: var(--space-2);
  height: 1px;
  background: linear-gradient(to right, var(--teal), var(--hairline) 40%, transparent);
}
</style>
