<script setup lang="ts">
import type { ExportEntity, ExportFormat } from '#shared/analytics/ops'

/**
 * Client-driven export (contract D15): loops `fetch()` over `after` cursors
 * read from `x-rb-next`, concatenates the pages (CSV header once), builds a
 * Blob + object URL and hands it to the browser. Progress
 * `EXPORTING // 3 000 ROWS…` → `DONE // n ROWS`; stops at 200 000 rows with
 * `CAPPED // 200 000 ROWS`.
 */
const props = withDefaults(
  defineProps<{
    entity: ExportEntity
    format?: ExportFormat
    /** Filters (`useOpsFilters().query`); defaults to the shared filter state. */
    query?: Record<string, unknown> | null
    label?: string
    cap?: number
    testid?: string
  }>(),
  { format: 'csv', query: null, label: undefined, cap: 200_000, testid: 'export-link' },
)

const filters = useOpsFilters()

type State = 'idle' | 'running' | 'done' | 'capped' | 'error'
const state = ref<State>('idle')
const rows = ref(0)
const message = ref('')
const href = ref<string | null>(null)
const filename = ref('')
let controller: AbortController | null = null

/** `200 000` — space-grouped, as the contract spells it. */
function grp(n: number): string {
  return n.toLocaleString('en-US').replace(/,/g, ' ')
}

const text = computed(() => {
  switch (state.value) {
    case 'running':
      return `EXPORTING // ${grp(rows.value)} ROWS…`
    case 'done':
      return `DONE // ${grp(rows.value)} ROWS`
    case 'capped':
      return `CAPPED // ${grp(rows.value)} ROWS`
    case 'error':
      return message.value
    default:
      return props.label ?? `EXPORT ${props.format.toUpperCase()} // ${props.entity.toUpperCase()}`
  }
})

function revoke() {
  if (href.value && typeof URL !== 'undefined') URL.revokeObjectURL(href.value)
  href.value = null
}

onBeforeUnmount(() => {
  controller?.abort()
  revoke()
})

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/)
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

async function run() {
  if (state.value === 'running') {
    controller?.abort()
    state.value = 'idle'
    return
  }
  revoke()
  state.value = 'running'
  rows.value = 0
  message.value = ''
  controller = new AbortController()

  const base: Record<string, string> = {}
  const src = props.query ?? filters.query.value
  for (const [k, v] of Object.entries(src)) if (v !== undefined && v !== null && v !== '') base[k] = String(v)
  base.entity = props.entity
  base.format = props.format

  let header: string | null = null
  const body: string[] = []
  let after = ''
  let capped = false
  let cd = ''

  try {
    for (;;) {
      const qs = new URLSearchParams({ ...base, ...(after ? { after } : {}) }).toString()
      const res = await fetch(`/api/ops/export?${qs}`, { signal: controller.signal, headers: { 'x-rb-ops': '1' }, credentials: 'same-origin' })
      if (res.status === 401) {
        redirectToLogin()
        state.value = 'idle'
        return
      }
      if (!res.ok) {
        state.value = 'error'
        message.value = `FAULT // ${res.status} EXPORT`
        return
      }
      if (!cd) cd = res.headers.get('content-disposition') ?? ''
      const lines = splitLines(await res.text())
      let pageRows: string[]
      if (props.format === 'csv') {
        if (header === null) header = lines[0] ?? ''
        pageRows = lines.slice(1)
      } else pageRows = lines
      const declared = Number(res.headers.get('x-rb-rows') ?? '')
      const n = Number.isFinite(declared) && declared >= 0 && res.headers.has('x-rb-rows') ? declared : pageRows.length
      const room = props.cap - rows.value
      if (pageRows.length > room) {
        body.push(...pageRows.slice(0, room))
        rows.value = props.cap
        capped = true
        break
      }
      body.push(...pageRows)
      rows.value += Math.min(n, pageRows.length) || pageRows.length
      if (rows.value >= props.cap) {
        rows.value = props.cap
        capped = true
        break
      }
      const next = res.headers.get('x-rb-next')
      if (!next || pageRows.length === 0) break
      after = next
    }
  } catch (err) {
    if ((err as { name?: string } | null)?.name === 'AbortError') {
      state.value = 'idle'
      return
    }
    state.value = 'error'
    message.value = 'FAULT // EXPORT'
    return
  }

  const eol = props.format === 'csv' ? '\r\n' : '\n'
  const content = props.format === 'csv' ? [header ?? '', ...body].join(eol) : body.join(eol)
  const type = props.format === 'csv' ? 'text/csv;charset=utf-8' : 'application/x-ndjson;charset=utf-8'
  const blob = new Blob([content], { type })
  href.value = URL.createObjectURL(blob)
  const m = /filename="?([^";]+)"?/.exec(cd)
  filename.value = m?.[1] ?? `rb-${props.entity}-${filters.state.value.range}.${props.format === 'csv' ? 'csv' : 'ndjson'}`
  state.value = capped ? 'capped' : 'done'

  // hand the file to the browser
  await nextTick()
  const a = document.createElement('a')
  a.href = href.value
  a.download = filename.value
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}
</script>

<template>
  <span class="ex">
    <button type="button" class="ex__btn label" :class="{ 'ex__btn--busy': state === 'running', 'ex__btn--err': state === 'error' }" :data-testid="testid" :aria-busy="state === 'running'" @click="run">
      {{ text }}
    </button>
    <a v-if="href" :href="href" :download="filename" class="ex__link label" data-testid="export-file">↓ {{ filename }}</a>
  </span>
</template>

<style scoped>
.ex {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.ex__btn {
  padding: 2px var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.ex__btn:hover {
  color: var(--teal-hot);
  border-color: var(--hairline-lit);
}

.ex__btn--busy {
  color: var(--amber);
}

.ex__btn--err {
  color: var(--red);
}

.ex__link {
  color: var(--teal-hot);
}
</style>
