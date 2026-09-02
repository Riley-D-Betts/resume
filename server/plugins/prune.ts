import type { D1Database, D1PreparedStatement, D1Result, R2Bucket } from '@cloudflare/workers-types'
import type { CfBindings } from '../utils/db'
import { REPLAY_PREFIX, parseReplayKey, replayKey, replayKeyPair, sessionPrefix } from '../utils/replayKeys'

/**
 * Retention pruning, fired by the daily cron trigger in wrangler.jsonc
 * (Cloudflare invokes the worker's scheduled() export; nitro surfaces it as
 * the cloudflare:scheduled hook). Contract F.1 + plan deltas A20 / A21 / A34.
 *
 * Workers Free gives a cron invocation 50 subrequests (every D1 call, R2 call
 * and fetch counts). A budget counter wraps every call and stops the run
 * cleanly at 40, logging what was carried over to the next night; every loop
 * is bounded to ≤ 8 iterations; every step logs `changes` / `rows_read` and
 * runs in its own try/catch so one failure never skips the rest.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const BAND_MS = 48 * HOUR_MS
const REPLAY_CAP_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB total for replay chunks
const SUBREQUEST_BUDGET = 40
const MAX_LOOP = 8
const PENDING_GRACE_MS = 10 * 60 * 1000
const MIN_BANDS = 2

/** Subrequest ledger: stops the run at the budget and records the carry-over. */
class Budget {
  used = 0
  readonly carry: string[] = []
  take(label: string): boolean {
    if (this.used >= SUBREQUEST_BUDGET) {
      if (!this.carry.includes(label)) this.carry.push(label)
      return false
    }
    this.used++
    return true
  }
}

class BudgetExhausted extends Error {
  constructor(label: string) {
    super(`subrequest budget exhausted at ${label}`)
  }
}

interface Meta {
  changes: number
  rows_read: number
}

function meta(r: { meta?: { changes?: number; rows_read?: number } } | null | undefined): Meta {
  return { changes: r?.meta?.changes ?? 0, rows_read: r?.meta?.rows_read ?? 0 }
}

function log(step: string, m: Meta, extra = ''): void {
  console.log(`[prune] ${step}: changes=${m.changes} rows_read=${m.rows_read}${extra ? ' ' + extra : ''}`)
}

interface Ctx {
  db: D1Database
  bucket: R2Bucket
  budget: Budget
  now: number
}

async function run(ctx: Ctx, label: string, stmt: D1PreparedStatement): Promise<D1Result> {
  if (!ctx.budget.take(label)) throw new BudgetExhausted(label)
  return await stmt.run()
}

async function all<T>(ctx: Ctx, label: string, stmt: D1PreparedStatement): Promise<D1Result<T>> {
  if (!ctx.budget.take(label)) throw new BudgetExhausted(label)
  return await stmt.all<T>()
}

async function batch(ctx: Ctx, label: string, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  if (stmts.length === 0) return []
  if (!ctx.budget.take(label)) throw new BudgetExhausted(label)
  return await ctx.db.batch(stmts)
}

/** R2 bulk delete takes at most 1000 keys per call (each call = 1 subrequest). */
async function deleteKeys(ctx: Ctx, label: string, keys: string[]): Promise<number> {
  let n = 0
  for (let i = 0; i < keys.length; i += 1000) {
    const slice = keys.slice(i, i + 1000)
    if (!ctx.budget.take(label)) throw new BudgetExhausted(label)
    await ctx.bucket.delete(slice)
    n += slice.length
  }
  return n
}

function sumMeta(rs: D1Result[]): Meta {
  return rs.reduce<Meta>((acc, r) => ({ changes: acc.changes + meta(r).changes, rows_read: acc.rows_read + meta(r).rows_read }), {
    changes: 0,
    rows_read: 0,
  })
}

/** Run `step` in isolation: a failure is logged, a budget stop re-thrown to end the run. */
async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (err) {
    if (err instanceof BudgetExhausted) {
      console.warn(`[prune] ${name}: ${err.message} — carried over to the next run`)
      return false
    }
    console.error(`[prune] ${name} failed:`, err)
    return true
  }
}

/**
 * Delete by rolling 48 h session bands below `cutoff`: band k covers
 * [cutoff − 48 h·(k+1), cutoff − 48 h·k). Always ≥ MIN_BANDS, then continues
 * (≤ MAX_LOOP) while a band still deleted something, so a missed night drains
 * over the following runs.
 */
