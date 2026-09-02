import { EVENT_TYPES } from '../../../../../shared/analytics/events'
import type { EventRow, SessionEvents } from '../../../../../shared/analytics/ops'
import { requireAdmin } from '../../../../utils/auth'
import { getDb } from '../../../../utils/db'
import { intParam } from '../../../../utils/opsFilters'

const ID_RE = /^[0-9a-fA-F-]{16,64}$/
const ALL_TYPES = new Set<string>(EVENT_TYPES)

/**
 * GET /api/ops/sessions/:id/events?after=<event id>&limit=<≤2000, default 500>&types=a,b —
 * the LOAD MORE page: keyset `id > ?`, ORDER BY id (contract D8). Uncached.
 */
export default defineEventHandler(async (event): Promise<SessionEvents> => {
  await requireAdmin(event)
  const sid = getRouterParam(event, 'id') ?? ''
  if (!ID_RE.test(sid)) throw createError({ statusCode: 400, statusMessage: 'bad session id' })
  const raw = getQuery(event) as Record<string, unknown>
  const after = intParam(raw.after, 0, 0, Number.MAX_SAFE_INTEGER)
  const limit = intParam(raw.limit, 500, 1, 2000)
  const list =
    typeof raw.types === 'string'
      ? [...new Set(raw.types.split(',').map((t) => t.trim()).filter((t) => ALL_TYPES.has(t)))].slice(0, 31)
      : []
  const typeSql = list.length > 0 ? ` AND e.type IN (${list.map(() => '?').join(', ')})` : ''

  const { results } = await getDb(event)
    .prepare(`SELECT e.id, e.ts, e.type, e.name, e.path, e.payload FROM events e WHERE e.sid = ? AND e.id > ?${typeSql} ORDER BY e.id LIMIT ?`)
    .bind(sid, after, ...list, limit + 1)
    .all<EventRow>()
  const events = results.slice(0, limit)
  const last = events[events.length - 1]
  return { events, nextAfter: results.length > limit && last ? last.id : null }
})
