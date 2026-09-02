/**
 * Route guard for /ops pages (applied via definePageMeta, not globally).
 * /ops/** renders client-only (routeRules ssr:false), so this runs in the
 * browser where $fetch carries the rbops cookie automatically.
 *
 * Query-only navigations (the filter bar writing `?range=30d&org=…` through
 * `router.replace`) skip the probe — no `/api/ops/me` round trip per
 * keystroke; an expired cookie is caught by `useOpsFetch`'s 401 → login.
 */
export default defineNuxtRouteMiddleware(async (to, from) => {
  if (import.meta.server) return
  if (to.path === '/ops/login') return
  if (from && to.path === from.path) return
  try {
    const me = await $fetch<{ admin: boolean }>('/api/ops/me')
    if (!me.admin) return navigateTo('/ops/login')
  } catch {
    return navigateTo('/ops/login')
  }
})
