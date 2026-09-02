<script setup lang="ts">
import { resume } from '~/data/resume'
import { useSearchIndex } from '~/composables/useSearchIndex'
import { useTrack } from '~/composables/useTrack'

/**
 * Bettsuite's "Masthead" — the LIGHT top row. Riley documents it as
 * exactly these elements, in this order: logo, global search, Create
 * New, Help, Feedback, user name + role. There is deliberately no
 * notification bell, gear or envelope here.
 */
const account = resume.account
const index = useSearchIndex()
const router = useRouter()
const track = useTrack()

const query = ref('')
const open = ref(false)
const cursor = ref(0)

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  // Bettsuite's global search fires at 3 characters minimum
  if (q.length < 3) return []
  return index.filter((h) => h.name.toLowerCase().includes(q) || h.terms.includes(q)).slice(0, 7)
})

watch(results, () => {
  cursor.value = 0
})

// ---- site_search (contract B.4) --------------------------------------
// What visitors type into the global search is intent worth keeping:
// reported once per distinct query, on Enter, on picking a result (which
// adds `chosen`) or on leaving the field. Lowercased, ≤ 40 chars.
const reported = new Set<string>()

function normQ(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 40)
}

function reportSearch(q: string, n: number, chosen?: string): void {
  if (q.length < 3 || reported.has(q)) return
  reported.add(q)
  track('site_search', q, { q, results: n, ...(chosen ? { chosen } : {}) })
}

function go(hit: { to?: string; href?: string }): void {
  reportSearch(normQ(query.value), results.value.length, (hit.to ?? hit.href ?? '').slice(0, 40))
  open.value = false
  query.value = ''
  if (hit.to) router.push(hit.to)
  else if (hit.href) window.open(hit.href, '_blank', 'noopener')
}

function onEnter(): void {
  const hit = results.value[cursor.value]
  if (hit) go(hit)
  else reportSearch(normQ(query.value), results.value.length)
}

function move(delta: number): void {
  if (!results.value.length) return
  cursor.value = (cursor.value + delta + results.value.length) % results.value.length
}

function onBlur(): void {
  const q = normQ(query.value)
  const n = results.value.length
  // let a click on a result register before closing — and before this
  // report, so a selection wins and carries its `chosen`
  setTimeout(() => {
    open.value = false
    reportSearch(q, n)
  }, 150)
}
</script>

<template>
  <header class="ns-mast" data-zone="masthead">
    <NuxtLink to="/" class="ns-logo" aria-label="Riley Bettsuite home">
      <span class="ns-logo__riley">RILEY</span>
      <span class="ns-logo__word">Bettsuite</span>
    </NuxtLink>

    <span class="ns-logo__sub">{{ account.edition }}</span>

    <div class="ns-search" role="search">
      <svg class="ns-search__icon" viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6" />
        <line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
      <input
        v-model="query"
        class="ns-search__input"
        type="search"
        placeholder="Search"
        aria-label="Global search"
        autocomplete="off"
        @focus="open = true"
        @blur="onBlur"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="onEnter"
        @keydown.esc="open = false"
      />
      <div v-if="open && query.trim().length >= 3" class="ns-search__results">
        <template v-if="results.length">
          <a
            v-for="(hit, i) in results"
            :key="hit.name"
            class="ns-search__item"
            :class="{ 'ns-search__item--on': i === cursor }"
            :href="hit.to || hit.href"
            @mouseenter="cursor = i"
            @click.prevent="go(hit)"
          >
            <span class="ns-search__type">{{ hit.type }}</span>
            <span>{{ hit.name }}</span>
          </a>
        </template>
        <div v-else class="ns-search__empty">No records match “{{ query }}”.</div>
      </div>
    </div>

    <div class="ns-mast__tools">
      <!-- Create New: a page outline with a + at its lower left -->
      <NuxtLink to="/contact" class="ns-iconbtn" title="Create New" aria-label="Create New" data-track-hover="contact-cta">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M4 1.5h5l3 3v10H4z" fill="none" stroke="currentColor" stroke-width="1.2" />
          <path d="M9 1.5v3.2h3.2" fill="none" stroke="currentColor" stroke-width="1.2" />
          <path d="M3 9.5v5M0.5 12h5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        </svg>
      </NuxtLink>
      <span class="ns-mast__divider" aria-hidden="true" />
      <NuxtLink to="/colophon" class="ns-iconbtn" aria-label="Help">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path
            d="M6.2 6.1a1.9 1.9 0 1 1 2.4 1.9c-.5.2-.7.6-.7 1.1v.4"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
          />
          <circle cx="8" cy="11.6" r="0.85" fill="currentColor" />
        </svg>
        <span class="ns-iconbtn__label">Help</span>
      </NuxtLink>
      <a :href="`mailto:${resume.identity.email}`" class="ns-iconbtn" aria-label="Feedback" data-track-hover="email">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M1.6 2.5h12.8v9H8.6L5 14.2V11.5H1.6z" fill="none" stroke="currentColor" stroke-width="1.2" />
          <circle cx="5.2" cy="7" r="0.85" fill="currentColor" />
          <circle cx="8" cy="7" r="0.85" fill="currentColor" />
          <circle cx="10.8" cy="7" r="0.85" fill="currentColor" />
        </svg>
        <span class="ns-iconbtn__label">Feedback</span>
      </a>
      <NuxtLink to="/employee" class="ns-user" aria-label="User name and role">
        <svg class="ns-user__avatar" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <circle cx="8" cy="5.4" r="2.9" fill="none" stroke="currentColor" stroke-width="1.3" />
          <path d="M2.6 14c0-3 2.4-4.7 5.4-4.7s5.4 1.7 5.4 4.7" fill="none" stroke="currentColor" stroke-width="1.3" />
        </svg>
        <span class="ns-user__meta">
          <span class="ns-user__name">{{ account.personName }}</span>
          <span class="ns-user__role">{{ account.accountName }} - {{ account.roleLabel }}</span>
        </span>
      </NuxtLink>
    </div>
  </header>
</template>
