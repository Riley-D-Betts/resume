<script setup lang="ts">
// Purely decorative CRT texture. CSS handles reduced-motion removal;
// we also skip the drifting band on coarse pointers / low-memory devices.
const showBand = ref(false)

onMounted(() => {
  const fine = window.matchMedia('(pointer: fine)').matches
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  showBand.value = fine && (mem === undefined || mem >= 4)
})
</script>

<template>
  <div aria-hidden="true">
    <div class="crt-overlay" />
    <div v-if="showBand" class="crt-band" />
  </div>
</template>
