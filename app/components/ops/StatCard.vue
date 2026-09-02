<script setup lang="ts">
import { NuxtLink } from '#components'
import type { Delta } from '~/composables/useOpsFormat'

/**
 * Headline number tile. `delta` (or `prev` + a numeric `value`) renders
 * `▲ 12%` in a text token — the glyph carries the direction, colour never
 * does (design-inputs: status colours are reserved for state).
 */
const props = withDefaults(
  defineProps<{
    label: string
    value: string | number
    sub?: string
    lamp?: 'green' | 'amber' | 'red' | 'teal' | 'off'
    pulse?: boolean
    /** Precomputed delta (`useOpsFormat().delta`) or a bare `{ abs, pct }`. */
    delta?: Partial<Delta> | null
    /** Previous-period value; with a numeric `value` the delta is derived. */
    prev?: number | null
    /** Tooltip (title) for the tile — e.g. the exact definition of the measure. */
    hint?: string
    /** Drill-down; the whole tile becomes a link. */
    to?: string
    testid?: string
  }>(),
  {
    sub: undefined,
    lamp: undefined,
    pulse: false,
    delta: undefined,
    prev: undefined,
    hint: undefined,
    to: undefined,
    testid: 'stat-card',
  },
)

const fmt = useOpsFormat()

const deltaText = computed<string | null>(() => {
  const d = props.delta
  if (d) {
    if (d.text) return d.text
    if (typeof d.abs !== 'number') return null
    const glyph = d.glyph ?? (d.abs > 0 ? '▲' : d.abs < 0 ? '▼' : '▬')
    if (typeof d.pct === 'number') {
      const a = Math.abs(d.pct)
      return `${glyph} ${a >= 100 ? Math.round(a) : a.toFixed(a < 10 ? 1 : 0)}%`
    }
    return `${glyph} ${d.abs > 0 ? '+' : ''}${fmt.num(d.abs)}`
  }
  if (props.prev !== undefined && props.prev !== null && typeof props.value === 'number') {
    return fmt.delta(props.value, props.prev)?.text ?? null
  }
  return null
})

const deltaTitle = computed(() =>
  props.prev !== undefined && props.prev !== null ? `vs previous period: ${fmt.num(props.prev)}` : 'vs previous period',
)
</script>

<template>
  <component :is="to ? NuxtLink : 'div'" :to="to" class="stat" :class="{ 'stat--link': to }" :data-testid="testid" :title="hint">
    <div class="stat__head">
      <span class="stat__label label">{{ label }}</span>
      <StatusLamp v-if="lamp" :color="lamp" :pulse="pulse" />
    </div>
    <div class="stat__row">
      <div class="stat__value">{{ value }}</div>
      <span v-if="deltaText" class="stat__delta" data-testid="stat-delta" :title="deltaTitle">{{ deltaText }}</span>
    </div>
    <div v-if="sub" class="stat__sub label">{{ sub }}</div>
  </component>
</template>

<style scoped>
.stat {
  display: block;
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-1);
  border: 1px solid var(--hairline);
  color: inherit;
  transition: border-color 0.25s;
}

.stat:hover {
  border-color: var(--hairline-lit);
  text-decoration: none;
}

.stat--link:hover .stat__label {
  color: var(--teal-hot);
}

.stat__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.stat__row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
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

.stat__delta {
  font-size: var(--fs-micro);
  letter-spacing: 0.08em;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.stat__sub {
  margin-top: 2px;
  color: var(--text-faint);
}
</style>
