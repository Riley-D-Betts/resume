<script setup lang="ts">
import { resume } from '~/data/resume'
import { useTrack } from '~/composables/useTrack'

/**
 * The Cycle Count portlet — a whack-a-mole wearing a Bettsuite costume.
 *
 * Idle, it reads like any other inventory portlet: a count id, nine
 * bins, sane quantities. Press Start and bins begin reporting phantom
 * quantities (the résumé's "billions of units that were not there");
 * click each one before it times out. Twenty seconds, ramping speed,
 * and a best score remembered per browser. Copy lives in resume.ts.
 */
const copy = resume.eggs.cycleCount
const track = useTrack()
const toast = useToast()

const DURATION_MS = 20_000
const TICK_MS = 50
const BIN_COUNT = 9
const MAX_OPEN = 3
const FLASH_MS = 450
const BEST_KEY = 'rb_cc_best'

type Phase = 'idle' | 'running' | 'done'

interface Bin {
  code: string
  item: string
  onHand: number
  /** the phantom quantity currently reported, or null when the bin is sane */
  variance: number | null
  /** ms timestamp when an open variance is written off as missed */
  expiresAt: number
  /** ms timestamp until which the "Counted" flash shows */
  flashUntil: number
}

const phase = ref<Phase>('idle')
const bins = ref<Bin[]>(makeBins())
const timeLeft = ref(DURATION_MS)
const reconciled = ref(0)
const missed = ref(0)
const phantom = ref(0)
const best = ref<number | null>(null)
const now = ref(0)

let timer: number | undefined
let startedAt = 0
let nextSpawnAt = 0
let lastSpawned = -1

// ---- setup -----------------------------------------------------------

/**
 * Deal items onto A-01 … C-03 with plausible on-hand quantities. The idle
 * deal is deterministic so the server and the client render the same
 * portlet (no hydration mismatch); a count starting reshuffles.
 */
function makeBins(shuffle = false): Bin[] {
  const items = [...copy.items]
  const out: Bin[] = []
  for (let i = 0; i < BIN_COUNT; i++) {
    const code = `${String.fromCharCode(65 + Math.floor(i / 3))}-0${(i % 3) + 1}`
    const pick = shuffle ? Math.floor(Math.random() * items.length) : 0
    const item = items.length ? items.splice(pick, 1)[0]! : `Item ${i + 1}`
    const onHand = shuffle ? 40 + Math.floor(Math.random() * 960) : 120 + ((i * 137) % 800)
    out.push({ code, item, onHand, variance: null, expiresAt: 0, flashUntil: 0 })
  }
  return out
}

/** A phantom quantity: millions to billions, with the occasional int32 ceiling. */
function phantomQty(): number {
  if (Math.random() < 0.12) return 2_147_483_647
  const magnitude = 6 + Math.floor(Math.random() * 4) // 1e6 … 1e9
  return Math.floor((1 + Math.random() * 9) * 10 ** magnitude)
}

/** Linear ramp from `from` at t=0 to `to` at t=1. */
function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * Math.max(0, Math.min(1, t))
}

// ---- game loop -------------------------------------------------------

function start(): void {
  if (phase.value === 'running') return
  stopTimer()
  bins.value = makeBins(true)
  reconciled.value = 0
  missed.value = 0
  phantom.value = 0
  timeLeft.value = DURATION_MS
  startedAt = Date.now()
  now.value = startedAt
  nextSpawnAt = startedAt + 500
  lastSpawned = -1
  phase.value = 'running'
  track('easter_egg', 'cyclecount')
  timer = window.setInterval(tick, TICK_MS)
}

function tick(): void {
  const t = Date.now()
  now.value = t
  const elapsed = t - startedAt
  timeLeft.value = Math.max(0, DURATION_MS - elapsed)
  const progress = elapsed / DURATION_MS

  // expire open variances → missed, written off as phantom units
  for (const b of bins.value) {
    if (b.variance !== null && t >= b.expiresAt) {
      phantom.value += b.variance
      missed.value++
      b.variance = null
    }
  }

  // spawn a new variance on a sane bin, faster as the count goes on
  if (t >= nextSpawnAt) {
    const open = bins.value.filter((b) => b.variance !== null).length
    if (open < MAX_OPEN) {
      const candidates = bins.value
        .map((b, i) => ({ b, i }))
        .filter(({ b, i }) => b.variance === null && i !== lastSpawned && b.flashUntil <= t)
      if (candidates.length) {
        const { b, i } = candidates[Math.floor(Math.random() * candidates.length)]!
        b.variance = phantomQty()
        b.expiresAt = t + lerp(1600, 900, progress)
        lastSpawned = i
      }
    }
    nextSpawnAt = t + lerp(850, 420, progress)
  }

  if (timeLeft.value <= 0) finish()
}

