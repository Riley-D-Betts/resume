<script setup lang="ts">
import type { CookbookEntry, SqlResult } from '#shared/analytics/ops'
import { COOKBOOK, renderCookbookSql } from '#shared/analytics/cookbook'
import { copyText, toCsv } from '~/utils/csv'

/**
 * Read-only SQL console over `/api/ops/sql` (contract §D.3). Ctrl/⌘+Enter
 * runs, Tab inserts two spaces, LIMIT defaults to 200 (max 1 000). COOKBOOK
 * presets come from `shared/analytics/cookbook.ts` (`${tzOffsetMin}` is
 * substituted with the owner's offset); SAVED queries live in
 * `localStorage.rbops_saved_sql`. Results render in a DataTable with COPY CSV.
 */
const props = withDefaults(defineProps<{ initialSql?: string; testid?: string }>(), { initialSql: '', testid: 'sql-console' })

const emit = defineEmits<{ ran: [result: SqlResult] }>()

interface SavedQuery {
  name: string
  sql: string
  savedAt: number
}

const STORAGE_KEY = 'rbops_saved_sql'
const fmt = useOpsFormat()

const cookbook: readonly CookbookEntry[] = COOKBOOK

const sql = ref(props.initialSql)
const limit = ref(200)
const editor = ref<HTMLTextAreaElement | null>(null)

const running = ref(false)
const result = ref<SqlResult | null>(null)
const errorText = ref<string | null>(null)
const history = ref<string[]>([])
const cookbookPick = ref('')
const cookbookNote = ref('')

let latest = 0

/** `${tzOffsetMin}` → the owner's current offset (contract E.4). */
function substitute(text: string): string {
  return renderCookbookSql(text, fmt.tzOffsetMin())
}

function pickCookbook(e: Event) {
  const i = Number((e.target as HTMLSelectElement).value)
  const entry = cookbook[i]
  cookbookPick.value = ''
  if (!entry) return
  sql.value = substitute(entry.sql)
  cookbookNote.value = entry.note ?? ''
  errorText.value = null
}

// -- saved queries ----------------------------------------------------
const saved = ref<SavedQuery[]>([])
const saveName = ref('')
const naming = ref(false)

function loadSaved() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    saved.value = Array.isArray(parsed)
      ? parsed.filter((q): q is SavedQuery => !!q && typeof q === 'object' && typeof (q as SavedQuery).name === 'string' && typeof (q as SavedQuery).sql === 'string')
      : []
  } catch {
    saved.value = []
  }
}

function persistSaved() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved.value))
  } catch {
    // storage unavailable — the list still lives for this page
  }
}

function save() {
  const name = saveName.value.trim() || `QUERY ${saved.value.length + 1}`
  const q = sql.value.trim()
  if (!q) return
  const rest = saved.value.filter(s => s.name !== name)
  saved.value = [{ name, sql: q, savedAt: Date.now() }, ...rest].slice(0, 50)
  persistSaved()
  saveName.value = ''
  naming.value = false
}

function load(s: SavedQuery) {
  sql.value = s.sql
  cookbookNote.value = ''
}

function remove(s: SavedQuery) {
  saved.value = saved.value.filter(x => x !== s)
  persistSaved()
}

onMounted(loadSaved)

// -- editor helpers ---------------------------------------------------
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    void run()
    return
  }
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    insert('  ')
  }
}

function insert(text: string) {
  const ta = editor.value
  if (!ta) {
    sql.value += text
    return
  }
  const s = ta.selectionStart ?? sql.value.length
  const e = ta.selectionEnd ?? s
  sql.value = sql.value.slice(0, s) + text + sql.value.slice(e)
  void nextTick(() => {
    ta.focus()
    ta.selectionStart = ta.selectionEnd = s + text.length
  })
}

function setSql(text: string) {
  sql.value = text
}

// -- run --------------------------------------------------------------
async function run(explain = false) {
  let q = sql.value.trim().replace(/;\s*$/, '')
  if (!q) return
  if (explain && !/^\s*explain\b/i.test(q)) q = `EXPLAIN QUERY PLAN ${q}`
  const lim = Math.max(1, Math.min(1000, Math.round(Number(limit.value) || 200)))
  limit.value = lim
  const seq = ++latest
  running.value = true
  errorText.value = null
  try {
    const res = await opsFetch<SqlResult>('/api/ops/sql', { method: 'POST', body: { sql: q, limit: lim }, headers: { 'x-rb-ops': '1' } })
    if (seq !== latest) return
    result.value = res
    history.value = [q, ...history.value.filter(h => h !== q)].slice(0, 20)
    emit('ran', res)
  } catch (err) {
    if (seq !== latest) return
    const e = err as { statusCode: number | null; message: string }
    const word = e.statusCode === 400 ? 'REJECTED' : 'FAILED'
    errorText.value = `${word} // ${e.message}`
  } finally {
    if (seq === latest) running.value = false
  }
}

