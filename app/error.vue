<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

// The error page renders outside the layout, so set the NetSuite theme
// class on <body> here too.
useHead({ bodyAttrs: { class: 'ns' }, title: `Error ${props.error.statusCode} | NetSuite` })

const is404 = computed(() => props.error.statusCode === 404)
</script>

<template>
  <div class="err">
    <header class="err__mast">
      <NuxtLink to="/" class="ns-logo">
        <span class="ns-logo__oracle">ORACLE</span>
        <span class="ns-logo__word">NetSuite</span>
      </NuxtLink>
    </header>

    <main class="err__body">
      <div class="err__card">
        <div class="err__code">{{ error.statusCode }}</div>
        <h1 class="err__title">{{ is404 ? 'Record Not Found' : 'System Error' }}</h1>
        <p class="err__msg">
          {{
            is404
              ? 'The record you requested doesn’t exist or has been removed. Check the URL, or head back to your Role Center.'
              : 'Something went wrong on the server. An administrator has been notified (probably).'
          }}
        </p>
        <div class="err__actions">
          <button type="button" class="ns-btn ns-btn--primary" @click="clearError({ redirect: '/' })">
            Return to Home
          </button>
          <NuxtLink to="/positions" class="ns-btn">Employment History</NuxtLink>
          <NuxtLink to="/projects" class="ns-btn">Projects</NuxtLink>
        </div>
        <p class="err__ref">Error reference: NS-ERR-{{ error.statusCode }}</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.err {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.err__mast {
  height: 46px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--ns-mast-bg);
  border-bottom: 3px solid var(--ns-menu-bg);
}
.err__body {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 24px;
}
.err__card {
  width: min(520px, 100%);
  background: #fff;
  border: 1px solid var(--ns-border);
  border-top: 3px solid var(--ns-brand);
  border-radius: var(--ns-radius);
  box-shadow: var(--ns-shadow);
  padding: 26px 24px;
  text-align: center;
}
.err__code {
  font-size: 52px;
  font-weight: 700;
  color: var(--ns-brand);
  line-height: 1;
}
.err__title {
  font-size: 20px;
  font-weight: 700;
  color: var(--ns-ink);
  margin-top: 6px;
}
.err__msg {
  color: var(--ns-ink-soft);
  font-size: 13px;
  margin: 10px auto 0;
  max-width: 42ch;
}
.err__actions {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 20px;
}
.err__ref {
  margin-top: 18px;
  font-size: 11px;
  color: var(--ns-muted);
  font-family: var(--ns-mono);
}
</style>
