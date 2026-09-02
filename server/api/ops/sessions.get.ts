import type { SessionRow, SessionsPage } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { batchAll, bindStmt, toNum } from '../../utils/opsDb'
import { buildWhere, intParam, parseOpsQuery, parseWindow, sessionProjection, sortSpec } from '../../utils/opsFilters'

const SORTS: Record<string, string> = {
  started_at: 's.started_at',
  duration_ms: 's.duration_ms',
  pageviews: 's.pageviews',
}

/**
 * GET /api/ops/sessions — keyset-paged listing (audit A24): newest first by
 * default; `before=<sort value of the last row>&beforeSid=<its sid>` fetches
 * the next page via `(col < ? OR (col = ? AND sid < ?))`; `total` only on the
 * first page. Explicit projection (+ ip / ua with `fields=full`) and the
 * ACTIVE subquery. Uncached.
 */
export default defineEventHandler(async (event): Promise<SessionsPage> => {
  await requireAdmin(event)
  const raw = getQuery(event) as Record<string, unknown>
  const q = parseOpsQuery(raw)
  // A half-cursor is silently dropped by the parser and would hand LOAD MORE
  // page 1 again, forever — say 400 instead (R4-L11).
  if (raw.before !== undefined || raw.beforeSid !== undefined) {
    const n = Number(q.before)
    if (!Number.isFinite(n) || typeof q.beforeSid !== 'string') {
      throw createError({ statusCode: 400, statusMessage: 'invalid cursor: before (number) + beforeSid (id) are required together' })
    }
  }
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const limit = intParam(q.limit, 50, 1, 200)
  const sort = sortSpec(q, SORTS, 'started_at')
  const full = q.fields === 'full'

  let cursorSql = ''
  const cursorArgs: unknown[] = []
  const before = q.before === undefined ? Number.NaN : Number(q.before)
  const hasCursor = Number.isFinite(before) && typeof q.beforeSid === 'string'
  if (hasCursor) {
    const op = sort.dir === 'DESC' ? '<' : '>'
    cursorSql = ` AND (${sort.col} ${op} ? OR (${sort.col} = ? AND s.sid ${op} ?))`
    cursorArgs.push(before, before, q.beforeSid)
  }

  const res = await batchAll(db, [
    bindStmt(
      db,
      `SELECT ${sessionProjection('s', full)} FROM sessions s WHERE ${where.sql}${cursorSql} ORDER BY ${sort.col} ${sort.dir}, s.sid ${sort.dir} LIMIT ?`,
      [...where.args, ...cursorArgs, limit + 1],
    ),
    hasCursor ? bindStmt(db, 'SELECT 1 AS x') : bindStmt(db, `SELECT COUNT(*) AS n FROM sessions s WHERE ${where.sql}`, where.args),
  ])
  const all = (res[0] ?? []) as unknown as SessionRow[]
  const rows = all.slice(0, limit)
  const last = rows[rows.length - 1]
  const more = all.length > limit && last !== undefined
  return {
    total: hasCursor ? null : toNum(res[1]?.[0]?.n),
    rows,
    next: more ? { before: toNum((last as unknown as Record<string, unknown>)[sort.key]), beforeSid: last.sid } : null,
  }
})
