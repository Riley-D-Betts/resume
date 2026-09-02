<script setup lang="ts">
export interface FunnelStepRow {
  label: string
  n: number
}

/**
 * Ordered funnel: one hue, each step's bar is its share of the first step,
 * with `% OF FIRST` and the drop-off from the previous step in text tokens.
 * `aside` lists the off-path outcomes (INVALID / RESET / ABANDON).
 */
const props = withDefaults(
  defineProps<{
    steps: FunnelStepRow[]
    aside?: FunnelStepRow[]
    asideLabel?: string
    colorVar?: string
    testid?: string
  }>(),
  { aside: () => [], asideLabel: 'ALSO', colorVar: '--series-1', testid: 'funnel' },
)

const fmt = useOpsFormat()

const first = computed(() => props.steps[0]?.n ?? 0)

const rows = computed(() =>
  props.steps.map((s, i) => {
    const prev = i > 0 ? props.steps[i - 1]!.n : null
    const ofFirst = first.value > 0 ? (s.n / first.value) * 100 : 0
    const drop = prev !== null && prev > 0 ? ((s.n - prev) / prev) * 100 : null
    return { ...s, i, ofFirst, drop, width: first.value > 0 ? Math.max(s.n > 0 ? 1 : 0, ofFirst) : 0 }
  }),
)

const hover = ref<number | null>(null)

function tip(r: (typeof rows.value)[number]): string {
  const parts = [`${r.label}: ${fmt.num(r.n)}`, `${fmt.pct(r.ofFirst, 1)} of first`]
  if (r.drop !== null) parts.push(`${r.drop <= 0 ? '−' : '+'}${Math.abs(r.drop).toFixed(0)}% vs previous`)
  return parts.join(' · ')
}
</script>

<template>
  <div class="fn" :data-testid="testid" role="img" :aria-label="`Funnel: ${steps.map(s => `${s.label} ${s.n}`).join(', ')}`">
    <div v-if="rows.length === 0" class="fn__empty label">NO DATA</div>
    <div v-else class="fn__body">
      <div class="fn__steps">
        <div
          v-for="r in rows"
          :key="r.i"
          class="fn__row"
          :class="{ 'fn__row--on': hover === r.i }"
          @pointerenter="hover = r.i"
          @pointerleave="hover = null"
        >
          <span class="fn__label">{{ r.label }}</span>
          <span class="fn__track" aria-hidden="true">
            <span class="fn__fill" :style="{ width: `${r.width}%`, background: `var(${colorVar})` }" />
            <span v-if="hover === r.i" class="fn__tip" data-testid="chart-tooltip">{{ tip(r) }}</span>
          </span>
          <span class="fn__n">{{ fmt.num(r.n) }}</span>
          <span class="fn__pct">{{ fmt.pct(r.ofFirst, 0) }}</span>
          <span class="fn__drop">{{ r.drop === null ? '' : `${r.drop <= 0 ? '−' : '+'}${Math.abs(r.drop).toFixed(0)}%` }}</span>
        </div>
        <div class="fn__head label" aria-hidden="true">
          <span />
          <span />
          <span>N</span>
          <span>OF FIRST</span>
          <span>STEP Δ</span>
        </div>
      </div>
      <div v-if="aside.length" class="fn__aside">
        <div class="label fn__aside-h">{{ asideLabel }}</div>
        <div v-for="a in aside" :key="a.label" class="fn__aside-row">
          <span class="fn__aside-k">{{ a.label }}</span>
          <span class="fn__aside-n">{{ fmt.num(a.n) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fn {
  min-width: 0;
}

.fn__empty {
  padding: var(--space-2) 0;
  color: var(--text-faint);
}

.fn__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3);
}

.fn__steps {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.fn__row,
.fn__head {
  display: grid;
  grid-template-columns: minmax(6em, 0.8fr) minmax(80px, 2fr) 4em 5em 4.5em;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-data);
  font-variant-numeric: tabular-nums;
}

.fn__head {
  color: var(--text-faint);
  text-align: right;
}

.fn__label {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fn__track {
  position: relative;
  display: block;
  height: 14px;
  background: var(--bg-2);
}

.fn__fill {
  display: block;
  height: 100%;
  transition: width 0.4s ease;
}

.fn__row--on .fn__fill {
  filter: brightness(1.2);
}

.fn__tip {
  position: absolute;
  left: 0;
  bottom: calc(100% + 4px);
  z-index: 2;
  padding: 2px var(--space-2);
  background: var(--bg-2);
  border: 1px solid var(--hairline-lit);
  color: var(--text);
  font-size: var(--fs-micro);
  white-space: nowrap;
  pointer-events: none;
}

.fn__n {
  color: var(--text);
  text-align: right;
}

.fn__pct,
.fn__drop {
  color: var(--text-dim);
  text-align: right;
}

.fn__aside {
  min-width: 9em;
  padding-left: var(--space-3);
  border-left: 1px solid var(--hairline);
}

.fn__aside-h {
  color: var(--text-faint);
  margin-bottom: var(--space-1);
}

.fn__aside-row {
  display: flex;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--fs-data);
  font-variant-numeric: tabular-nums;
}

.fn__aside-k {
  color: var(--text-dim);
}

.fn__aside-n {
  color: var(--text);
}

@media (max-width: 640px) {
  .fn__body {
    grid-template-columns: 1fr;
  }

  .fn__aside {
    padding-left: 0;
    border-left: none;
    border-top: 1px solid var(--hairline);
    padding-top: var(--space-2);
  }
}
</style>
