import type { ShareRevokeResult } from '../../../../../shared/analytics/ops'
import { requireAdmin } from '../../../../utils/auth'
import { getDb } from '../../../../utils/db'
import { isShareToken } from '../../../../utils/share'

/**
 * POST /api/ops/share/:token/revoke — retire a link (`{ revoked?: boolean }`,
 * default true; pass `false` to un-retire).
 *
 * Revoking does NOT stop the capture, and that is deliberate: a link the owner
 * has retired but that keeps being opened is exactly the signal this feature
 * exists to surface. The console marks the link REVOKED and keeps counting.
 */
export default defineEventHandler(async (event): Promise<ShareRevokeResult> => {
  await requireAdmin(event)
  const token = getRouterParam(event, 'token') ?? ''
  if (!isShareToken(token)) throw createError({ statusCode: 400, statusMessage: 'bad share token' })
  const body = await readBody<{ revoked?: unknown }>(event).catch(() => null)
  const revoked = body?.revoked === false ? 0 : 1

  const res = await getDb(event).prepare('UPDATE share_links SET revoked = ? WHERE token = ?').bind(revoked, token).run()
  if ((res.meta?.changes ?? 0) !== 1) throw createError({ statusCode: 404, statusMessage: 'no such share link' })

  return { token, revoked: revoked === 1 }
})
