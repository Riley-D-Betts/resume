<script setup lang="ts">
import { resume } from '~/data/resume'
import { useSearchIndex } from '~/composables/useSearchIndex'

const account = resume.account
const clock = useIdahoTime()
const index = useSearchIndex()
const router = useRouter()

const query = ref('')
const open = ref(false)
const cursor = ref(0)

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []
  return index
    .filter((h) => h.name.toLowerCase().includes(q) || h.terms.includes(q))
    .slice(0, 7)
})

watch(results, () => {
  cursor.value = 0
})

function go(hit: { to?: string; href?: string }): void {
  open.value = false
  query.value = ''
  if (hit.to) router.push(hit.to)
  else if (hit.href) window.open(hit.href, '_blank', 'noopener')
}

function onEnter(): void {
  const hit = results.value[cursor.value]
  if (hit) go(hit)
}

function move(delta: number): void {
  if (!results.value.length) return
  cursor.value = (cursor.value + delta + results.value.length) % results.value.length
}

const initials = computed(() =>
  account.personName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase(),
)

function onBlur(): void {
  // let a click on a result register before closing
  setTimeout(() => (open.value = false), 150)
}
</script>

<template>
  <header class="ns-mast">
    <NuxtLink to="/" class="ns-logo" aria-label="NetSuite home">
      <span class="ns-logo__tile">N</span>
      <span class="ns-logo__word">Net<b>Suite</b></span>
      <span class="ns-logo__sub">{{ account.edition }} · {{ account.personName }}</span>
    </NuxtLink>

    <div class="ns-mast__spacer" />

    <div class="ns-search" role="search">
      <span class="ns-search__icon" aria-hidden="true">⌕</span>
      <input
        v-model="query"
        class="ns-search__input"
        type="search"
        placeholder="Search transactions & records…"
        aria-label="Global search"
        autocomplete="off"
        @focus="open = true"
        @blur="onBlur"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="onEnter"
        @keydown.esc="open = false"
      />
      <div v-if="open && query.trim()" class="ns-search__results">
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

    <nav class="ns-mast__tools" aria-label="Account tools">
      <span class="ns-iconbtn" :title="`${account.environment} · ${clock}`" aria-hidden="true">🕑</span>
      <NuxtLink to="/contact" class="ns-iconbtn" title="New" aria-label="Create new">＋</NuxtLink>
      <a :href="`mailto:${resume.identity.email}`" class="ns-iconbtn" title="Messages" aria-label="Messages">✉</a>
      <NuxtLink to="/employee" class="ns-user" aria-label="Employee record">
        <span class="ns-user__avatar">{{ initials }}</span>
        <span class="ns-user__meta">
          <span class="ns-user__name">{{ account.personName }}</span>
          <span class="ns-user__role">{{ account.roleLabel }} · {{ account.environment }}</span>
        </span>
      </NuxtLink>
    </nav>
  </header>
</template>
