import type { FreqBucket, IntentCounts, VisitorSummary, Visitors } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, toNum, toStr } from '../../utils/opsDb'
import { activeSql, buildWhere, intParam, parseOpsQuery, parseWindow, sortSpec } from '../../utils/opsFilters'
import { TZ_DAY_MS } from '../../utils/opsTz'

const SORTS: Record<string, string> = {
  lastSeen: 'v.last_seen_at',
  visitCount: 'v.visit_count',
  totalActiveMs: 'totalActiveMs',
  intent: 'intent',
}

function freqBucketOf(visitCount: number): FreqBucket {
  if (visitCount <= 1) return '1'
  if (visitCount <= 3) return '2-3'
  if (visitCount <= 9) return '4-9'
  return '10+'
}

function intentCounts(r: Row): IntentCounts {
  const out: IntentCounts = {}
  const put = (k: keyof IntentCounts, v: number): void => {
    if (v > 0) out[k] = v
  }
  put('print', toNum(r.prints))
  put('copy', toNum(r.copies))
  put('email', toNum(r.emailCopies) + toNum(r.mailtoClicks))
  put('form', toNum(r.formStarted))
  put('submit', toNum(r.formSubmitted) + toNum(r.mailtoClicks))
  put('find', toNum(r.finds))
  put('search', toNum(r.searches))
  put('exit', toNum(r.exitIntents))
  put('rage', toNum(r.rage))
  put('dead', toNum(r.dead))
  put('error', toNum(r.errors))
  put('outbound', toNum(r.outbounds))
  put('egg', toNum(r.eggs))
  return out
}

/**
 * GET /api/ops/visitors?sort=lastSeen|visitCount|totalActiveMs|intent&dir=&limit=&offset= —
 * visitors JOIN sessions in range, grouped by vid (idx_sessions_vid_started);
 * `returning=1` → visit_count > 1. Offset paging (≤ 5 000). Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Visitors> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, async () => {
    const w = parseWindow(q)
    const db = getDb(event)
    const where = buildWhere(q, w, 's', { returning: false })
    const limit = intParam(q.limit, 50, 1, 200)
    const offset = intParam(q.offset, 0, 0, 5000)
    const sort = sortSpec(q, SORTS, 'lastSeen')
    const ret = q.returning === '1' ? ' AND v.visit_count > 1' : q.returning === '0' ? ' AND v.visit_count <= 1' : ''

    const res = await batchAll(db, [
      bindStmt(
        db,
        'SELECT v.vid, v.visit_count, v.first_seen_at, v.last_seen_at, v.first_as_org, v.last_as_org, v.first_country, v.last_country, v.first_referrer, v.first_entry_path, '
          + `COUNT(*) AS sessionsInRange, COALESCE(SUM(s.pageviews), 0) AS pagesRead, COALESCE(SUM(${activeSql('s')}), 0) AS totalActiveMs, MAX(s.has_replay) AS hasReplay, `
          + 'COALESCE(SUM(s.prints), 0) AS prints, COALESCE(SUM(s.copies), 0) AS copies, COALESCE(SUM(s.email_copies), 0) AS emailCopies, '
          + 'COALESCE(SUM(s.form_started), 0) AS formStarted, COALESCE(SUM(s.form_submitted), 0) AS formSubmitted, COALESCE(SUM(s.mailto_clicks), 0) AS mailtoClicks, '
          + 'COALESCE(SUM(s.finds), 0) AS finds, COALESCE(SUM(s.searches), 0) AS searches, COALESCE(SUM(s.exit_intents), 0) AS exitIntents, '
          + 'COALESCE(SUM(s.rage_clicks), 0) AS rage, COALESCE(SUM(s.dead_clicks), 0) AS dead, COALESCE(SUM(s.errors), 0) AS errors, '
          + 'COALESCE(SUM(s.outbounds), 0) AS outbounds, COALESCE(SUM(s.eggs), 0) AS eggs, '
          + 'COALESCE(SUM(s.prints + s.copies + s.email_copies + s.form_started + s.form_submitted + s.mailto_clicks + s.finds + s.searches + s.exit_intents + s.rage_clicks + s.dead_clicks + s.outbounds + s.eggs), 0) AS intent '
          + `FROM visitors v JOIN sessions s ON s.vid = v.vid WHERE ${where.sql}${ret} GROUP BY v.vid ORDER BY ${sort.col} ${sort.dir}, v.vid LIMIT ? OFFSET ?`,
        [...where.args, limit, offset],
      ),
      bindStmt(db, `SELECT COUNT(DISTINCT s.vid) AS n FROM sessions s JOIN visitors v ON v.vid = s.vid WHERE ${where.sql}${ret}`, where.args),
    ])
    const rows: VisitorSummary[] = (res[0] ?? []).map((r) => {
      const visitCount = toNum(r.visit_count)
      const lastSeen = toNum(r.last_seen_at)
      return {
        vid: String(r.vid),
        visitCount,
        firstSeen: toNum(r.first_seen_at),
        lastSeen,
        firstAsOrg: toStr(r.first_as_org),
        lastAsOrg: toStr(r.last_as_org),
        firstCountry: toStr(r.first_country),
        lastCountry: toStr(r.last_country),
        firstReferrer: toStr(r.first_referrer),
        firstEntryPath: toStr(r.first_entry_path),
        totalActiveMs: toNum(r.totalActiveMs),
        sessionsInRange: toNum(r.sessionsInRange),
        pagesRead: toNum(r.pagesRead),
        intent: intentCounts(r),
        hasReplay: toNum(r.hasReplay) === 1,
        recencyDays: Math.max(0, Math.floor((w.end - lastSeen) / TZ_DAY_MS)),
        freqBucket: freqBucketOf(visitCount),
      }
    })
    return { total: toNum(res[1]?.[0]?.n), rows, offset, limit }
  })
})
