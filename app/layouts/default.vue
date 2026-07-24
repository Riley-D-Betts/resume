<template>
  <div class="site">
    <StatusBar />
    <slot />
    <ScanlineOverlay />
    <CursorReticle />
    <TerminalDrawer />
    <EggOverlays />
  </div>
</template>

<style scoped>
.site {
  min-height: 100vh;
}
</style>
