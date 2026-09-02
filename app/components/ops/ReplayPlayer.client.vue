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
const host = ref<HTMLDivElement | null>(null)
const state = ref<'loading' | 'ready' | 'empty' | 'error'>('loading')
// shallowRef: rrweb's event union is huge and never needs deep reactivity
const segs = shallowRef<ReplaySegment[]>([])
const selected = ref(0)

// rrweb-player v2 is a Svelte 4 component class: new Player({ target, props })
let player: { $destroy: () => void } | null = null
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
  }) as { $destroy: () => void }
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

onMounted(load)
watch(() => props.segments, () => void load())

async function pick(i: number) {
  if (i === selected.value) return
  selected.value = i
  await nextTick()
  await mount()
}

onBeforeUnmount(destroy)

function segLabel(s: ReplaySegment, i: number): string {
  return `SEGMENT ${i + 1} / ${segs.value.length} · ${fmt.time(s.startedAt)}`
}
</script>

<template>
  <div class="replay" data-testid="replay-player">
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
    <div v-if="state === 'ready' && segs[selected]" class="replay__meta label">
      {{ fmt.full(segs[selected]!.startedAt) }} · {{ segs[selected]!.events.length }} EVENTS · RID {{ segs[selected]!.rid.slice(0, 8) }}
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

.replay__meta {
  margin-bottom: var(--space-2);
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
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
</style>
