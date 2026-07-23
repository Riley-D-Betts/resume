import { adminEnabled, getOpsSession } from '../../utils/auth'

/** GET /api/ops/me — non-throwing auth probe for the route middleware. */
export default defineEventHandler(async (event) => {
  try {
    if (!adminEnabled(event)) return { admin: false }
    const session = await getOpsSession(event)
    return { admin: session.data.admin === true }
  } catch {
    return { admin: false }
  }
})
