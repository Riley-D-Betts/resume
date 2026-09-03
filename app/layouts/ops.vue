<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const { linkTo } = useOpsFilters()

interface NavLink {
  to: string
  label: string
  active: (p: string) => boolean
}

const prefix = (p: string) => (path: string) => path === p || path.startsWith(`${p}/`)

const ALL_LINKS: NavLink[] = [
  { to: '/ops', label: 'OVERVIEW', active: p => p === '/ops' },
  { to: '/ops/pages', label: 'PAGES', active: prefix('/ops/pages') },
  { to: '/ops/flows', label: 'FLOWS', active: prefix('/ops/flows') },
  { to: '/ops/orgs', label: 'ORGS', active: prefix('/ops/orgs') },
  { to: '/ops/visitors', label: 'VISITORS', active: prefix('/ops/visitors') },
  { to: '/ops/sessions', label: 'SESSIONS', active: prefix('/ops/sessions') },
  { to: '/ops/intent', label: 'INTENT', active: prefix('/ops/intent') },
  { to: '/ops/performance', label: 'PERFORMANCE', active: prefix('/ops/performance') },
  { to: '/ops/technology', label: 'TECHNOLOGY', active: prefix('/ops/technology') },
  { to: '/ops/errors', label: 'ERRORS', active: prefix('/ops/errors') },
  { to: '/ops/sql', label: 'SQL', active: prefix('/ops/sql') },
  { to: '/', label: 'VIEW SITE', active: () => false },
]

/**
 * Only links whose route exists get rendered (contract E.2) — a partial
 * deploy (components without pages) never shows a link that 404s.
 */
const links = computed(() =>
  ALL_LINKS.filter(l => {
    try {
      return router.resolve(l.to).matched.length > 0
    } catch {
      return false
    }
  }),
)

/** Console links carry the shared filters (R4-M5); VIEW SITE stays clean. */
function href(l: NavLink): string {
  return l.to.startsWith('/ops') ? linkTo(l.to) : l.to
}

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
        <span class="ops-strip__id-text">OPS CONSOLE // CLEARANCE: GOD KING OF BETTSUITE</span>
      </span>
      <nav class="ops-strip__nav label" aria-label="Ops console">
        <NuxtLink
          v-for="l in links"
          :key="l.to"
          :to="href(l)"
          class="ops-strip__link"
          :class="{ 'ops-strip__link--on': l.active(route.path) }"
          :aria-current="l.active(route.path) ? 'page' : undefined"
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
  flex: none;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The banner is the space hog (contract D14): under 1100 px only the lamp stays. */
@media (max-width: 1100px) {
  .ops-strip__id-text {
    display: none;
  }
}

.ops-strip__nav {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -webkit-overflow-scrolling: touch;
}

.ops-strip__nav::-webkit-scrollbar {
  display: none;
}

.ops-strip__link {
  flex: none;
  color: var(--text-dim);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: var(--fs-micro);
  white-space: nowrap;
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
