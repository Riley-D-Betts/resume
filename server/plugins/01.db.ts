import { join } from 'node:path'

export default defineNitroPlugin(() => {
  const cfg = useRuntimeConfig()

  // Refuse to boot a production build with weak/missing secrets.
  if (!import.meta.dev) {
    if (!cfg.adminPassword) {
      throw new Error('[boot] refusing to start: NUXT_ADMIN_PASSWORD is not set')
    }
    if (!cfg.sessionPassword || cfg.sessionPassword.length < 32) {
      throw new Error('[boot] refusing to start: NUXT_SESSION_PASSWORD must be at least 32 characters')
    }
  }

  // Opening the handle runs migrations.
  getDb()

  console.log(
    `[boot] db=${join(getDataDir(), 'analytics.db')} geo=${isGeoOnline() ? 'online' : 'initializing'}`,
  )
})
