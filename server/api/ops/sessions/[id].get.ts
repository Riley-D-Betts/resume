import { requireAdmin } from '../../../utils/auth'

function parsePayload(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

/** GET /api/ops/sessions/:id — full session row + its first 2000 events. */
export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const sid = getRouterParam(event, 'id') ?? ''
  const db = getDb()

  const session = db.prepare('SELECT * FROM sessions WHERE sid = ?').get(sid) as
    | Record<string, unknown>
    | undefined
  if (!session) {
    throw createError({ statusCode: 404, statusMessage: 'unknown session' })
  }

  const rows = db
    .prepare('SELECT ts, type, name, payload FROM events WHERE sid = ? ORDER BY ts LIMIT 2000')
    .all(sid) as { ts: number; type: string; name: string | null; payload: string | null }[]

  const events = rows.map(r => ({
    ts: r.ts,
    type: r.type,
    name: r.name,
    payload: parsePayload(r.payload),
  }))

  return { session, events }
})
