<script setup lang="ts">
import type { PageVisitRow } from '#shared/analytics/ops'

type Visit = Partial<PageVisitRow> & { path: string; entered_at: number }

/**
 * The pages of one session in order: +offset from session start, path, nav
 * kind, ACTIVE / HIDDEN bars (two categories → two fixed hues + legend),
 * scroll %, sections seen, clicks, leave reason.
 */
const props = withDefaults(
  defineProps<{
    pages: Visit[]
    /** session started_at; defaults to the first visit's entered_at */
    startTs?: number
    /** drill-down for a path (e.g. `/ops/pages/detail?path=…`) */
    pathTo?: (path: string) => string | null | undefined
    testid?: string
  }>(),
  { startTs: undefined, pathTo: undefined, testid: 'path-timeline' },
)

const fmt = useOpsFormat()

const sorted = computed(() => [...props.pages].sort((a, b) => a.entered_at - b.entered_at))
const start = computed(() => props.startTs ?? sorted.value[0]?.entered_at ?? 0)
const maxSpan = computed(() => Math.max(1, ...sorted.value.map(p => (p.active_ms ?? 0) + (p.hidden_ms ?? 0))))

function offset(ts: number): string {
  const d = Math.max(0, ts - start.value)
  return `+${fmt.mmss(d)}`
}

function pct(v: number): number {
  return Math.max(0, Math.min(100, (v / maxSpan.value) * 100))
}

function leave(p: Visit): string {
  if (p.leave_reason) return p.leave_reason.toUpperCase()
  return p.left_at ? 'LEFT' : 'OPEN'
}

const hover = ref<number | null>(null)

function tip(p: Visit): string {
  return `${p.path} · active ${fmt.mmss(p.active_ms ?? 0)} · hidden ${fmt.mmss(p.hidden_ms ?? 0)}${p.soft_nav_ms ? ` · soft nav ${fmt.ms(p.soft_nav_ms)}` : ''}`
}
</script>

<template>
  <div class="ptl" :data-testid="testid">
    <div v-if="sorted.length === 0" class="ptl__empty label">NO PAGE VISITS RECORDED</div>
    <template v-else>
      <div class="ptl__legend label">
        <span class="ptl__legend-item"><span class="ptl__sw ptl__sw--active" aria-hidden="true" /> ACTIVE</span>
        <span class="ptl__legend-item"><span class="ptl__sw ptl__sw--hidden" aria-hidden="true" /> HIDDEN</span>
        <span class="ptl__legend-note">Σ ACTIVE = THE SESSION'S ACTIVE TIME</span>
      </div>
      <div
        v-for="(p, i) in sorted"
        :key="p.pvid ?? `${p.path}-${p.entered_at}`"
        class="ptl__row"
        @pointerenter="hover = i"
        @pointerleave="hover = null"
      >
        <span class="ptl__t">{{ offset(p.entered_at) }}</span>
        <span class="ptl__path">
          <NuxtLink v-if="pathTo?.(p.path)" :to="pathTo(p.path) as string">{{ p.path }}</NuxtLink>
          <template v-else>{{ p.path }}</template>
          <span v-if="p.nav_kind" class="ptl__kind label">{{ p.nav_kind }}</span>
        </span>
        <span class="ptl__bars" :title="tip(p)">
          <span class="ptl__bar ptl__bar--active" :style="{ width: `${pct(p.active_ms ?? 0)}%` }" />
          <span class="ptl__bar ptl__bar--hidden" :style="{ width: `${pct(p.hidden_ms ?? 0)}%` }" />
          <span v-if="hover === i" class="ptl__tip" data-testid="chart-tooltip">{{ tip(p) }}</span>
        </span>
        <span class="ptl__n" :title="`active ${fmt.mmss(p.active_ms ?? 0)} · hidden ${fmt.mmss(p.hidden_ms ?? 0)}`">{{ fmt.mmss(p.active_ms ?? 0) }}</span>
        <span class="ptl__meta label">
          <span :title="'max scroll'">{{ p.max_scroll_pct ?? 0 }}%</span>
          <span :title="'sections seen'">§{{ p.sections_seen ?? 0 }}</span>
          <span :title="'clicks'">{{ p.clicks ?? 0 }}×</span>
          <span :title="'leave reason'">{{ leave(p) }}</span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ptl {
  min-width: 0;
  font-size: var(--fs-data);
  font-variant-numeric: tabular-nums;
}

.ptl__empty {
  padding: var(--space-2) 0;
  color: var(--text-faint);
}

.ptl__legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
  color: var(--text-dim);
}

.ptl__legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.ptl__legend-note {
  color: var(--text-faint);
}

.ptl__sw {
  display: inline-block;
  width: 10px;
  height: 6px;
}

.ptl__sw--active,
.ptl__bar--active {
  background: var(--series-1);
}

.ptl__sw--hidden,
.ptl__bar--hidden {
  background: var(--series-2);
}

.ptl__row {
  display: grid;
  grid-template-columns: 5em minmax(8em, 1.2fr) minmax(80px, 2fr) 4em minmax(10em, auto);
  align-items: center;
  gap: var(--space-2);
  padding: 3px 0;
  border-bottom: 1px solid var(--hairline);
}

.ptl__t {
  color: var(--text-dim);
}

.ptl__path {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text);
}

.ptl__kind {
  color: var(--text-faint);
}

.ptl__bars {
  position: relative;
  display: flex;
  gap: 2px;
  height: 8px;
  background: var(--bg-2);
}

.ptl__bar {
  display: block;
  height: 100%;
}

.ptl__tip {
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

.ptl__n {
  color: var(--text);
  text-align: right;
}

.ptl__meta {
  display: flex;
  gap: var(--space-2);
  color: var(--text-faint);
  white-space: nowrap;
}

@media (max-width: 720px) {
  .ptl__row {
    grid-template-columns: 5em minmax(6em, 1fr) minmax(60px, 1.5fr) 4em;
  }

  .ptl__meta {
    display: none;
  }
}
</style>
