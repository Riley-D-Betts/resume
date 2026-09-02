<script setup lang="ts">
import { useTrack } from '~/composables/useTrack'

/**
 * Bettsuite subtabs. Not folder tabs — flat labels on a #c3d1de bar,
 * 14px normal weight, with the active one simply BOLD plus a 2px
 * underline. Any subtab holding data gets a "•" appended.
 */
const props = defineProps<{ tabs: string[]; empty?: string[] }>()
const track = useTrack()

/** Bettsuite bullets only the subtabs that actually contain data. */
function hasData(t: string): boolean {
  return !(props.empty ?? []).includes(t)
}
const active = ref(0)

/** A user switch; re-clicking the active tab is not one. */
function select(i: number): void {
  if (i === active.value) return
  active.value = i
  track('subtab', props.tabs[i] ?? String(i), { index: i })
}
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
        @click="select(i)"
      >
        {{ t }}
      </button>
    </div>
    <slot :active="active" />
  </div>
</template>
