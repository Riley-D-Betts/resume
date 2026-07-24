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
        <span class="ns-logo__tile">N</span>
        <span class="ns-logo__word">Net<b>Suite</b></span>
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
  padding: 0 14px;
  background: linear-gradient(180deg, #2c3d4f, #223140);
  border-bottom: 1px solid #17222e;
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
  padding: 30px 28px;
  text-align: center;
}
.err__code {
  font-size: 56px;
  font-weight: 800;
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
