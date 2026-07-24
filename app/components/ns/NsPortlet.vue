<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    flush?: boolean
    collapsible?: boolean
    refreshable?: boolean
  }>(),
  { flush: false, collapsible: true, refreshable: true },
)

const collapsed = ref(false)
const spinning = ref(false)

function refresh(): void {
  spinning.value = false
  // restart the one-shot spin animation
  requestAnimationFrame(() => {
    spinning.value = true
    setTimeout(() => (spinning.value = false), 650)
  })
}
</script>

<template>
  <section class="ns-portlet" :class="{ 'ns-portlet--collapsed': collapsed }">
    <header class="ns-portlet__head">
      <span class="ns-portlet__grip" aria-hidden="true">⠿</span>
      <span class="ns-portlet__title">{{ title }}</span>
      <div class="ns-portlet__tools">
        <button
          v-if="refreshable"
          type="button"
          class="ns-portlet__tool"
          :class="{ 'ns-portlet__tool--spin': spinning }"
          title="Refresh"
          aria-label="Refresh portlet"
          @click="refresh"
        >
          ⟳
        </button>
        <span class="ns-portlet__tool" title="Portlet menu" aria-hidden="true">⚙</span>
        <button
          v-if="collapsible"
          type="button"
          class="ns-portlet__tool"
          :title="collapsed ? 'Expand' : 'Minimize'"
          :aria-label="collapsed ? 'Expand portlet' : 'Minimize portlet'"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? '▸' : '▾' }}
        </button>
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
