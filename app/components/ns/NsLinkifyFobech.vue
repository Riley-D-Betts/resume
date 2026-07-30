<script setup lang="ts">
/**
 * Renders prose text, turning every "Fobech" (and bare "fobech.com")
 * mention into a link to the studio site. House rule: the studio
 * always gets its plug.
 */
const props = defineProps<{ text: string }>()
const parts = computed(() => props.text.split(/(Fobech|fobech\.com)/))
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <a
      v-if="part === 'Fobech' || part === 'fobech.com'"
      href="https://fobech.com"
      target="_blank"
      rel="noopener"
    >{{ part }}</a>
    <template v-else>{{ part }}</template>
  </template>
</template>
