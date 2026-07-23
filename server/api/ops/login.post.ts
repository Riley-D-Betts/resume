import { createHash, timingSafeEqual } from 'node:crypto'
import { getOpsSession } from '../../utils/auth'

/**
 * POST /api/ops/login — { password } → seals { admin: true } into the
 * rbops session cookie. Throttled per client IP.
 */
export default defineEventHandler(async (event) => {
  if (!rateLimit('ops-login', getClientIp(event), 5, 60_000)) {
    throw createError({ statusCode: 429, statusMessage: 'too many attempts' })
  }

  let expected = useRuntimeConfig(event).adminPassword
  if (!expected) {
    if (!import.meta.dev) {
      throw createError({ statusCode: 503, statusMessage: 'admin disabled' })
    }
    expected = 'dev'
  }

  const body = await readBody<{ password?: unknown }>(event).catch(() => null)
  const supplied = typeof body?.password === 'string' ? body.password : ''

  // Hash both sides to fixed length so timingSafeEqual never throws on
  // length mismatch (and never leaks length via an early return).
  const a = createHash('sha256').update(supplied).digest()
  const b = createHash('sha256').update(expected).digest()
  if (!timingSafeEqual(a, b)) {
    throw createError({ statusCode: 401, statusMessage: 'access denied' })
  }

  const session = await getOpsSession(event)
  await session.update({ admin: true })
  return { ok: true }
})
