<template>
  <div class="site">
    <StatusBar />
    <slot />
    <ScanlineOverlay />
    <CursorReticle />
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
}
</style>
