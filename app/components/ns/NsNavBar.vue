<script setup lang="ts">
import { resume } from '~/data/resume'

const tabs = resume.nav
const route = useRoute()
const NsLink = resolveComponent('NuxtLink')

const openId = ref<string | null>(null)
const mobileOpen = ref(false)

// which top-level tab owns the current route (for the active underline)
const activeId = computed(() => {
  const p = route.path
  if (p === '/') return 'home'
  if (p.startsWith('/positions')) return 'activities'
  if (p.startsWith('/employee') || p.startsWith('/projects')) return 'lists'
  if (p.startsWith('/fobech')) return 'fobech'
  if (p.startsWith('/contact')) return 'support'
  return ''
})

// close everything on navigation
watch(
  () => route.fullPath,
  () => {
    openId.value = null
    mobileOpen.value = false
  },
)

function hoverOpen(id: string): void {
  // hover only drives desktop; pointer:coarse devices ignore mouseenter
  openId.value = id
}
function toggle(id: string): void {
  openId.value = openId.value === id ? null : id
}
</script>

<template>
  <nav class="ns-nav" :class="{ 'ns-nav--open': mobileOpen }" aria-label="Main menu" @mouseleave="openId = null">
    <button type="button" class="ns-nav__burger" aria-label="Toggle menu" @click="mobileOpen = !mobileOpen">
      ☰ Menu
    </button>

    <ul class="ns-nav__list">
      <li
        v-for="tab in tabs"
        :key="tab.id"
        class="ns-nav__tab"
        :class="{ 'ns-nav__tab--on': activeId === tab.id, 'ns-nav__tab--open': openId === tab.id }"
        @mouseenter="tab.columns && hoverOpen(tab.id)"
      >
        <NuxtLink v-if="tab.to && !tab.columns" :to="tab.to" class="ns-nav__link">
          {{ tab.label }}
        </NuxtLink>
        <button
          v-else
          type="button"
          class="ns-nav__link"
          :aria-expanded="openId === tab.id"
          @click="toggle(tab.id)"
        >
          {{ tab.label }}
          <span class="ns-nav__caret" aria-hidden="true">▾</span>
        </button>

        <div v-if="tab.columns && openId === tab.id" class="ns-nav__panel">
          <div v-for="col in tab.columns" :key="col.heading" class="ns-nav__col">
            <div class="ns-nav__heading">{{ col.heading }}</div>
            <component
              :is="link.to ? NsLink : 'a'"
              v-for="link in col.links"
              :key="link.label"
              class="ns-nav__item"
              v-bind="link.to ? { to: link.to } : { href: link.href, target: '_blank', rel: 'noopener' }"
            >
              <b>{{ link.label }}</b>
              <span v-if="link.desc">{{ link.desc }}</span>
            </component>
          </div>
        </div>
      </li>
    </ul>
  </nav>
</template>
