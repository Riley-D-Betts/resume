<script setup lang="ts">
import type { eventWithTime } from '@rrweb/types'

export interface ReplaySegment {
  /** per-document-load recording id (audit A0) */
  rid: string
  /** page_started_at, epoch ms */
  startedAt: number
  events: eventWithTime[]
}

/**
 * rrweb replay for one session. A session is a list of SEGMENTS (one per
 * document load, ordered by start time — audit A0); the picker chooses a
 * segment and one rrweb-player mounts for it (`.rr-player` inside the
 * wrapper). Pass `segments` directly or `sid` to fetch
 * `/api/ops/replay/<sid>` (tolerates the legacy flat event array).
 */
const props = withDefaults(defineProps<{ sid?: string; segments?: ReplaySegment[] | null }>(), { sid: undefined, segments: null })

const fmt = useOpsFormat()
const root = ref<HTMLDivElement | null>(null)
const host = ref<HTMLDivElement | null>(null)
/** true whenever the player is filling the screen, by either mechanism */
const full = ref(false)
/**
 * iOS Safari on iPhone implements the Fullscreen API on <video> only: a <div>
 * has no requestFullscreen at all, so rrweb-player's own button is a silent
 * no-op there. When the real API is missing (or refuses), we fill the viewport
 * with a fixed overlay instead, which behaves the same to a reader.
 */
const overlay = ref(false)
const state = ref<'loading' | 'ready' | 'empty' | 'error'>('loading')
// shallowRef: rrweb's event union is huge and never needs deep reactivity
const segs = shallowRef<ReplaySegment[]>([])
const selected = ref(0)

// rrweb-player v2 is a Svelte 4 component class: new Player({ target, props })
type PlayerInstance = {
  $destroy: () => void
  $set: (props: Record<string, unknown>) => void
  triggerResize: () => void
}
let player: PlayerInstance | null = null
let PlayerCtor: (new (opts: { target: Element; props: Record<string, unknown> }) => unknown) | null = null

function isEvent(v: unknown): v is eventWithTime {
  return !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'number' && typeof (v as { timestamp?: unknown }).timestamp === 'number'
}

/** Accepts `ReplaySegment[]`, `{ segments }`, or a flat `eventWithTime[]`. */
function normalise(raw: unknown): ReplaySegment[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { segments?: unknown }).segments) ? (raw as { segments: unknown[] }).segments : []
  if (list.length === 0) return []
  if (isEvent(list[0])) {
    const events = (list as unknown[]).filter(isEvent)
    return events.length ? [{ rid: 'legacy', startedAt: events[0]!.timestamp, events }] : []
  }
  return (list as unknown[])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && Array.isArray((s as { events?: unknown }).events))
    .map((s, i) => {
      const events = (s.events as unknown[]).filter(isEvent)
      const startedAt = typeof s.startedAt === 'number' ? s.startedAt : typeof s.page_started_at === 'number' ? s.page_started_at : events[0]?.timestamp ?? 0
      return { rid: typeof s.rid === 'string' ? s.rid : `seg-${i + 1}`, startedAt, events }
    })
    .sort((a, b) => a.startedAt - b.startedAt)
}

function playable(s: ReplaySegment): boolean {
  // rrweb needs a full snapshot + at least one more event to play anything
  return s.events.length >= 2
}

function destroy() {
  player?.$destroy()
  player = null
  if (host.value) host.value.innerHTML = ''
}

async function mount() {
  const seg = segs.value[selected.value]
  const el = host.value
  if (!seg || !el || !PlayerCtor) return
  destroy()
  if (!playable(seg)) return
  const width = Math.max(320, Math.floor(el.clientWidth || 480))
  player = new PlayerCtor({
    target: el,
    props: {
      events: seg.events,
      autoPlay: false,
      skipInactive: true,
      width,
      height: Math.round(width * 0.62),
    },
  }) as PlayerInstance
}

/** The box the player should occupy right now, in CSS pixels. */
function box(): { width: number; height: number } {
  const el = host.value
  const width = Math.max(320, Math.floor(el?.clientWidth || 480))
  if (!full.value) return { width, height: Math.round(width * 0.62) }
  // Filling the screen: hand the player the whole measured box and let rrweb
  // scale the recording inside it (it fits on the tighter of the two axes).
  return { width, height: Math.max(240, Math.floor(el?.clientHeight || Math.round(width * 0.62))) }
}

