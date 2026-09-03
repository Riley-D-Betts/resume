import type { ShareLinks } from '../../../../shared/analytics/ops'
import { requireAdmin } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { batchAll, bindStmt } from '../../../utils/opsDb'
import {
  SHARE_LINKS_LIMIT,
  SHARE_LINKS_SQL,
  foldShareLinks,
  shareHitRollupSql,
  shareSessionRollupSql,
} from '../../../utils/shareOps'

/**
 * GET /api/ops/share — every minted link with its rollups: opens by kind
 * (view / unfurl / bot), distinct readers, attributed sessions, organisations,
 * countries, unfurl platforms, first / last activity and the FORWARDED flag.
 *
 * Three statements in one batch (one subrequest): the links, the hit rollup
 * grouped by token, and the session rollup joined through
 * `session_net.share_token`.
 *
 * UNCACHED, unlike the aggregate views: minting a link must show it on the
 * very next fetch, and a 30 s window where a freshly minted link is missing
 * from the console would read as a bug. The payload is one small table.
 */
export default defineEventHandler(async (event): Promise<ShareLinks> => {
  await requireAdmin(event)
  const db = getDb(event)
  const origin = getRequestURL(event).origin

  const res = await batchAll(db, [
    bindStmt(db, SHARE_LINKS_SQL, [SHARE_LINKS_LIMIT]),
    bindStmt(db, shareHitRollupSql()),
    bindStmt(db, shareSessionRollupSql()),
  ])

  return { links: foldShareLinks(res[0] ?? [], res[1] ?? [], res[2] ?? [], origin), origin }
})
