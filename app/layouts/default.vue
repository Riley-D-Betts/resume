<script setup lang="ts">
// Mark the body so the NetSuite theme (netsuite.css, scoped under
// `body.ns`) applies to public pages only — the private /ops console
// keeps its own dark theme because it never gets this class.
useHead({ bodyAttrs: { class: 'ns' } })
</script>

<template>
  <div class="ns-app">
    <NsLoadingBar />
    <NsMasthead />
    <NsNavBar />

    <main class="ns-main">
      <slot />
    </main>

    <NsFooter />

    <NsToaster />
    <NsSplash />
  </div>
</template>