function count(i: number): void {
  if (phase.value !== 'running') {
    start()
    return
  }
  const b = bins.value[i]
  if (!b || b.variance === null) return
  b.variance = null
  b.flashUntil = Date.now() + FLASH_MS
  reconciled.value++
}

function finish(): void {
  stopTimer()
  // whatever is still open at the buzzer is missed too
  for (const b of bins.value) {
    if (b.variance !== null) {
      phantom.value += b.variance
      missed.value++
      b.variance = null
    }
  }
  phase.value = 'done'
  if (best.value === null || reconciled.value > best.value) {
    best.value = reconciled.value
    try {
      localStorage.setItem(BEST_KEY, String(best.value))
    } catch {
      /* private mode, blocked storage — the score just isn't remembered */
    }
  }
  if (missed.value === 0 && reconciled.value > 0) toast.show(copy.toast)
}

function stopTimer(): void {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}

// number keys 1–9 count the matching bin while the count runs
function onKey(e: KeyboardEvent): void {
  if (phase.value !== 'running') return
  const target = e.target as HTMLElement | null
  if (target && /^(input|textarea|select)$/i.test(target.tagName)) return
  const n = Number(e.key)
  if (Number.isInteger(n) && n >= 1 && n <= BIN_COUNT) {
    e.preventDefault()
    count(n - 1)
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  try {
    const raw = localStorage.getItem(BEST_KEY)
    if (raw !== null && /^\d+$/.test(raw)) best.value = Number(raw)
  } catch {
    /* storage unavailable — no best score */
  }
})
onBeforeUnmount(() => {
  stopTimer()
  window.removeEventListener('keydown', onKey)
})

// ---- presentation ----------------------------------------------------

const fmt = (n: number): string => n.toLocaleString('en-US')

const statusLabel = computed(() => copy.status[phase.value])

const message = computed(() => {
  if (phase.value === 'idle') return copy.idle
  if (phase.value === 'running') return copy.hint
  const tpl = missed.value === 0 && reconciled.value > 0 ? copy.perfect : copy.done
  return tpl
    .replace('{reconciled}', String(reconciled.value))
    .replace('{missed}', String(missed.value))
    .replace('{phantom}', fmt(phantom.value))
})

function qtyLabel(b: Bin): string {
  if (b.variance !== null) return fmt(b.variance)
  if (b.flashUntil > now.value) return 'Counted ✓'
  return fmt(b.onHand)
}

function binLabel(b: Bin, i: number): string {
  const state = b.variance !== null ? `variance ${fmt(b.variance)}` : `on hand ${fmt(b.onHand)}`
  return `Bin ${b.code}, ${b.item}, ${state} (key ${i + 1})`
}
</script>

<template>
  <div class="ns-cc" :data-phase="phase">
    <div class="ns-cc__bar">
      <span class="ns-cc__id">
        <b>{{ copy.countId }}</b> · {{ statusLabel }}
      </span>
      <span v-if="phase === 'running'" class="ns-cc__time" aria-live="off">{{ (timeLeft / 1000).toFixed(1) }}s</span>
    </div>

    <div class="ns-cc__stats" aria-live="polite">
      <span class="ns-cc__stat">
        <span class="ns-cc__statlabel">Phantom Units</span>
        <b :class="{ 'ns-cc__bad': phantom > 0 }">{{ fmt(phantom) }}</b>
      </span>
      <span class="ns-cc__stat">
        <span class="ns-cc__statlabel">Reconciled</span>
        <b>{{ reconciled }}</b>
      </span>
      <span class="ns-cc__stat">
        <span class="ns-cc__statlabel">Missed</span>
        <b :class="{ 'ns-cc__bad': missed > 0 }">{{ missed }}</b>
      </span>
    </div>

    <div class="ns-cc__grid" role="group" aria-label="Bins">
      <button
        v-for="(b, i) in bins"
        :key="b.code"
        type="button"
        class="ns-cc__bin"
        :class="{ 'ns-cc__bin--var': b.variance !== null, 'ns-cc__bin--ok': b.variance === null && b.flashUntil > now }"
        :aria-label="binLabel(b, i)"
        @click="count(i)"
      >
        <span class="ns-cc__code">{{ b.code }}</span>
        <span class="ns-cc__item">{{ b.item }}</span>
        <span class="ns-cc__qty">{{ qtyLabel(b) }}</span>
      </button>
    </div>

    <p class="ns-cc__msg">{{ message }}</p>

    <div class="ns-cc__actions">
      <button type="button" class="ns-btn ns-btn--primary" :disabled="phase === 'running'" @click="start">
        {{ phase === 'done' ? copy.again : copy.start }}
      </button>
      <span v-if="best !== null" class="ns-cc__best">Best: {{ best }} reconciled</span>
    </div>
  </div>
</template>
