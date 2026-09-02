import type { H3Event } from 'h3'
import type { Intent, KN, OpsQuery, SessionRow } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../utils/opsDb'
import { anyIntentSql, buildWhere, foldStats, parseOpsQuery, parseWindow, prevWindow, sessionProjection, statsSql } from '../../utils/opsFilters'
import { TZ_HOUR_MS, dayStart } from '../../utils/opsTz'

const FORM_STEPS = ['focus', 'input', 'field', 'submit', 'invalid', 'reset', 'abandon']

function kn(rows: Row[]): KN[] {
  return rows.map((r) => ({ k: toStr(r.k) ?? '(unknown)', n: toNum(r.n) }))
}

async function build(event: H3Event, q: OpsQuery): Promise<Intent> {
  const now = Date.now()
  const w = parseWindow(q, now)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const compare = q.compare === '1' && w.range !== 'all'
  const wherePrev = buildWhere(q, prevWindow(w))
  const today = dayStart(w.tz, now)
  const tsFloor = Math.max(0, w.start - TZ_HOUR_MS)
  const ev = (type: string): string => `FROM events e JOIN sessions s ON s.sid = e.sid WHERE e.type = '${type}' AND e.ts >= ? AND ${where.sql}`
  const evArgs = [tsFloor, ...where.args]
  const page = "COALESCE(e.path, s.entry_path, '(unknown)')"

  const res = await batchAll(db, [
    /* 0 */ bindStmt(db, statsSql(where), [...where.args, today]),
    /* 1 */ compare ? bindStmt(db, statsSql(wherePrev), [...wherePrev.args, today]) : bindStmt(db, 'SELECT 1 AS x'),
    /* 2 */ bindStmt(db, `SELECT json_extract(e.payload, '$.step') AS step, COUNT(DISTINCT e.sid) AS sessions ${ev('form')} GROUP BY step`, evArgs),
    /* 3 */ bindStmt(
      db,
      `SELECT json_extract(e.payload, '$.subject') AS k, COUNT(DISTINCT e.sid) AS n ${ev('form')} `
        + "AND json_extract(e.payload, '$.step') IN ('field', 'submit') AND json_extract(e.payload, '$.subject') IS NOT NULL GROUP BY k ORDER BY n DESC LIMIT 20",
      evArgs,
    ),
    /* 4 */ bindStmt(
      db,
      `SELECT e.ts, e.sid, COALESCE(json_extract(e.payload, '$.snippet'), '') AS snippet, json_extract(e.payload, '$.hasEmail') AS hasEmail, `
        + `COALESCE(e.path, s.entry_path) AS path, json_extract(e.payload, '$.section') AS section, s.as_org AS org, s.country AS country `
        + `${ev('copy')} ORDER BY e.ts DESC LIMIT 100`,
      evArgs,
    ),
    /* 5 */ bindStmt(db, `SELECT json_extract(e.payload, '$.q') AS k, COUNT(*) AS n ${ev('site_search')} GROUP BY k ORDER BY n DESC LIMIT 30`, evArgs),
    /* 6 */ bindStmt(db, `SELECT ${page} AS k, COUNT(*) AS n ${ev('find')} GROUP BY k ORDER BY n DESC LIMIT 20`, evArgs),
    /* 7 */ bindStmt(
      db,
      `SELECT COALESCE(json_extract(e.payload, '$.sel'), '?') AS sel, '' AS text, COUNT(*) AS n ${ev('rage_click')} GROUP BY sel ORDER BY n DESC LIMIT 20`,
      evArgs,
    ),
    /* 8 */ bindStmt(
      db,
      `SELECT COALESCE(json_extract(e.payload, '$.sel'), '?') AS sel, COALESCE(json_extract(e.payload, '$.text'), '') AS text, COUNT(*) AS n `
        + `${ev('dead_click')} GROUP BY sel, text ORDER BY n DESC LIMIT 20`,
      evArgs,
    ),
    /* 9 */ bindStmt(db, `SELECT ${page} AS k, COUNT(*) AS n ${ev('exit_intent')} GROUP BY k ORDER BY n DESC LIMIT 20`, evArgs),
    /* 10 */ bindStmt(
      db,
      `SELECT COALESCE(e.name, '?') AS key, COUNT(*) AS n, COALESCE(AVG(CAST(json_extract(e.payload, '$.ms') AS REAL)), 0) AS avgMs `
        + `${ev('hover')} GROUP BY key ORDER BY n DESC LIMIT 20`,
      evArgs,
    ),
    /* 11 */ bindStmt(
      db,
      `SELECT e.ts, e.sid, COALESCE(e.path, s.entry_path) AS path, s.as_org AS org ${ev('print')} `
        + "AND COALESCE(json_extract(e.payload, '$.phase'), 'before') = 'before' ORDER BY e.ts DESC LIMIT 100",
      evArgs,
    ),
    /* 12 */ bindStmt(
      db,
      `SELECT ${sessionProjection('s')} FROM sessions s WHERE ${where.sql} AND ${anyIntentSql('s')} ORDER BY s.started_at DESC LIMIT 100`,
      where.args,
    ),
  ])
  const at = (i: number): Row[] => res[i] ?? []
  const cur = foldStats(res[0]?.[0])
  const steps = new Map(at(2).map((r) => [toStr(r.step) ?? '?', toNum(r.sessions)]))
  const known = new Set(FORM_STEPS)
  const formFunnel = [
    ...FORM_STEPS.map((step) => ({ step, sessions: steps.get(step) ?? 0 })),
    ...[...steps.entries()].filter(([s]) => !known.has(s)).map(([step, sessions]) => ({ step, sessions })),
  ]

  const out: Intent = {
    tiles: cur.intent,
    formFunnel,
    subjects: kn(at(3)),
    copies: at(4).map((r) => ({
      ts: toNum(r.ts),
      sid: String(r.sid),
      snippet: toStr(r.snippet) ?? '',
      hasEmail: toNum(r.hasEmail) === 1,
      path: toStr(r.path),
      section: toStr(r.section),
      org: toStr(r.org),
      country: toStr(r.country),
    })),
    searches: kn(at(5)),
    finds: kn(at(6)),
    rage: at(7).map((r) => ({ sel: toStr(r.sel) ?? '?', text: toStr(r.text) ?? '', n: toNum(r.n) })),
    dead: at(8).map((r) => ({ sel: toStr(r.sel) ?? '?', text: toStr(r.text) ?? '', n: toNum(r.n) })),
    exitByPage: kn(at(9)),
    hoverKeys: at(10).map((r) => ({ key: toStr(r.key) ?? '?', n: toNum(r.n), avgMs: Math.round(toNum(r.avgMs)) })),
    prints: at(11).map((r) => ({ ts: toNum(r.ts), sid: String(r.sid), path: toStr(r.path), org: toStr(r.org) })),
    sessions: at(12) as unknown as SessionRow[],
  }
  if (compare) out.prev = foldStats(res[1]?.[0]).intent
  return out
}

/**
 * GET /api/ops/intent — intent tiles (SUM of session counters, prev on
 * compare=1), the contact-form funnel by step (distinct sessions), subjects,
 * copies (≤ 100), site searches, find-in-page by path, rage / dead clicks by
 * selector, exit intents by page, hover keys, prints (≤ 100), and the newest
 * ≤ 100 sessions carrying any intent flag. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Intent> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
