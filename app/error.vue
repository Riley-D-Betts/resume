<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

// The error page renders outside the layout, so set the Bettsuite theme
// class on <body> here too.
useHead({ bodyAttrs: { class: 'ns' }, title: `Error ${props.error.statusCode} | Bettsuite` })

const is404 = computed(() => props.error.statusCode === 404)
</script>

<template>
  <!-- Bettsuite renders errors inside the normal chrome as plain
       left-aligned text, not as a centred card. -->
  <div class="ns-app">
    <NsMasthead />
    <NsNavBar />

    <main class="ns-main">
      <div class="ns-pagetitle">
        <div class="ns-pagetitle__first">
          <h1 class="ns-record-type">{{ is404 ? 'Page Not Found' : 'System Error' }}</h1>
        </div>
        <div class="ns-pagetitle__second">
          <span class="ns-record-id">{{ error.statusCode }}</span>
        </div>
      </div>

      <div class="ns-buttonbar">
        <button type="button" class="ns-btn ns-btn--primary" @click="clearError({ redirect: '/' })">Home</button>
        <NuxtLink to="/positions" class="ns-btn">Employment History</NuxtLink>
        <NuxtLink to="/projects" class="ns-btn">Projects</NuxtLink>
      </div>

      <div class="ns-secbar">Details</div>
      <div class="ns-fieldgroup">
        <div class="ns-fields">
          <div class="ns-field">
            <span class="ns-field__label">Message</span>
            <span class="ns-field__value">
              {{
                is404
                  ? 'The page you have requested is not available. It may have been removed, or the URL may be mistyped.'
                  : 'An unexpected error occurred while processing your request.'
              }}
            </span>
          </div>
          <div class="ns-field">
            <span class="ns-field__label">Error Reference</span>
            <span class="ns-field__value">NS-ERR-{{ error.statusCode }}</span>
          </div>
        </div>
      </div>
    </main>

    <NsFooter />
  </div>
</template>
