import type { D1Database } from '@cloudflare/workers-types'
import { requireAdmin } from '../../utils/auth'

const DAY_MS = 86_400_000
const RANGE_MS: Record<string, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
}

function rangeStart(range: unknown): number {
  if (range === 'all') return 0
  const ms = (typeof range === 'string' && RANGE_MS[range]) || RANGE_MS['7d']!
  return Date.now() - ms
}

interface KN {
  k: string
  n: number
}

/** Top-12 breakdown of one sessions column within the range. */
async function top(db: D1Database, expr: string, start: number, bot: string): Promise<KN[]> {
  const { results } = await db
    .prepare(
      `SELECT ${expr} AS k, COUNT(*) AS n
       FROM sessions WHERE started_at >= ? ${bot}
       GROUP BY k ORDER BY n DESC LIMIT 12`,
    )
    .bind(start)
    .all<KN>()
  return results
}

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

const SCROLL_MILESTONES = [25, 50, 75, 90, 100]

/**
 * GET /api/ops/aggregates?range=…&bots=1
 * Breakdown tables + section dwell + scroll funnel + recent JS errors.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const q = getQuery(event)
  const start = rangeStart(q.range)
  const bot = q.bots === '1' ? '' : 'AND is_bot = 0'
  const botJoin = q.bots === '1' ? '' : 'AND s.is_bot = 0'
  const db = getDb(event)

  const [referrers, countries, cities, devices, browsers, languages, dwellRes, funnelRes, errorRes]
    = await Promise.all([
      top(db, `COALESCE(NULLIF(referrer, ''), '(direct)')`, start, bot),
      top(db, `COALESCE(NULLIF(country, ''), '??')`, start, bot),
      top(db, `COALESCE(NULLIF(city, ''), '??')`, start, bot),
      top(db, `COALESCE(NULLIF(device_type, ''), '??')`, start, bot),
      top(db, `COALESCE(NULLIF(browser, ''), '??')`, start, bot),
      top(db, `COALESCE(NULLIF(lang, ''), '??')`, start, bot),
      db.prepare(
        `SELECT e.name AS section,
                CAST(ROUND(AVG(CAST(json_extract(e.payload, '$.dwellMs') AS REAL))) AS INTEGER) AS avgMs,
                COUNT(*) AS n
         FROM events e JOIN sessions s ON s.sid = e.sid
         WHERE e.type = 'section_exit' AND e.name IS NOT NULL AND e.ts >= ? ${botJoin}
         GROUP BY e.name ORDER BY avgMs DESC`,
      )
        .bind(start)
        .all<{ section: string, avgMs: number, n: number }>(),
      db.prepare(
        `SELECT CAST(json_extract(e.payload, '$.pct') AS INTEGER) AS pct,
                COUNT(DISTINCT e.sid) AS sessions
         FROM events e JOIN sessions s ON s.sid = e.sid
         WHERE e.type = 'scroll_depth' AND e.ts >= ? ${botJoin}
         GROUP BY pct`,
      )
        .bind(start)
        .all<{ pct: number, sessions: number }>(),
      db.prepare(
        `SELECT e.ts AS ts, e.payload AS payload
         FROM events e JOIN sessions s ON s.sid = e.sid
         WHERE e.type = 'js_error' AND e.ts >= ? ${botJoin}
         ORDER BY e.ts DESC LIMIT 20`,
      )
        .bind(start)
        .all<{ ts: number, payload: string | null }>(),
    ])

  const byPct = new Map(funnelRes.results.map(r => [r.pct, r.sessions]))
  const scrollFunnel = SCROLL_MILESTONES.map(pct => ({ pct, sessions: byPct.get(pct) ?? 0 }))
  const errors = errorRes.results.map(r => ({ ts: r.ts, payload: parsePayload(r.payload) }))

  return {
    referrers,
    countries,
    cities,
    devices,
    browsers,
    languages,
    sectionDwell: dwellRes.results,
    scrollFunnel,
    errors,
  }
})
