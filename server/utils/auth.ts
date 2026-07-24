import { createHash } from 'node:crypto'
import type { H3Event, SessionManager } from 'h3'

/** Shape of the sealed /ops session cookie payload. */
export interface OpsSessionData {
  admin?: boolean
}

/**
 * Dev-only fallback so /ops works out of the box with zero env config.
 * Exactly 40 chars — iron-webcrypto requires >= 32.
 */
const DEV_SESSION_PASSWORD = 'rbops-dev-session-password-0123456789abc'

function sessionPassword(event: H3Event): string {
  const cfg = useRuntimeConfig(event)
  if (cfg.sessionPassword) return cfg.sessionPassword
  if (import.meta.dev) return DEV_SESSION_PASSWORD
  // Production without NUXT_SESSION_PASSWORD: derive the seal key from the
  // (secret) admin password so cookies stay unforgeable. When the admin
  // password is ALSO unset this key is guessable, but adminEnabled() below
  // fails closed in that case, so a forged cookie buys nothing.
  return createHash('sha256')
    .update(`rbops-session:${cfg.adminPassword}`)
    .digest('hex')
}

/** Is the admin console usable at all? In production it needs a password. */
export function adminEnabled(event: H3Event): boolean {
  return import.meta.dev || Boolean(useRuntimeConfig(event).adminPassword)
}

/** Session manager for the `rbops` admin cookie. */
export function getOpsSession(event: H3Event): Promise<SessionManager<OpsSessionData>> {
  return useSession<OpsSessionData>(event, {
    name: 'rbops',
    password: sessionPassword(event),
    maxAge: 7 * 86400,
    cookie: { sameSite: 'lax' },
  })
}

/** Guard for /api/ops/* — throws 401 unless the session is an admin one. */
export async function requireAdmin(event: H3Event): Promise<void> {
  if (adminEnabled(event)) {
    const session = await getOpsSession(event)
    if (session.data.admin === true) return
  }
  throw createError({ statusCode: 401, statusMessage: 'unauthorized' })
}
