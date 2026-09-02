import type { EventRow, PageVisitRow, SessionRow, VisitorDetail, VisitorRow } from '../../../../shared/analytics/ops'
import { requireAdmin } from '../../../utils/auth'
import { getDb } from '../../../utils/db'
import { batchAll, bindStmt } from '../../../utils/opsDb'
import { sessionProjection } from '../../../utils/opsFilters'

const ID_RE = /^[0-9a-fA-F-]{16,64}$/
const INTENT_TYPES =
  "('print', 'copy', 'select', 'form', 'outbound', 'find', 'site_search', 'exit_intent', 'rage_click', 'dead_click', 'easter_egg', 'js_error')"

/**
 * GET /api/ops/visitors/:vid — the visitor row, its sessions (newest 100),
 * page visits (newest 300) and intent-type events (newest 200). Uncached.
 */
export default defineEventHandler(async (event): Promise<VisitorDetail> => {
  await requireAdmin(event)
  const vid = getRouterParam(event, 'vid') ?? ''
  if (!ID_RE.test(vid)) throw createError({ statusCode: 400, statusMessage: 'bad visitor id' })
  const db = getDb(event)
  const res = await batchAll(db, [
    bindStmt(db, 'SELECT * FROM visitors WHERE vid = ?', [vid]),
    bindStmt(db, `SELECT ${sessionProjection('s')} FROM sessions s WHERE s.vid = ? ORDER BY s.started_at DESC LIMIT 100`, [vid]),
    bindStmt(
      db,
      'SELECT pv.* FROM page_visits pv JOIN sessions s ON s.sid = pv.sid WHERE s.vid = ? ORDER BY pv.entered_at DESC LIMIT 300',
      [vid],
    ),
    bindStmt(
      db,
      `SELECT e.id, e.ts, e.type, e.name, e.path, e.payload FROM events e JOIN sessions s ON s.sid = e.sid WHERE s.vid = ? AND e.type IN ${INTENT_TYPES} `
        + 'ORDER BY e.ts DESC LIMIT 200',
      [vid],
    ),
  ])
  const visitor = res[0]?.[0]
  if (!visitor) throw createError({ statusCode: 404, statusMessage: 'unknown visitor' })
  return {
    visitor: visitor as unknown as VisitorRow,
    sessions: (res[1] ?? []) as unknown as SessionRow[],
    pageVisits: (res[2] ?? []) as unknown as PageVisitRow[],
    intents: (res[3] ?? []) as unknown as EventRow[],
  }
})
