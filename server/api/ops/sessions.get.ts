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

function intParam(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(v ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * GET /api/ops/sessions?range=…&bots=1&country=…&replay=1&limit=…&offset=…
 * Paged session listing, newest first.
 */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const q = getQuery(event)
  const limit = intParam(q.limit, 50, 1, 200)
  const offset = intParam(q.offset, 0, 0, Number.MAX_SAFE_INTEGER)

  const where: string[] = ['started_at >= ?']
  const args: (string | number)[] = [rangeStart(q.range)]
  if (q.bots !== '1') where.push('is_bot = 0')
  if (q.replay === '1') where.push('has_replay = 1')
  const country = typeof q.country === 'string' ? q.country.trim() : ''
  if (country) {
    // SQLite LIKE is case-insensitive for ASCII; ESCAPE guards user wildcards.
    where.push(`country LIKE ? ESCAPE '\\'`)
    args.push(`%${country.replace(/[\\%_]/g, m => `\\${m}`)}%`)
  }
  const cond = where.join(' AND ')

  const db = getDb()
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE ${cond}`).get(...args) as { n: number }
  ).n
  const rows = db
    .prepare(`SELECT * FROM sessions WHERE ${cond} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset) as Record<string, unknown>[]

  return { total, rows }
})
