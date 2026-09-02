<script setup lang="ts">
/**
 * CHART ⇄ TABLE chip pair (design rule: a table view for anything with more
 * than a handful of values). Default slot = the chart, `table` slot = its
 * DataTable twin. Uncontrolled by default; `v-model` when the page cares.
 */
const props = withDefaults(
  defineProps<{
    modelValue?: 'chart' | 'table'
    chartLabel?: string
    tableLabel?: string
    /** Hide the chips (render only the chart) — e.g. when there are ≤ 3 values. */
    disabled?: boolean
  }>(),
  { modelValue: undefined, chartLabel: 'CHART', tableLabel: 'TABLE', disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: 'chart' | 'table'] }>()

const inner = ref<'chart' | 'table'>(props.modelValue ?? 'chart')
watch(
  () => props.modelValue,
  v => {
    if (v) inner.value = v
  },
)

const view = computed(() => (props.disabled ? 'chart' : inner.value))

function pick(v: 'chart' | 'table') {
  inner.value = v
  emit('update:modelValue', v)
}
</script>

<template>
  <div class="tt">
    <div v-if="!disabled" class="tt__chips" data-testid="table-toggle" role="group" aria-label="Chart or table view">
      <button type="button" class="tt__chip label" :class="{ 'tt__chip--on': view === 'chart' }" :aria-pressed="view === 'chart'" @click="pick('chart')">
        {{ chartLabel }}
      </button>
      <button type="button" class="tt__chip label" :class="{ 'tt__chip--on': view === 'table' }" :aria-pressed="view === 'table'" @click="pick('table')">
        {{ tableLabel }}
      </button>
    </div>
    <div v-show="view === 'chart'" class="tt__pane">
      <slot />
    </div>
    <div v-if="view === 'table'" class="tt__pane">
      <slot name="table" />
    </div>
  </div>
</template>

<style scoped>
.tt {
  min-width: 0;
}

.tt__chips {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin-bottom: var(--space-2);
}

.tt__chip {
  padding: 1px var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-faint);
}

.tt__chip:hover {
  color: var(--teal-hot);
  border-color: var(--hairline-lit);
}

.tt__chip--on {
  color: var(--text);
  border-color: var(--hairline-lit);
  background: var(--bg-2);
}

.tt__pane {
  min-width: 0;
}
</style>
