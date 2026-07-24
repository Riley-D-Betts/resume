<script setup lang="ts">
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
        class="ns-subtab"
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
