<script setup lang="ts">
/**
 * NetSuite subtabs. Not folder tabs — flat labels on a #c3d1de bar,
 * 14px normal weight, with the active one simply BOLD plus a 2px
 * underline. Any subtab holding data gets a "•" appended.
 */
defineProps<{ tabs: string[] }>()
const active = ref(0)
</script>

<template>
  <div>
    <div class="ns-subtabs" role="tablist">
      <button
        v-for="(t, i) in tabs"
        :key="t"
        type="button"
        class="ns-subtab ns-subtab__dot"
        :class="{ 'ns-subtab--on': active === i }"
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
