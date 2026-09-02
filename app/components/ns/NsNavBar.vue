<script setup lang="ts">
import { resume } from '~/data/resume'
import type { NavLink } from '~/data/resume'

const tabs = resume.nav
const route = useRoute()
const NsLink = resolveComponent('NuxtLink')

const openId = ref<string | null>(null)
const openChild = ref<string | null>(null)
const mobileOpen = ref(false)

// which top-level tab owns the current route (Bettsuite draws it as a
// solid darker block, not an underline)
const activeId = computed(() => {
  const p = route.path
  if (p === '/') return 'home'
  if (p.startsWith('/positions')) return 'activities'
  if (p.startsWith('/employee') || p.startsWith('/projects')) return 'lists'
  if (p.startsWith('/colophon')) return 'customization'
  if (p.startsWith('/contact')) return 'support'
  return ''
})

// Bettsuite's first three tabs are icon-only: a history clock, a star and
// a house. Drawn as monochrome SVG paths so they render identically
// everywhere (emoji would come out full-colour, and some are tofu).
const ICONS: Record<string, string> = {
  recent:
    'M8 2.6a5.4 5.4 0 1 0 5.4 5.4M8 2.6 6.1 4.5M8 2.6l1.9 1.9M8 5.1v3l2 1.2',
  shortcuts: 'M8 2.2l1.75 3.55 3.92.57-2.84 2.76.67 3.9L8 11.16l-3.5 1.84.67-3.9L2.33 6.34l3.92-.57z',
  home: 'M2.6 7.7 8 3l5.4 4.7M4.2 6.9V13h7.6V6.9',
}

/** The rows for a tab: the icon tabs borrow their own menus. */
function itemsFor(tabId: string, items?: NavLink[]): NavLink[] {
  if (tabId === 'shortcuts') return resume.shortcutsMenu
  if (tabId === 'recent') return resume.recentMenu
  return items ?? []
}

/** Bettsuite prepends "<Tab> Overview" to every menu, then a separator. */
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

// Bettsuite menus open on HOVER, not click
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
  <nav class="ns-nav" :class="{ 'ns-nav--open': mobileOpen }" aria-label="Main Menu" data-zone="nav" @mouseleave="closeAll">
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
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path :d="ICONS[tab.icon!]" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
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
          <template v-if="tab.icon"><svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path :d="ICONS[tab.icon]" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
          </svg></template>
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

  </nav>
</template>
