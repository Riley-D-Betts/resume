import type { H3Event } from 'h3'
import type { Flows, FunnelStep, OpsQuery } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../utils/opsDb'
import { buildWhere, intParam, parseOpsQuery, parseWindow } from '../../utils/opsFilters'

const SIDS_SAMPLE = 1000
const ROWS_CAP = 5000
const SEQ_TOP = 20

/** Path prefixes (consecutive duplicates collapsed) of ≤ `depth` from rows ordered by (sid, entered_at). */
function foldSequences(rows: readonly { sid: string; path: string }[], depth: number, top = SEQ_TOP): { seq: string[]; n: number }[] {
  const counts = new Map<string, number>()
  let cur: string | null = null
  let paths: string[] = []
  const flush = (): void => {
    if (paths.length >= 2) {
      const key = paths.slice(0, depth).join('\n')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  for (const r of rows) {
    if (r.sid !== cur) {
      if (cur !== null) flush()
      cur = r.sid
      paths = []
    }
    if (paths.length < depth && paths[paths.length - 1] !== r.path) paths.push(r.path)
  }
  if (cur !== null) flush()
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([key, n]) => ({ seq: key.split('\n'), n }))
}

async function build(event: H3Event, q: OpsQuery): Promise<Flows> {
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const depth = intParam(q.depth, 3, 2, 5)

  const res = await batchAll(db, [
    /* 0 */ bindStmt(
      db,
      `SELECT COALESCE(pv.from_path, '(entry)') AS "from", pv.path AS "to", COUNT(*) AS n FROM page_visits pv JOIN sessions s ON s.sid = pv.sid `
        + `WHERE ${where.sql} GROUP BY 1, 2 ORDER BY n DESC LIMIT 100`,
      where.args,
    ),
    /* 1 */ bindStmt(
      db,
      `SELECT COALESCE(NULLIF(s.exit_path, ''), s.last_path) AS "from", '(exit)' AS "to", COUNT(*) AS n FROM sessions s WHERE ${where.sql} `
        + 'AND COALESCE(NULLIF(s.exit_path, \'\'), s.last_path) IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 50',
      where.args,
    ),
    /* 2 */ bindStmt(
      db,
      `WITH sids AS MATERIALIZED (SELECT s.sid FROM sessions s WHERE ${where.sql} ORDER BY s.started_at DESC LIMIT ${SIDS_SAMPLE}) `
        + `SELECT pv.sid AS sid, pv.path AS path FROM page_visits pv JOIN sids ON sids.sid = pv.sid ORDER BY pv.sid, pv.entered_at LIMIT ${ROWS_CAP}`,
      where.args,
    ),
    /* 3 */ bindStmt(
      db,
      'SELECT COUNT(*) AS entered, '
        + `COALESCE(SUM(EXISTS (SELECT 1 FROM page_visits pv WHERE pv.sid = s.sid AND pv.path = '/contact')), 0) AS viewedContact, `
        + 'COALESCE(SUM(s.form_started > 0), 0) AS formFocus, COALESCE(SUM(s.form_submitted > 0 OR s.mailto_clicks > 0), 0) AS mailHandoff '
        + `FROM sessions s WHERE ${where.sql}`,
      where.args,
    ),
  ])
  const at = (i: number): Row[] => res[i] ?? []
  const edge = (r: Row): { from: string; to: string; n: number } => ({ from: toStr(r.from) ?? '(entry)', to: toStr(r.to) ?? '(exit)', n: toNum(r.n) })
  const seqRows = at(2).map((r) => ({ sid: String(r.sid), path: toStr(r.path) ?? '' }))
  const sids = new Set(seqRows.map((r) => r.sid)).size
  const f = res[3]?.[0] ?? {}
  const steps: { step: FunnelStep; sessions: number }[] = [
    { step: 'entered', sessions: toNum(f.entered) },
    { step: 'viewed /contact', sessions: toNum(f.viewedContact) },
    { step: 'form focus', sessions: toNum(f.formFocus) },
    { step: 'mail handoff', sessions: toNum(f.mailHandoff) },
  ]
  return {
    edges: [...at(0).map(edge), ...at(1).map(edge)],
    sequences: foldSequences(seqRows, depth),
    funnel: steps,
    sampled: { sids, total: toNum(f.entered) },
  }
}

/**
 * GET /api/ops/flows?depth=3 — path→path edges (+ '(exit)' edges from
 * sessions.exit_path) grouped in SQL, top-20 sequences from ≤ 1 000 newest
 * sessions' page_visits (≤ 5 000 rows) folded in JS, the entered → viewed
 * /contact → form focus → mail handoff funnel. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Flows> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
