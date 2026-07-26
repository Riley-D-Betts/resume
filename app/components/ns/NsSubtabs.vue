<script setup lang="ts">
/**
 * Bettsuite subtabs. Not folder tabs — flat labels on a #c3d1de bar,
 * 14px normal weight, with the active one simply BOLD plus a 2px
 * underline. Any subtab holding data gets a "•" appended.
 */
const props = defineProps<{ tabs: string[]; empty?: string[] }>()

/** Bettsuite bullets only the subtabs that actually contain data. */
function hasData(t: string): boolean {
  return !(props.empty ?? []).includes(t)
}
const active = ref(0)
</script>

<template>
  <div>
    <div class="ns-subtabs" role="tablist">
      <button
        v-for="(t, i) in tabs"
        :key="t"
        type="button"
        class="ns-subtab"
        :class="{ 'ns-subtab--on': active === i, 'ns-subtab__dot': hasData(t) }"
        role="tab"
        :aria-selected="active === i"
        @click="active = i"
      >
        {{ t }}
      </button>
    </div>
    <slot :active="active" />
  </div>
</template>