/** Resize in place. `$set` moves the box, `triggerResize` rescales the frame. */
function fit() {
  if (!player) return
  const { width, height } = box()
  player.$set({ width, height })
  player.triggerResize()
}

let fitFrame = 0
function refit() {
  cancelAnimationFrame(fitFrame)
  // two frames: one for the class/fullscreen paint, one to measure it
  fitFrame = requestAnimationFrame(() => { fitFrame = requestAnimationFrame(fit) })
}

function nativeFullscreen(el: HTMLElement): (() => Promise<unknown>) | null {
  const req = el.requestFullscreen ?? (el as { webkitRequestFullscreen?: () => Promise<unknown> }).webkitRequestFullscreen
  return typeof req === 'function' ? () => req.call(el) : null
}

function nativeElement(): Element | null {
  return document.fullscreenElement ?? (document as { webkitFullscreenElement?: Element | null }).webkitFullscreenElement ?? null
}

async function enterFull() {
  const el = root.value
  if (!el) return
  const req = nativeFullscreen(el)
  if (req) {
    try {
      await req()
      return // fullscreenchange sets the state
    } catch {
      // Safari on iPad can reject; fall through to the overlay
    }
  }
  overlay.value = true
  full.value = true
  document.body.style.overflow = 'hidden'
  refit()
}

async function exitFull() {
  if (nativeElement()) {
    try {
      await (document.exitFullscreen?.() ?? (document as { webkitExitFullscreen?: () => Promise<unknown> }).webkitExitFullscreen?.())
    } catch {
      // ignore: the change handler still reconciles below
    }
  }
  if (overlay.value) {
    overlay.value = false
    full.value = false
    document.body.style.removeProperty('overflow')
    refit()
  }
}

function toggleFull() {
  void (full.value ? exitFull() : enterFull())
}

function onFullscreenChange() {
  if (overlay.value) return
  full.value = nativeElement() === root.value
  refit()
}

function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape' && overlay.value) void exitFull()
}

async function load() {
  try {
    let raw: unknown = props.segments
    if (!raw && props.sid) raw = await opsFetch<unknown>(`/api/ops/replay/${encodeURIComponent(props.sid)}`)
    segs.value = normalise(raw)
    if (segs.value.length === 0 || !segs.value.some(playable)) {
      state.value = 'empty'
      return
    }
    selected.value = Math.max(0, segs.value.findIndex(playable))

    const [{ default: Player }] = await Promise.all([import('rrweb-player'), import('rrweb-player/dist/style.css')])
    PlayerCtor = Player as unknown as typeof PlayerCtor

    state.value = 'ready'
    await nextTick()
    await mount()
  } catch (err) {
    // opsFetch already redirected on 401; a 404 is simply "nothing recorded"
    const statusCode = (err as { statusCode?: number | null } | null)?.statusCode
    state.value = statusCode === 404 ? 'empty' : 'error'
  }
}

onMounted(() => {
  void load()
  document.addEventListener('fullscreenchange', onFullscreenChange)
  document.addEventListener('webkitfullscreenchange', onFullscreenChange)
  window.addEventListener('resize', refit)
  window.addEventListener('orientationchange', refit)
  document.addEventListener('keydown', onKey)
})
watch(() => props.segments, () => void load())

async function pick(i: number) {
  if (i === selected.value) return
  selected.value = i
  await nextTick()
  await mount()
}

onBeforeUnmount(() => {
  cancelAnimationFrame(fitFrame)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', onFullscreenChange)
  window.removeEventListener('resize', refit)
  window.removeEventListener('orientationchange', refit)
  document.removeEventListener('keydown', onKey)
  if (overlay.value) document.body.style.removeProperty('overflow')
  destroy()
})

function segLabel(s: ReplaySegment, i: number): string {
  return `SEGMENT ${i + 1} / ${segs.value.length} · ${fmt.time(s.startedAt)}`
}
</script>