const columns = computed(() =>
  (result.value?.columns ?? []).map((c, i) => ({ key: `c${i}`, label: c, ellipsis: true, format: (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v)) })),
)
const rows = computed(() =>
  (result.value?.rows ?? []).map(r => {
    const o: Record<string, unknown> = {}
    r.forEach((v, i) => (o[`c${i}`] = v))
    return o
  }),
)

const statusLine = computed(() => {
  const r = result.value
  if (!r) return ''
  const parts = [`${fmt.num(r.rowCount)} ROWS${r.truncated ? ' (TRUNCATED)' : ''}`, `${fmt.num(r.durationMs)} MS`]
  if (r.rowsRead !== null && r.rowsRead !== undefined) parts.push(`${fmt.num(r.rowsRead)} ROWS READ`)
  return parts.join(' · ')
})

const copied = ref(false)
async function copyCsv() {
  const r = result.value
  if (!r) return
  copied.value = await copyText(toCsv(r.columns, r.rows))
  setTimeout(() => (copied.value = false), 1500)
}

defineExpose({ insert, setSql, run })
</script>

<template>
  <div class="sq" :data-testid="testid">
    <div class="sq__bar">
      <label class="sq__field label">
        COOKBOOK
        <select :value="cookbookPick" class="sq__sel" data-testid="sql-cookbook" @change="pickCookbook">
          <option value="">— pick a preset —</option>
          <option v-for="(c, i) in cookbook" :key="c.title" :value="String(i)">{{ c.title }}</option>
        </select>
      </label>
      <label class="sq__field label">
        LIMIT
        <input v-model.number="limit" type="number" min="1" max="1000" class="sq__num" data-testid="sql-limit" />
      </label>
      <span class="sq__spacer" />
      <button type="button" class="sq__btn label" data-testid="sql-explain" :disabled="running" title="EXPLAIN QUERY PLAN (unwrapped, unbound)" @click="run(true)">EXPLAIN</button>
      <button type="button" class="sq__btn sq__btn--run label" data-testid="sql-run" :disabled="running" title="Ctrl/⌘ + Enter" @click="run()">
        {{ running ? 'RUNNING…' : 'RUN' }}
      </button>
    </div>

    <textarea
      ref="editor"
      v-model="sql"
      class="sq__editor"
      data-testid="sql-editor"
      spellcheck="false"
      rows="8"
      placeholder="SELECT as_org, COUNT(*) AS n FROM sessions WHERE is_bot = 0 GROUP BY 1 ORDER BY n DESC"
      aria-label="SQL"
      @keydown="onKeydown"
    />

    <div v-if="cookbookNote" class="sq__note label">{{ cookbookNote }}</div>

    <div class="sq__bar sq__bar--tools">
      <template v-if="naming">
        <input v-model="saveName" type="text" class="sq__name" placeholder="name" data-testid="sql-save-name" aria-label="Saved query name" @keydown.enter="save" @keydown.escape="naming = false" />
        <button type="button" class="sq__btn label" data-testid="sql-save" @click="save">SAVE</button>
        <button type="button" class="sq__btn label" @click="naming = false">CANCEL</button>
      </template>
      <button v-else type="button" class="sq__btn label" data-testid="sql-save" :disabled="!sql.trim()" @click="naming = true">SAVE</button>
      <details v-if="history.length" class="sq__hist">
        <summary class="label">HISTORY // {{ history.length }}</summary>
        <button v-for="h in history" :key="h" type="button" class="sq__hist-row" :title="h" @click="sql = h">{{ h.slice(0, 120) }}</button>
      </details>
      <span class="sq__spacer" />
      <details class="sq__help">
        <summary class="label">HELP</summary>
        <ul class="sq__help-list">
          <li>Read-only: one <code>SELECT</code> / <code>WITH</code> statement, wrapped in <code>LIMIT</code> (default 200, max 1 000). Comments are fine; <code>?</code> placeholders are not.</li>
          <li>Prefix <code>EXPLAIN QUERY PLAN</code> (or press EXPLAIN) to check indexes — runs unwrapped.</li>
          <li>D1 rejects <code>LIKE</code> patterns longer than 50 bytes — keep <code>%…%</code> terms short.</li>
          <li>Alias duplicate column names (<code>s.sid AS sid, n.sid AS net_sid</code>) — same-named columns collapse.</li>
          <li>The console gives up after 10 s but D1 keeps running a runaway query for up to 30 s — narrow with <code>started_at</code> / <code>ts</code> bounds.</li>
          <li>Cells longer than 500 chars and responses over 1 MB are truncated (see the NOTE line).</li>
        </ul>
      </details>
    </div>

    <div v-if="saved.length" class="sq__saved" data-testid="sql-saved">
      <span class="label sq__saved-h">SAVED</span>
      <span v-for="s in saved" :key="s.name" class="sq__saved-item">
        <button type="button" class="sq__saved-load" :title="s.sql" @click="load(s)">{{ s.name }}</button>
        <button type="button" class="sq__saved-x label" :aria-label="`delete ${s.name}`" @click="remove(s)">×</button>
      </span>
    </div>

    <div v-if="errorText" class="sq__error" data-testid="sql-error" role="alert">{{ errorText }}</div>

    <div v-if="result" class="sq__status label" data-testid="sql-status">
      <span>{{ statusLine }}</span>
      <span v-if="result.note" class="sq__status-note">NOTE // {{ result.note }}</span>
      <button type="button" class="sq__btn label" @click="copyCsv">{{ copied ? 'COPIED' : 'COPY CSV' }}</button>
    </div>

    <div v-if="result" class="sq__results" data-testid="sql-results">
      <DataTable :columns="columns" :rows="rows" :copy-csv="false" dense max-height="60vh" empty="0 ROWS" />
    </div>
  </div>
