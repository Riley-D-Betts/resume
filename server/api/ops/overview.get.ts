import { requireAdmin } from '../../utils/auth'

const DAY_MS = 86_400_000
const RANGE_MS: Record<string, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
}

/** Start-of-range epoch-ms for ?range= (default 7d, 'all' → 0). */
function rangeStart(range: unknown): number {
  if (range === 'all') return 0
  const ms = (typeof range === 'string' && RANGE_MS[range]) || RANGE_MS['7d']!
  return Date.now() - ms
}

/** 'YYYY-MM-DD' in worker-local time (UTC on Cloudflare, matching SQLite 'localtime'). */
function localDay(t: number): string {
  const d = new Date(t)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * GET /api/ops/overview?range=24h|7d|30d|all&bots=1
 * Headline stats + 30-day series + top outbound + recent sessions.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const q = getQuery(event)
  const start = rangeStart(q.range)
  const bot = q.bots === '1' ? '' : 'AND is_bot = 0'
  const botJoin = q.bots === '1' ? '' : 'AND s.is_bot = 0'
  const db = getDb(event)
  const now = Date.now()

  const [visitsRow, activeRow, uniquesRow, avgRow, replay, dayRes, outboundRes, recentRes] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE started_at >= ? ${bot}`)
      .bind(new Date(now).setHours(0, 0, 0, 0))
      .first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE last_seen_at > ? ${bot}`)
      .bind(now - 60_000)
      .first<{ n: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT vid) AS n FROM sessions WHERE started_at >= ? ${bot}`)
      .bind(start)
      .first<{ n: number }>(),
    db.prepare(
      `SELECT CAST(COALESCE(ROUND(AVG(duration_ms)), 0) AS INTEGER) AS n
       FROM sessions WHERE started_at >= ? ${bot}`,
    )
      .bind(start)
      .first<{ n: number }>(),
    db.prepare(
      `SELECT COUNT(DISTINCT sid) AS count, CAST(COALESCE(SUM(bytes), 0) AS INTEGER) AS bytes
       FROM replay_chunks`,
    ).first<{ count: number, bytes: number }>(),
    db.prepare(
      `SELECT date(started_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS n
       FROM sessions WHERE started_at >= ? ${bot} GROUP BY day`,
    )
      .bind(now - 30 * DAY_MS)
      .all<{ day: string, n: number }>(),
    db.prepare(
      `SELECT COALESCE(e.name, '(unknown)') AS name, COUNT(*) AS n
       FROM events e JOIN sessions s ON s.sid = e.sid
       WHERE e.type = 'outbound' AND e.ts >= ? ${botJoin}
       GROUP BY e.name ORDER BY n DESC LIMIT 10`,
    )
      .bind(start)
      .all<{ name: string, n: number }>(),
    db.prepare(
      `SELECT sid, started_at, country, city, device_type, browser, duration_ms, has_replay
       FROM sessions WHERE 1 = 1 ${bot} ORDER BY started_at DESC LIMIT 8`,
    ).all<{
      sid: string
      started_at: number
      country: string | null
      city: string | null
      device_type: string | null
      browser: string | null
      duration_ms: number
      has_replay: number
    }>(),
  ])

  // -- sessions per local day, last 30 days, gaps filled with 0 ----------
  const byDay = new Map(dayRes.results.map(r => [r.day, r.n]))
  const series = Array.from({ length: 30 }, (_, i) => {
    const day = localDay(now - (29 - i) * DAY_MS)
    return { day, n: byDay.get(day) ?? 0 }
  })

  return {
    visitsToday: visitsRow!.n,
    activeNow: activeRow!.n,
    uniques: uniquesRow!.n,
    avgActiveMs: avgRow!.n,
    replay: replay!,
    series,
    topOutbound: outboundRes.results,
    recent: recentRes.results,
  }
})
