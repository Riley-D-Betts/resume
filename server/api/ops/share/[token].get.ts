import type { ShareHitRow, ShareLinkDetail, SessionRow } from '../../../../shared/analytics/ops'
import { requireAdmin } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import type { Row } from '../../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../../utils/opsDb'
import { sessionProjection } from '../../../utils/opsFilters'
import { isShareToken } from '../../../utils/share'
import {
  SHARE_HITS_LIMIT,
  SHARE_LINK_ONE_SQL,
  SHARE_SESSIONS_LIMIT,
  foldShareLinks,
  shareHitKind,
  shareHitRollupSql,
  shareSessionRollupSql,
} from '../../../utils/shareOps'

/**
 * GET /api/ops/share/:token — one link: the same rollup the list shows, its
 * hit log (newest first, ≤ 200) and the sessions attributed to it through
 * `session_net.share_token` (newest first, ≤ 100).
 *
 * The hit log is the evidence behind the FORWARDED flag: each row says when,
 * what kind of fetch, which platform unfurled it, and from which organisation
 * and country. No IP, no raw user agent — see migrations/0005.
 *
 * Uncached (a link the owner just minted or revoked must read back correctly).
 */
export default defineEventHandler(async (event): Promise<ShareLinkDetail> => {
  await requireAdmin(event)
  const token = getRouterParam(event, 'token') ?? ''
  if (!isShareToken(token)) throw createError({ statusCode: 400, statusMessage: 'bad share token' })
  const db = getDb(event)
  const origin = getRequestURL(event).origin

  const res = await batchAll(db, [
    /* 0 */ bindStmt(db, SHARE_LINK_ONE_SQL, [token]),
    /* 1 */ bindStmt(db, shareHitRollupSql(true), [token]),
    /* 2 */ bindStmt(db, shareSessionRollupSql(true), [token]),
    /* 3 */ bindStmt(
      db,
      'SELECT id, ts, kind, agent, as_org, country, referrer_host, path FROM share_hits WHERE token = ? ORDER BY ts DESC, id DESC LIMIT ?',
      [token, SHARE_HITS_LIMIT],
    ),
    /* 4 */ bindStmt(
      db,
      `SELECT ${sessionProjection('s')} FROM sessions s JOIN session_net n ON n.sid = s.sid WHERE n.share_token = ? `
        + 'ORDER BY s.started_at DESC LIMIT ?',
      [token, SHARE_SESSIONS_LIMIT],
    ),
  ])

  const links = foldShareLinks(res[0] ?? [], res[1] ?? [], res[2] ?? [], origin)
  const link = links[0]
  if (!link) throw createError({ statusCode: 404, statusMessage: 'no such share link' })

  const hits: ShareHitRow[] = (res[3] ?? []).map((r: Row) => ({
    id: toNum(r.id),
    ts: toNum(r.ts),
    kind: shareHitKind(r.kind),
    agent: toStr(r.agent),
    as_org: toStr(r.as_org),
    country: toStr(r.country),
    referrer_host: toStr(r.referrer_host),
    path: toStr(r.path),
  }))

  return { link, hits, sessions: (res[4] ?? []) as unknown as SessionRow[] }
})