<template>
  <div ref="root" class="replay" :class="{ 'replay--full': full, 'replay--overlay': overlay }" data-testid="replay-player">
    <div v-if="state === 'loading'" class="replay__msg label">... POLLING</div>
    <div v-else-if="state === 'empty'" class="replay__msg label">NO REPLAY CAPTURED</div>
    <div v-else-if="state === 'error'" class="replay__msg replay__msg--err label">REPLAY LINK FAULT</div>
    <div v-if="state === 'ready' && segs.length > 1" class="replay__segs" role="group" aria-label="Replay segments">
      <button
        v-for="(s, i) in segs"
        :key="s.rid"
        type="button"
        class="replay__seg label"
        :class="{ 'replay__seg--on': i === selected }"
        :aria-pressed="i === selected"
        :disabled="!playable(s)"
        :title="`rid ${s.rid} · ${s.events.length} events${playable(s) ? '' : ' · not playable'}`"
        data-testid="replay-segment"
        @click="pick(i)"
      >
        {{ segLabel(s, i) }}
      </button>
    </div>
    <div v-if="state === 'ready' && segs[selected]" class="replay__bar">
      <div class="replay__meta label">
        {{ fmt.full(segs[selected]!.startedAt) }} · {{ segs[selected]!.events.length }} EVENTS · RID {{ segs[selected]!.rid.slice(0, 8) }}
      </div>
      <button type="button" class="replay__full label" data-testid="replay-fullscreen" :aria-pressed="full" @click="toggleFull">
        {{ full ? 'EXIT FULL SCREEN' : 'FULL SCREEN' }}
      </button>
    </div>
    <div ref="host" class="replay__host" />
  </div>
</template>

<style scoped>
.replay {
  min-width: 0;
}

.replay__msg {
  padding: var(--space-4) 0;
  text-align: center;
  color: var(--text-faint);
}

.replay__msg--err {
  color: var(--red);
}

.replay__segs {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: var(--space-2);
}

.replay__seg {
  padding: 2px var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.replay__seg:hover:not(:disabled) {
  color: var(--teal-hot);
  border-color: var(--hairline-lit);
}

.replay__seg--on {
  color: var(--teal-hot);
  border-color: var(--teal);
  background: var(--bg-teal);
}

.replay__seg:disabled {
  opacity: 0.5;
  cursor: default;
}

.replay__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.replay__meta {
  min-width: 0;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.replay__full {
  flex: none;
  padding: 2px var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
}

.replay__full:hover {
  color: var(--teal-hot);
  border-color: var(--hairline-lit);
}

/*
 * Filling the screen. `.replay--overlay` is the fallback for browsers with no
 * element Fullscreen API (iPhone Safari); `:fullscreen` covers the real thing.
 * Both give the host a measured box that `fit()` hands to the player.
 */
.replay--overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  padding: var(--space-2);
  padding-bottom: max(var(--space-2), env(safe-area-inset-bottom));
  background: var(--bg-0);
}

.replay--full,
.replay:fullscreen {
  display: flex;
  flex-direction: column;
  background: var(--bg-0);
}

.replay:fullscreen {
  padding: var(--space-2);
}

.replay--full .replay__host {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.replay__host {
  min-width: 0;
  overflow: hidden;
}

/* fold the stock (light) player chrome into the console skin */
.replay__host :deep(.rr-player) {
  background: var(--bg-2);
  border: 1px solid var(--hairline);
  border-radius: 0;
  box-shadow: none;
  float: none;
}

.replay__host :deep(.rr-controller) {
  background: var(--bg-1);
  color: var(--text);
  border-radius: 0;
}

.replay__host :deep(.rr-timeline__time) {
  color: var(--text-dim);
}

.replay__host :deep(.rr-progress__step) {
  background: var(--teal);
}

.replay__host :deep(.rr-progress__handler) {
  background: var(--teal-hot);
}

.replay__host :deep(.switch input[type='checkbox']:checked + label:before) {
  background: var(--teal);
}

/*
 * The stock player's own fullscreen button calls requestFullscreen on a div,
 * which iPhone Safari does not implement, so it silently does nothing there.
 * Hide it and use the control above, which has a working fallback.
 */
.replay__host :deep(.rr-controller__btns button:last-of-type) {
  display: none;
}
</style>
