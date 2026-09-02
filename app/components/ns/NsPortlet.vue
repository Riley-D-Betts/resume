<script setup lang="ts">
/**
 * A Bettsuite dashboard portlet.
 *
 * Bettsuite behaviours reproduced here:
 *  - the title bar is the drag handle AND the minimize toggle
 *  - controls stay hidden until the pointer is over the portlet
 *  - the primary control is ONE dropdown caret whose menu holds
 *    "Set Up" / "Refresh" / "Remove" — not a row of icons
 */
withDefaults(
  defineProps<{
    title: string
    flush?: boolean
    refreshable?: boolean
    /** analytics section name (`home.kpi` …) — rendered as `data-section` */
    section?: string
  }>(),
  { flush: false, refreshable: true },
)

const collapsed = ref(false)
const menuOpen = ref(false)
const spinning = ref(false)
const root = ref<HTMLElement | null>(null)
const toast = useToast()

function refresh(): void {
  menuOpen.value = false
  spinning.value = false
  requestAnimationFrame(() => {
    spinning.value = true
    setTimeout(() => (spinning.value = false), 650)
  })
}

function setUp(): void {
  menuOpen.value = false
  toast.show('Dashboard personalization is locked on this account.')
}

function remove(): void {
  menuOpen.value = false
  toast.show('This portlet is part of the résumé. It stays.')
}

function onDoc(e: MouseEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) menuOpen.value = false
}

onMounted(() => document.addEventListener('click', onDoc))
onBeforeUnmount(() => document.removeEventListener('click', onDoc))
</script>

<template>
  <section ref="root" class="ns-portlet" :class="{ 'ns-portlet--collapsed': collapsed }" :data-section="section">
    <header class="ns-portlet__head">
      <span
        class="ns-portlet__title"
        :title="collapsed ? 'Expand' : 'Minimize'"
        @click="collapsed = !collapsed"
      >
        {{ title }}
      </span>
      <div class="ns-portlet__tools">
        <button
          v-if="refreshable"
          type="button"
          class="ns-portlet__tool"
          :class="{ 'ns-portlet__tool--spin': spinning }"
          title="Refresh"
          aria-label="Refresh portlet"
          @click.stop="refresh"
        >
          ⟳
        </button>
        <button
          type="button"
          class="ns-portlet__tool"
          title="Portlet menu"
          aria-label="Portlet menu"
          :aria-expanded="menuOpen"
          @click.stop="menuOpen = !menuOpen"
        >
          ▾
        </button>
        <div v-if="menuOpen" class="ns-portlet__menu">
          <button type="button" class="ns-nav__item" @click="setUp">Set Up</button>
          <button type="button" class="ns-nav__item" @click="refresh">Refresh</button>
          <button type="button" class="ns-nav__item" @click="remove">Remove</button>
        </div>
      </div>
    </header>
    <div class="ns-portlet__body" :class="{ 'ns-portlet__body--flush': flush }">
      <slot />
    </div>
    <div v-if="$slots.foot" class="ns-portlet__foot">
      <slot name="foot" />
    </div>
  </section>
</template>
