<script setup lang="ts">
import { resume } from '~/data/resume'
import type { NavLink } from '~/data/resume'

const tabs = resume.nav
const route = useRoute()
const NsLink = resolveComponent('NuxtLink')

const openId = ref<string | null>(null)
const openChild = ref<string | null>(null)
const mobileOpen = ref(false)

// which top-level tab owns the current route (NetSuite draws it as a
// solid darker block, not an underline)
const activeId = computed(() => {
  const p = route.path
  if (p === '/') return 'home'
  if (p.startsWith('/positions')) return 'activities'
  if (p.startsWith('/employee') || p.startsWith('/projects') || p.startsWith('/fobech')) return 'lists'
  if (p.startsWith('/colophon')) return 'customization'
  if (p.startsWith('/contact')) return 'support'
  return ''
})

// NetSuite's first three tabs are icon-only
const ICONS: Record<string, string> = { recent: '🕐', shortcuts: '☆', home: '⌂' }

/** The rows for a tab: the icon tabs borrow their own menus. */
function itemsFor(tabId: string, items?: NavLink[]): NavLink[] {
  if (tabId === 'shortcuts') return resume.shortcutsMenu
  if (tabId === 'recent') return resume.recentMenu
  return items ?? []
}

/** NetSuite prepends "<Tab> Overview" to every menu, then a separator. */
function overviewLabel(tab: { id: string; label: string }): string {
  if (tab.id === 'shortcuts') return 'Add To Shortcuts'
  if (tab.id === 'recent') return 'All Recent Records'
  return `${tab.label} Overview`
}

watch(
  () => route.fullPath,
  () => {
    openId.value = null
    openChild.value = null
    mobileOpen.value = false
  },
)

// NetSuite menus open on HOVER, not click
function open(id: string): void {
  openId.value = id
  openChild.value = null
}
function closeAll(): void {
  openId.value = null
  openChild.value = null
}
function toggle(id: string): void {
  openId.value = openId.value === id ? null : id
  openChild.value = null
}

function linkAttrs(l: NavLink) {
  return l.to ? { to: l.to } : { href: l.href, target: '_blank', rel: 'noopener' }
}
</script>

<template>
  <nav class="ns-nav" :class="{ 'ns-nav--open': mobileOpen }" aria-label="Main Menu" @mouseleave="closeAll">
    <button type="button" class="ns-nav__burger" aria-label="Toggle menu" @click="mobileOpen = !mobileOpen">
      ☰ Menu
    </button>

    <ul class="ns-nav__list">
      <li
        v-for="tab in tabs"
        :key="tab.id"
        class="ns-nav__tab"
        :class="{ 'ns-nav__tab--on': activeId === tab.id, 'ns-nav__tab--open': openId === tab.id }"
        @mouseenter="open(tab.id)"
      >
        <!-- Home is a real link; the rest open menus -->
        <NuxtLink
          v-if="tab.to && tab.id === 'home'"
          :to="tab.to"
          class="ns-nav__link ns-nav__link--icon"
          :title="tab.label"
          :aria-label="tab.label"
        >
          {{ ICONS[tab.icon!] }}
        </NuxtLink>
        <button
          v-else
          type="button"
          class="ns-nav__link"
          :class="{ 'ns-nav__link--icon': tab.icon }"
          :title="tab.icon ? tab.label : undefined"
          :aria-label="tab.icon ? tab.label : undefined"
          :aria-expanded="openId === tab.id"
          @click="toggle(tab.id)"
        >
          <template v-if="tab.icon">{{ ICONS[tab.icon] }}</template>
          <template v-else>{{ tab.label }}</template>
        </button>

        <div v-if="openId === tab.id && itemsFor(tab.id, tab.items).length" class="ns-nav__panel">
          <NuxtLink
            v-if="tab.id === 'home'"
            to="/"
            class="ns-nav__item ns-nav__item--overview"
          >
            {{ overviewLabel(tab) }}
          </NuxtLink>
          <span v-else class="ns-nav__item ns-nav__item--overview">{{ overviewLabel(tab) }}</span>

          <template v-for="item in itemsFor(tab.id, tab.items)" :key="item.label">
            <!-- a row with children shows a chevron and opens a flyout -->
            <div v-if="item.children" class="ns-nav__row" @mouseenter="openChild = item.label">
              <button type="button" class="ns-nav__item" @click="openChild = openChild === item.label ? null : item.label">
                {{ item.label }}
                <span class="ns-nav__chev" aria-hidden="true">›</span>
              </button>
              <div v-if="openChild === item.label" class="ns-nav__panel ns-nav__panel--flyout">
                <component
                  :is="c.to ? NsLink : 'a'"
                  v-for="c in item.children"
                  :key="c.label"
                  class="ns-nav__item"
                  v-bind="linkAttrs(c)"
                >
                  {{ c.label }}
                </component>
              </div>
            </div>

            <component v-else :is="item.to ? NsLink : 'a'" class="ns-nav__item" v-bind="linkAttrs(item)">
              {{ item.label }}
            </component>
          </template>
        </div>
      </li>
    </ul>

    <span class="ns-nav__ellipsis" aria-hidden="true">•••</span>
  </nav>
</template>
