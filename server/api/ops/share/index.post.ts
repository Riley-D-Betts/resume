import type { ShareMintResult } from '../../../../shared/analytics/ops'
import { requireAdmin } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { clampStr } from '../../../utils/sanitize'
import { SHARE_CHANNEL_MAX, SHARE_LABEL_MAX, SHARE_NOTE_MAX, mintShareToken } from '../../../utils/share'
import { shareUrl } from '../../../utils/shareOps'

/**
 * POST /api/ops/share — mint a link for ONE named recipient.
 *
 * Body: `{ label, note?, channel? }`. `label` is the only name this feature
 * ever records ("Jane Okafor — Acme"), and the owner types it himself; nothing
 * downstream infers an identity.
 *
 * The collision retry IS the insert: `INSERT OR IGNORE` returns `changes = 0`
 * when the 4-character token is already taken, so a candidate is claimed
 * atomically instead of being probed and then raced. Six attempts against a
 * 1 048 576-token space.
 */
const INSERT_SQL = 'INSERT OR IGNORE INTO share_links (token, label, note, channel, created_at) VALUES (?, ?, ?, ?, ?)'

export default defineEventHandler(async (event): Promise<ShareMintResult> => {
  await requireAdmin(event)
  const body = await readBody<{ label?: unknown; note?: unknown; channel?: unknown }>(event).catch(() => null)
  const label = clampStr(body?.label, SHARE_LABEL_MAX)
  if (label === null) throw createError({ statusCode: 400, statusMessage: 'label is required' })
  const note = clampStr(body?.note, SHARE_NOTE_MAX)
  const channel = clampStr(body?.channel, SHARE_CHANNEL_MAX)

  const db = getDb(event)
  const now = Date.now()
  let token: string | null
  try {
    token = await mintShareToken(async (candidate) => {
      const res = await db.prepare(INSERT_SQL).bind(candidate, label, note, channel, now).run()
      // changes = 0 → the token was already taken; ask for another one.
      return (res.meta?.changes ?? 0) !== 1
    })
  } catch (err) {
    console.error('[share] mint failed:', err)
    throw createError({ statusCode: 500, statusMessage: 'mint failed' })
  }
  if (token === null) throw createError({ statusCode: 503, statusMessage: 'could not mint a free token — try again' })

  return { token, url: shareUrl(getRequestURL(event).origin, token) }
})
