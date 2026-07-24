import { getOpsSession } from '../../utils/auth'

/** POST /api/ops/logout — drop the rbops session cookie. */
export default defineEventHandler(async (event) => {
  const session = await getOpsSession(event)
  await session.clear()
  return { ok: true }
})
