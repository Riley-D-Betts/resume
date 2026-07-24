/**
 * Route guard for /ops pages (applied via definePageMeta, not globally).
 * /ops/** renders client-only (routeRules ssr:false), so this runs in the
 * browser where $fetch carries the rbops cookie automatically.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (import.meta.server) return
  if (to.path === '/ops/login') return
  try {
    const me = await $fetch<{ admin: boolean }>('/api/ops/me')
    if (!me.admin) return navigateTo('/ops/login')
  } catch {
    return navigateTo('/ops/login')
  }
})