</template>

<style scoped>
.sq {
  min-width: 0;
  display: grid;
  gap: var(--space-2);
}

.sq__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.sq__spacer {
  flex: 1;
}

.sq__field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

.sq__sel,
.sq__num,
.sq__name {
  font: inherit;
  font-size: var(--fs-micro);
  color: var(--text);
  background: var(--bg-1);
  border: 1px solid var(--hairline);
  padding: 2px var(--space-2);
  color-scheme: dark;
  letter-spacing: 0;
  text-transform: none;
}

.sq__num {
  width: 5.5em;
  font-variant-numeric: tabular-nums;
}

.sq__name {
  width: 12em;
}

.sq__btn {
  padding: 2px var(--space-2);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
}

.sq__btn:hover:not(:disabled) {
  color: var(--teal-hot);
  border-color: var(--hairline-lit);
}

.sq__btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.sq__btn--run {
  color: var(--teal-hot);
  border-color: var(--teal);
}

.sq__editor {
  width: 100%;
  min-height: 9em;
  padding: var(--space-2);
  font: inherit;
  font-size: var(--fs-data);
  line-height: 1.5;
  color: var(--text);
  background: var(--bg-1);
  border: 1px solid var(--hairline);
  resize: vertical;
  tab-size: 2;
}

.sq__editor:focus {
  outline: none;
  border-color: var(--teal);
}

.sq__note {
  color: var(--text-dim);
  text-transform: none;
  letter-spacing: 0.04em;
}

.sq__hist summary,
.sq__help summary {
  cursor: pointer;
  color: var(--text-faint);
}

.sq__hist-row {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  color: var(--text-dim);
  font-size: var(--fs-micro);
}

.sq__hist-row:hover {
  color: var(--teal-hot);
}

.sq__help-list {
  margin-top: var(--space-1);
  padding-left: 1.2em;
  color: var(--text-dim);
  font-size: var(--fs-micro);
  max-width: 60em;
}

.sq__help-list code {
  color: var(--text);
}

.sq__saved {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.sq__saved-h {
  color: var(--text-faint);
}

.sq__saved-item {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--hairline);
}

.sq__saved-load {
  padding: 1px var(--space-2);
  color: var(--text);
  font-size: var(--fs-micro);
}

.sq__saved-load:hover {
  color: var(--teal-hot);
}

.sq__saved-x {
  padding: 1px var(--space-1);
  color: var(--text-faint);
}

.sq__saved-x:hover {
  color: var(--red);
}

.sq__error {
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--red);
  color: var(--red);
  font-size: var(--fs-data);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.sq__status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}

.sq__status-note {
  color: var(--amber);
}

.sq__results {
  min-width: 0;
}
</style>
