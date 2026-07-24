<script setup lang="ts">
withDefaults(
  defineProps<{
    label: string
    value: string | number
    sub?: string
    lamp?: 'green' | 'amber' | 'red' | 'teal' | 'off'
    pulse?: boolean
  }>(),
  { sub: undefined, lamp: undefined, pulse: false },
)
</script>

<template>
  <div class="stat" data-testid="stat-card">
    <div class="stat__head">
      <span class="stat__label label">{{ label }}</span>
      <StatusLamp v-if="lamp" :color="lamp" :pulse="pulse" />
    </div>
    <div class="stat__value">{{ value }}</div>
    <div v-if="sub" class="stat__sub label">{{ sub }}</div>
  </div>
</template>

<style scoped>
.stat {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-1);
  border: 1px solid var(--hairline);
  transition: border-color 0.25s;
}

.stat:hover {
  border-color: var(--hairline-lit);
}

.stat__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.stat__value {
  margin-top: var(--space-1);
  font-size: 1.65rem;
  font-weight: 700;
  line-height: 1.15;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.stat__sub {
  margin-top: 2px;
  color: var(--text-faint);
}
</style>
