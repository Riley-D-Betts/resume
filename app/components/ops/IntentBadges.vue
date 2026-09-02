<script setup lang="ts">
import type { IntentFlag } from '#shared/analytics/events'

/**
 * Word chips for a session's intent signals (glyph + word in `--text`; the
 * glyph is decorative). Fixed order:
 * PRINT COPY EMAIL FORM MAIL FIND SEARCH EXIT RAGE DEAD ERR EGG REPLAY AUTO TOR
 * Pass `flags` (the API's IntentFlag[]) and/or a `session` row — the counters
 * on the row are folded in (`email` = email_copies OR mailto_clicks,
 * `submit` → MAIL = form_submitted OR mailto_clicks).
 */
type Badge = 'print' | 'copy' | 'email' | 'form' | 'submit' | 'find' | 'search' | 'exit' | 'rage' | 'dead' | 'error' | 'egg' | 'replay' | 'auto' | 'tor'

const props = withDefaults(
  defineProps<{
    flags?: readonly (IntentFlag | string)[]
    session?: Record<string, unknown> | null
    replay?: boolean
    webdriver?: boolean
    tor?: boolean
    /** Show at most N chips, then `+n`. */
    max?: number
    testid?: string
  }>(),
  { flags: () => [], session: null, replay: undefined, webdriver: undefined, tor: undefined, max: undefined, testid: 'intent-badge' },
)

const ORDER: { id: Badge; word: string; glyph: string; title: string }[] = [
  { id: 'print', word: 'PRINT', glyph: '⎙', title: 'printed the page' },
  { id: 'copy', word: 'COPY', glyph: '⧉', title: 'copied text' },
  { id: 'email', word: 'EMAIL', glyph: '@', title: 'copied the email address or clicked mailto' },
  { id: 'form', word: 'FORM', glyph: '✎', title: 'started the contact form' },
  { id: 'submit', word: 'MAIL', glyph: '✉', title: 'mail handoff (form submit or mailto click)' },
  { id: 'find', word: 'FIND', glyph: '⌕', title: 'used find-in-page' },
  { id: 'search', word: 'SEARCH', glyph: '⌗', title: 'used the site search' },
  { id: 'exit', word: 'EXIT', glyph: '⇱', title: 'exit intent' },
  { id: 'rage', word: 'RAGE', glyph: '‼', title: 'rage clicks' },
  { id: 'dead', word: 'DEAD', glyph: '∅', title: 'dead clicks' },
  { id: 'error', word: 'ERR', glyph: '✖', title: 'JS / resource / console errors' },
  { id: 'egg', word: 'EGG', glyph: '★', title: 'found the easter egg' },
  { id: 'replay', word: 'REPLAY', glyph: '▶', title: 'has a session replay' },
  { id: 'auto', word: 'AUTO', glyph: '⚙', title: 'navigator.webdriver' },
  { id: 'tor', word: 'TOR', glyph: '⊚', title: 'Tor exit node' },
]

function pos(v: unknown): boolean {
  return typeof v === 'number' ? v > 0 : v === true || v === '1'
}

const active = computed<Set<Badge>>(() => {
  const set = new Set<Badge>()
  for (const f of props.flags) {
    if (f === 'outbound') continue
    if (ORDER.some(o => o.id === f)) set.add(f as Badge)
  }
  const s = props.session
  if (s) {
    if (pos(s.prints)) set.add('print')
    if (pos(s.copies)) set.add('copy')
    if (pos(s.email_copies) || pos(s.mailto_clicks)) set.add('email')
    if (pos(s.form_started)) set.add('form')
    if (pos(s.form_submitted) || pos(s.mailto_clicks)) set.add('submit')
    if (pos(s.finds)) set.add('find')
    if (pos(s.searches)) set.add('search')
    if (pos(s.exit_intents)) set.add('exit')
    if (pos(s.rage_clicks)) set.add('rage')
    if (pos(s.dead_clicks)) set.add('dead')
    if (pos(s.errors)) set.add('error')
    if (pos(s.eggs)) set.add('egg')
    if (pos(s.has_replay) || pos(s.hasReplay)) set.add('replay')
    if (pos(s.is_webdriver) || pos(s.isWebdriver)) set.add('auto')
    if (pos(s.is_tor) || pos(s.isTor)) set.add('tor')
  }
  if (props.replay) set.add('replay')
  if (props.webdriver) set.add('auto')
  if (props.tor) set.add('tor')
  return set
})

const chips = computed(() => ORDER.filter(o => active.value.has(o.id)))
const shown = computed(() => (props.max !== undefined ? chips.value.slice(0, props.max) : chips.value))
const more = computed(() => chips.value.length - shown.value.length)
</script>

<template>
  <span v-if="chips.length" class="ib" :title="chips.map(c => c.word).join(' · ')">
    <span v-for="c in shown" :key="c.id" class="ib__chip label" :data-testid="testid" :data-flag="c.id" :title="c.title">
      <span class="ib__glyph" aria-hidden="true">{{ c.glyph }}</span>{{ c.word }}
    </span>
    <span v-if="more > 0" class="ib__chip ib__chip--more label">+{{ more }}</span>
  </span>
</template>

<style scoped>
.ib {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 3px;
  vertical-align: middle;
}

.ib__chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 0 5px;
  border: 1px solid var(--hairline-lit);
  color: var(--text);
  line-height: 1.5;
  white-space: nowrap;
}

.ib__chip--more {
  color: var(--text-dim);
  border-style: dashed;
}

.ib__glyph {
  color: var(--text-dim);
}
</style>
