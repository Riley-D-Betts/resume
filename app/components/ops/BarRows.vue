<script setup lang="ts">
export interface BarRow {
  k: string
  n: number
  /** optional right-column override (defaults to n) */
  display?: string
}

const props = defineProps<{ rows: BarRow[] }>()

const maxN = computed(() => Math.max(1, ...props.rows.map(r => r.n)))
</script>

<template>
  <div class="bars">
    <div v-if="rows.length === 0" class="bars__empty label">NO DATA</div>
    <div v-for="r in rows" :key="r.k" class="bars__row">
      <span class="bars__k" :title="r.k">{{ r.k }}</span>
      <span class="bars__track" aria-hidden="true">
        <span class="bars__fill" :style="{ width: `${Math.max(1, (r.n / maxN) * 100)}%` }" />
      </span>
      <span class="bars__n">{{ r.display ?? r.n }}</span>
    </div>
  </div>
</template>

<style scoped>
.bars {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.bars__empty {
  color: var(--text-faint);
  padding: var(--space-2) 0;
}

.bars__row {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(60px, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-data);
}

.bars__k {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text);
}

.bars__track {
  height: 4px;
  background: var(--bg-2);
  overflow: hidden;
}

.bars__fill {
  display: block;
  height: 100%;
  background: var(--teal);
  transition: width 0.4s ease;
}

.bars__row:hover .bars__fill {
  background: var(--teal-hot);
}

.bars__n {
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
</style>
