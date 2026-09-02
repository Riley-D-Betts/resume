<script setup lang="ts">
export interface PercentileTile {
  /** `lcp` · `inp` · `cls` · `ttfb` · `fcp` · `dcl` · `load` · `softNav` … */
  metric: string
  label?: string
  p50: number | null
  p75: number | null
  p95: number | null
  n?: number
  /** `ms` (default) or `score` (CLS). */
  unit?: 'ms' | 'score'
  /** `[good, poor]` — overrides the Web-Vitals defaults; omit for no rating. */
  thresholds?: [number, number] | null
  /** e.g. `PER DOCUMENT LOAD` / `PER SPA NAV`. */
  sub?: string
}

/**
 * p50 / p75 / p95 tiles. Rating (GOOD · NEEDS WORK · POOR) follows the
 * Web-Vitals thresholds on p75 and is always a WORD plus a lamp — never
 * colour alone — with the thresholds printed as a label.
 */
const props = withDefaults(defineProps<{ tiles: PercentileTile[]; testid?: string }>(), { testid: 'perf-tile' })

const fmt = useOpsFormat()

const DEFAULTS: Record<string, { label: string; thresholds: [number, number] | null; unit: 'ms' | 'score' }> = {
  lcp: { label: 'LCP', thresholds: [2500, 4000], unit: 'ms' },
  inp: { label: 'INP', thresholds: [200, 500], unit: 'ms' },
  cls: { label: 'CLS', thresholds: [0.1, 0.25], unit: 'score' },
  ttfb: { label: 'TTFB', thresholds: [800, 1800], unit: 'ms' },
  fcp: { label: 'FCP', thresholds: [1800, 3000], unit: 'ms' },
  dcl: { label: 'DCL', thresholds: null, unit: 'ms' },
  load: { label: 'LOAD', thresholds: null, unit: 'ms' },
  softNav: { label: 'SOFT NAV', thresholds: null, unit: 'ms' },
}

type Rating = { word: 'GOOD' | 'NEEDS WORK' | 'POOR'; lamp: 'green' | 'amber' | 'red' } | null

function fv(v: number | null, unit: 'ms' | 'score'): string {
  if (v === null || !Number.isFinite(v)) return '—'
  return unit === 'score' ? v.toFixed(3) : fmt.ms(v)
}

const view = computed(() =>
  props.tiles.map(t => {
    const d = DEFAULTS[t.metric]
    const unit = t.unit ?? d?.unit ?? 'ms'
    const thresholds = t.thresholds === undefined ? (d?.thresholds ?? null) : t.thresholds
    // n = 0 is NO SAMPLE, not a fast page: no number, no rating lamp (R4-M1).
    const empty = t.n === 0
    let rating: Rating = null
    if (thresholds && !empty && t.p75 !== null && Number.isFinite(t.p75)) {
      rating =
        t.p75 <= thresholds[0]
          ? { word: 'GOOD', lamp: 'green' }
          : t.p75 <= thresholds[1]
            ? { word: 'NEEDS WORK', lamp: 'amber' }
            : { word: 'POOR', lamp: 'red' }
    }
    return {
      ...t,
      label: t.label ?? d?.label ?? t.metric.toUpperCase(),
      unit,
      rating,
      thresholdText: thresholds ? `GOOD ≤ ${fv(thresholds[0], unit)} · POOR > ${fv(thresholds[1], unit)}` : 'NO THRESHOLD',
      p50t: empty ? '—' : fv(t.p50, unit),
      p75t: empty ? '—' : fv(t.p75, unit),
      p95t: empty ? '—' : fv(t.p95, unit),
    }
  }),
)
</script>

<template>
  <div class="pt">
    <div v-if="view.length === 0" class="pt__empty label">NO DATA</div>
    <div
      v-for="t in view"
      :key="t.metric"
      class="pt__tile"
      :data-testid="testid"
      :title="`${t.label} — ${t.thresholdText}${t.n ? ` · n=${fmt.num(t.n)}` : ''}`"
    >
      <div class="pt__head">
        <span class="label">{{ t.label }}</span>
        <span v-if="t.rating" class="pt__rating label">
          <StatusLamp :color="t.rating.lamp" :pulse="false" />
          {{ t.rating.word }}
        </span>
      </div>
      <div class="pt__p75">{{ t.p75t }}<span class="pt__p75-l label">P75</span></div>
      <div class="pt__row">
        <span class="pt__cell"><span class="label">P50</span> {{ t.p50t }}</span>
        <span class="pt__cell"><span class="label">P95</span> {{ t.p95t }}</span>
        <span v-if="t.n !== undefined" class="pt__cell"><span class="label">N</span> {{ fmt.num(t.n) }}</span>
      </div>
      <div class="pt__sub label">{{ t.sub ?? t.thresholdText }}</div>
    </div>
  </div>
</template>

<style scoped>
.pt {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: var(--space-2);
}

.pt__empty {
  color: var(--text-faint);
}

.pt__tile {
  min-width: 0;
  padding: var(--space-2) var(--space-3);
  background: var(--bg-1);
  border: 1px solid var(--hairline);
}

.pt__tile:hover {
  border-color: var(--hairline-lit);
}

.pt__head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}

.pt__rating {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text);
  white-space: nowrap;
}

.pt__p75 {
  margin-top: var(--space-1);
  font-size: 1.45rem;
  font-weight: 700;
  color: var(--text);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.pt__p75-l {
  margin-left: var(--space-2);
  color: var(--text-faint);
}

.pt__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin-top: 2px;
  font-size: var(--fs-data);
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

.pt__cell .label {
  color: var(--text-faint);
}

.pt__sub {
  margin-top: var(--space-1);
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