async function bands(ctx: Ctx, label: string, cutoff: number, make: (lo: number, hi: number) => D1PreparedStatement[]): Promise<void> {
  const total: Meta = { changes: 0, rows_read: 0 }
  let k = 0
  for (; k < MAX_LOOP; k++) {
    const hi = cutoff - BAND_MS * k
    const lo = hi - BAND_MS
    const m = sumMeta(await batch(ctx, label, make(lo, hi)))
    total.changes += m.changes
    total.rows_read += m.rows_read
    if (k + 1 >= MIN_BANDS && m.changes === 0) break
  }
  log(label, total, `bands=${Math.min(k + 1, MAX_LOOP)}`)
}

interface ChunkRow {
  sid: string
  rid: string
  seq: number
  compressed: number
  created_at: number
}

async function pruneOnce(env: CfBindings): Promise<void> {
  const cfg = useRuntimeConfig()
  const ctx: Ctx = { db: env.DB, bucket: env.REPLAYS, budget: new Budget(), now: Date.now() }
  const { db, now } = ctx
  const days = (v: unknown): number => Math.max(0, Number(v) || 0)
  const replayCutoff = now - days(cfg.replayRetentionDays) * DAY_MS
  const eventCutoff = now - days(cfg.eventRetentionDays) * DAY_MS
  const sideCutoff = now - days(cfg.sideTableRetentionDays) * DAY_MS
  const piiCutoff = now - days(cfg.piiRetentionDays) * DAY_MS
  const sessionDays = days(cfg.sessionRetentionDays)

  const steps: Array<[string, () => Promise<void>]> = [
    // 1. Replay chunks past retention (v2 ledger, both key layouts).
    ['replay_retention', async () => {
      const total: Meta = { changes: 0, rows_read: 0 }
      let objects = 0
      for (let i = 0; i < MAX_LOOP; i++) {
        const res = await all<ChunkRow>(
          ctx,
          'replay_retention',
          db.prepare('SELECT sid, rid, seq, compressed, created_at FROM replay_chunks_v2 WHERE created_at < ? ORDER BY created_at LIMIT 1000').bind(replayCutoff),
        )
        total.rows_read += meta(res).rows_read
        const rows = res.results
        if (rows.length === 0) break
        objects += await deleteKeys(ctx, 'replay_retention', rows.map((r) => replayKey(r.sid, r.rid, r.seq, r.compressed)))
        // Rows sharing the last created_at beyond the LIMIT lose their row
        // first; their objects are caught by the orphan_objects sweep.
        const upTo = rows[rows.length - 1]!.created_at
        const del = await run(ctx, 'replay_retention', db.prepare('DELETE FROM replay_chunks_v2 WHERE created_at <= ?').bind(upTo))
        total.changes += meta(del).changes
        total.rows_read += meta(del).rows_read
        if (rows.length < 1000) break
      }
      log('replay_retention', total, `objects=${objects}`)
    }],
    // 2. Events past eventRetentionDays, via session bands (idx_sessions_started + idx_events_sid_ts).
    ['events_retention', () => bands(ctx, 'events_retention', eventCutoff, (lo, hi) => [
      db.prepare('DELETE FROM events WHERE sid IN (SELECT sid FROM sessions WHERE started_at >= ? AND started_at < ?)').bind(lo, hi),
    ])],
    // 3. page_perf past eventRetentionDays (idx_page_perf_ts).
    ['page_perf_retention', () => bands(ctx, 'page_perf_retention', eventCutoff, (lo, hi) => [
      db.prepare('DELETE FROM page_perf WHERE ts >= ? AND ts < ?').bind(lo, hi),
    ])],
    // 4. Side tables past sideTableRetentionDays.
    ['side_tables_retention', () => bands(ctx, 'side_tables_retention', sideCutoff, (lo, hi) => [
      db.prepare('DELETE FROM page_visits WHERE sid IN (SELECT sid FROM sessions WHERE started_at >= ? AND started_at < ?)').bind(lo, hi),
      db.prepare('DELETE FROM session_env WHERE sid IN (SELECT sid FROM sessions WHERE started_at >= ? AND started_at < ?)').bind(lo, hi),
      db.prepare('DELETE FROM session_net WHERE sid IN (SELECT sid FROM sessions WHERE started_at >= ? AND started_at < ?)').bind(lo, hi),
    ])],
    // 5. Replay storage cap: oldest sessions die first until under 2 GB.
    ['replay_cap', async () => {
      const res = await all<{ sid: string; size: number; oldest: number }>(
        ctx,
        'replay_cap',
        db.prepare('SELECT sid, SUM(bytes) AS size, MIN(created_at) AS oldest FROM replay_chunks_v2 GROUP BY sid ORDER BY oldest'),
      )
      let total = res.results.reduce((sum, d) => sum + d.size, 0)
      const changes: Meta = { changes: 0, rows_read: meta(res).rows_read }
      let evicted = 0
      for (const d of res.results) {
        if (total <= REPLAY_CAP_BYTES || evicted >= MAX_LOOP) break
        let cursor: string | undefined
        let pages = 0
        do {
          if (!ctx.budget.take('replay_cap')) throw new BudgetExhausted('replay_cap')
          const listing = await ctx.bucket.list({ prefix: sessionPrefix(d.sid), cursor, limit: 1000 })
          await deleteKeys(ctx, 'replay_cap', listing.objects.map((o) => o.key))
          cursor = listing.truncated ? listing.cursor : undefined
        } while (cursor && ++pages < MAX_LOOP)
        const del = await run(ctx, 'replay_cap', db.prepare('DELETE FROM replay_chunks_v2 WHERE sid = ?').bind(d.sid))
        changes.changes += meta(del).changes
        total -= d.size
        evicted++
      }
      log('replay_cap', changes, `evicted=${evicted} total_bytes=${total}`)
    }],
    // 6. Clear has_replay on sessions whose completed chunks are all gone.
    ['has_replay_clear', async () => {
      const r = await run(
        ctx,
        'has_replay_clear',
        db.prepare(
          'UPDATE sessions SET has_replay = 0 WHERE has_replay = 1 AND NOT EXISTS (SELECT 1 FROM replay_chunks_v2 r WHERE r.sid = sessions.sid AND r.pending = 0)',
        ),
      )
      log('has_replay_clear', meta(r))
    }],
    // 7. Honeypot expiry (new (ip, ua) table + legacy honeypot_ips).
    ['honeypot_expiry', async () => {
      const rs = await batch(ctx, 'honeypot_expiry', [
        db.prepare('DELETE FROM honeypot_hits WHERE expires_at <= ?').bind(now),
        db.prepare('DELETE FROM honeypot_ips WHERE expires_at <= ?').bind(now),
      ])
      log('honeypot_expiry', sumMeta(rs))
    }],
    // 8. rDNS cache expiry.
    ['rdns_expiry', async () => {
      const r = await run(ctx, 'rdns_expiry', db.prepare('DELETE FROM rdns_cache WHERE expires_at <= ?').bind(now))
      log('rdns_expiry', meta(r))
    }],
    // 9. PII scrub (delta A20): ip / ua / lat / lon nulled past piiRetentionDays, ≤ 500 rows per statement.
    ['pii_scrub', async () => {
      const total: Meta = { changes: 0, rows_read: 0 }
      for (let i = 0; i < MAX_LOOP; i++) {
        const r = await run(
          ctx,
          'pii_scrub',
          db.prepare(
            `UPDATE sessions SET ip = NULL, ua = NULL, lat = NULL, lon = NULL
             WHERE sid IN (SELECT sid FROM sessions WHERE started_at < ?
                           AND (ip IS NOT NULL OR ua IS NOT NULL OR lat IS NOT NULL OR lon IS NOT NULL) LIMIT 500)`,
          ).bind(piiCutoff),
        )
        const m = meta(r)
        total.changes += m.changes
        total.rows_read += m.rows_read
        if (m.changes < 500) break
      }
      log('pii_scrub', total)
    }],
    // 10a. Orphan sweep: pending rows older than 10 min (put never completed or the flip failed).
    ['orphan_pending', async () => {
      const res = await all<ChunkRow>(
        ctx,
        'orphan_pending',
        db.prepare('SELECT sid, rid, seq, compressed, created_at FROM replay_chunks_v2 WHERE pending = 1 AND created_at < ? LIMIT 200').bind(now - PENDING_GRACE_MS),
      )
      const total: Meta = { changes: 0, rows_read: meta(res).rows_read }
      if (res.results.length > 0) {
        // The object may or may not exist; delete both twins to be sure.
        await deleteKeys(ctx, 'orphan_pending', res.results.flatMap((r) => replayKeyPair(r.sid, r.rid, r.seq)))
        const del = await run(ctx, 'orphan_pending', db.prepare('DELETE FROM replay_chunks_v2 WHERE pending = 1 AND created_at < ?').bind(now - PENDING_GRACE_MS))
        total.changes += meta(del).changes
      }
      log('orphan_pending', total, `rows=${res.results.length}`)
    }],
    // 10b. Orphan sweep: one bounded list pass over replays/ from a random
    //      start (keys are UUID-led, so successive nights cover the space);
    //      objects with no ledger row are deleted, stale twins too.
    ['orphan_objects', async () => {
      if (!ctx.budget.take('orphan_objects')) throw new BudgetExhausted('orphan_objects')
      const startAfter = `${REPLAY_PREFIX}${Math.floor(Math.random() * 16).toString(16)}`
      const listing = await ctx.bucket.list({ prefix: REPLAY_PREFIX, limit: 500, startAfter })
      const candidates = listing.objects
        .map((o) => ({ key: o.key, uploaded: o.uploaded, parsed: parseReplayKey(o.key) }))
        .filter((o) => o.parsed !== null && o.uploaded.getTime() < now - PENDING_GRACE_MS)
      const sids = [...new Set(candidates.map((o) => o.parsed!.sid))]
      const known = new Map<string, { compressed: number; pending: number }>()
      let rowsRead = 0
      for (let i = 0; i < sids.length; i += 90) {
        const slice = sids.slice(i, i + 90)
        const res = await all<{ sid: string; rid: string; seq: number; compressed: number; pending: number }>(
          ctx,
          'orphan_objects',
          db.prepare(`SELECT sid, rid, seq, compressed, pending FROM replay_chunks_v2 WHERE sid IN (${slice.map(() => '?').join(', ')})`).bind(...slice),
        )
        rowsRead += meta(res).rows_read
        for (const r of res.results) known.set(`${r.sid}/${r.rid}/${r.seq}`, { compressed: r.compressed, pending: r.pending })
      }
      const orphans: string[] = []
      for (const o of candidates) {
        const p = o.parsed!
        const row = known.get(`${p.sid}/${p.rid}/${p.seq}`)
        if (!row) orphans.push(o.key)
        else if (row.pending === 0 && Boolean(row.compressed) !== p.compressed) orphans.push(o.key) // stale twin
      }
      const deleted = await deleteKeys(ctx, 'orphan_objects', orphans)
      log('orphan_objects', { changes: deleted, rows_read: rowsRead }, `listed=${listing.objects.length} sids=${sids.length}`)
    }],
    // 11. Whole-session deletion when sessionRetentionDays > 0: ≤ 100 per run,
    //     children first, only sessions whose replay chunks are already gone
    //     (step 1 removes them well before, so no R2 calls are needed here).
    //     ≈ 55 events + 3 page_visits + 3 page_perf + net + env + session ≈ 65
    //     rows deleted (× index entries ≈ 190 rows written) per session.
    ['session_retention', async () => {
      if (sessionDays <= 0) return
      const cutoff = now - sessionDays * DAY_MS
      const pick = `SELECT sid FROM sessions WHERE started_at < ? AND NOT EXISTS (SELECT 1 FROM replay_chunks_v2 r WHERE r.sid = sessions.sid) ORDER BY started_at LIMIT 100`
      const rs = await batch(ctx, 'session_retention', [
        db.prepare(`DELETE FROM events WHERE sid IN (${pick})`).bind(cutoff),
        db.prepare(`DELETE FROM page_visits WHERE sid IN (${pick})`).bind(cutoff),
        db.prepare(`DELETE FROM page_perf WHERE sid IN (${pick})`).bind(cutoff),
        db.prepare(`DELETE FROM session_env WHERE sid IN (${pick})`).bind(cutoff),
        db.prepare(`DELETE FROM session_net WHERE sid IN (${pick})`).bind(cutoff),
        db.prepare(`DELETE FROM sessions WHERE sid IN (${pick})`).bind(cutoff),
      ])
      log('session_retention', sumMeta(rs), `sessions=${meta(rs[rs.length - 1]).changes}`)
    }],
    // 12. Visitors with no sessions (delta A34), ≤ 500 per run.
    ['visitor_orphans', async () => {
      const r = await run(
        ctx,
        'visitor_orphans',
        db.prepare(
          `DELETE FROM visitors WHERE vid IN (
             SELECT v.vid FROM visitors v WHERE v.last_seen_at < ? AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.vid = v.vid) LIMIT 500)`,
        ).bind(now - DAY_MS),
      )
      log('visitor_orphans', meta(r))
    }],
  ]

  const started = Date.now()
  for (const [name, fn] of steps) {
    const keepGoing = await step(name, fn)
    if (!keepGoing) break
  }
  const b = ctx.budget
  console.log(
    `[prune] done in ${Date.now() - started} ms: subrequests=${b.used}/${SUBREQUEST_BUDGET}${b.carry.length ? ` carry-over=${b.carry.join(',')}` : ''}`,
  )
}

interface ScheduledHookArgs {
  env: CfBindings
  context: { waitUntil: (p: Promise<unknown>) => void }
}

export default defineNitroPlugin((nitroApp) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(nitroApp.hooks.hook as any)('cloudflare:scheduled', ({ env, context }: ScheduledHookArgs) => {
    context.waitUntil(pruneOnce(env).catch((err) => console.error('[prune] failed:', err)))
  })
})
