<script setup lang="ts">
const route = useRoute()

const links = [
  { to: '/ops', label: 'OVERVIEW', active: (p: string) => p === '/ops' },
  { to: '/ops/sessions', label: 'SESSIONS', active: (p: string) => p.startsWith('/ops/sessions') },
  { to: '/', label: 'VIEW SITE', active: () => false },
]

async function logout() {
  try {
    await $fetch('/api/ops/logout', { method: 'POST' })
  } catch {
    // even if the call fails, fall through to the login screen
  }
  await navigateTo('/ops/login')
}
</script>

<template>
  <div class="ops">
    <header class="ops-strip">
      <span class="ops-strip__id label">
        <StatusLamp color="teal" />
        OPS CONSOLE // CLEARANCE: GOD KING OF NETSUITE
      </span>
      <nav class="ops-strip__nav label" aria-label="Ops console">
        <NuxtLink
          v-for="l in links"
          :key="l.to"
          :to="l.to"
          class="ops-strip__link"
          :class="{ 'ops-strip__link--on': l.active(route.path) }"
        >
          {{ l.label }}
        </NuxtLink>
        <button type="button" class="ops-strip__link ops-strip__logout" @click="logout">
          LOGOUT
        </button>
      </nav>
    </header>

    <main class="ops-main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.ops {
  min-height: 100vh;
  background: var(--bg-0);
}

.ops-strip {
  position: fixed;
  inset: 0 0 auto 0;
  z-index: var(--z-hud);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: var(--hud-h);
  padding: 0 var(--space-3);
  background: var(--bg-1);
  border-bottom: 1px solid var(--hairline);
}

.ops-strip__id {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ops-strip__nav {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: none;
}

.ops-strip__link {
  color: var(--text-dim);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: var(--fs-micro);
}

.ops-strip__link:hover {
  color: var(--teal-hot);
  text-decoration: none;
}

.ops-strip__link--on {
  color: var(--teal-hot);
}

.ops-strip__logout {
  color: var(--amber);
}

.ops-strip__logout:hover {
  color: var(--red);
}

.ops-main {
  max-width: 1280px;
  margin: 0 auto;
  padding: calc(var(--hud-h) + var(--space-4)) var(--space-3) var(--space-5);
}
</style>
