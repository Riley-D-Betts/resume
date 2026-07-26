<script setup lang="ts">
/** The thin blue progress bar Bettsuite runs on every navigation. */
const width = ref(0)
const visible = ref(false)
let creep: ReturnType<typeof setInterval> | undefined
let done: ReturnType<typeof setTimeout> | undefined

function start(): void {
  clearInterval(creep)
  clearTimeout(done)
  visible.value = true
  width.value = 8
  creep = setInterval(() => {
    // ease toward 90% and hold until the page finishes
    width.value = Math.min(90, width.value + (90 - width.value) * 0.18)
  }, 120)
}

function finish(): void {
  clearInterval(creep)
  width.value = 100
  done = setTimeout(() => {
    visible.value = false
    width.value = 0
  }, 280)
}

const nuxtApp = useNuxtApp()
nuxtApp.hook('page:start', start)
nuxtApp.hook('page:finish', finish)

onBeforeUnmount(() => {
  clearInterval(creep)
  clearTimeout(done)
})
</script>

<template>
  <div
    v-show="visible"
    class="ns-loadbar"
    :style="{ width: width + '%', opacity: width >= 100 ? 0 : 1 }"
    role="progressbar"
    aria-hidden="true"
  />
</template>
