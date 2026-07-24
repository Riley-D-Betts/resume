<script setup lang="ts">
// Mark the body so the NetSuite theme (netsuite.css, scoped under
// `body.ns`) applies to public pages only — the private /ops console
// keeps its own dark theme because it never gets this class.
useHead({ bodyAttrs: { class: 'ns' } })

// The Home dashboard sits on NetSuite's gray portlet background;
// record and list pages are full-bleed white.
const route = useRoute()
const isDashboard = computed(() => route.path === '/')
</script>

<template>
  <div class="ns-app">
    <NsLoadingBar />
    <NsMasthead />
    <NsNavBar />

    <main class="ns-main" :class="{ 'ns-main--dash': isDashboard }">
      <slot />
    </main>

    <NsFooter />

    <NsToaster />
    <NsSplash />
  </div>
</template>
