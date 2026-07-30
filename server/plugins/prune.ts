import type { R2Bucket } from '@cloudflare/workers-types'
import type { CfBindings } from '../utils/db'

/**
 * Retention pruning, fired by the daily cron trigger in wrangler.jsonc
 * (Cloudflare invokes the worker's scheduled() export; nitro surfaces it
 * as the cloudflare:scheduled hook).
 */

const DAY_MS = 24 * 60 * 60 * 1000
const REPLAY_CAP_BYTES = 2 * 1024 * 1024 * 1024 // 2GB total for replay chunks

function chunkKey(sid: string, seq: number, compressed: number): string {
  return `replays/${sid}/${String(seq).padStart(5, '0')}${compressed ? '.json.gz' : '.json'}`
}

/** R2 bulk delete takes at most 1000 keys per call. */
async function deleteKeys(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await bucket.delete(keys.slice(i, i + 1000))
  }
}

async function pruneOnce(env: CfBindings): Promise<void> {
  try {
    const cfg = useRuntimeConfig()
    const db = env.DB
    const now = Date.now()

    // 1. Replay chunks past retention: delete R2 objects, then rows.
    const replayCutoff = now - Number(cfg.replayRetentionDays) * DAY_MS
    const { results: expired } = await db
      .prepare('SELECT sid, seq, compressed FROM replay_chunks WHERE created_at < ?')
      .bind(replayCutoff)
      .all<{ sid: string, seq: number, compressed: number }>()
    await deleteKeys(env.REPLAYS, expired.map(r => chunkKey(r.sid, r.seq, r.compressed)))
    await db.prepare('DELETE FROM replay_chunks WHERE created_at < ?').bind(replayCutoff).run()

    // 2. Events past retention.
    const eventCutoff = now - Number(cfg.eventRetentionDays) * DAY_MS
    const eventsGone = (await db.prepare('DELETE FROM events WHERE ts < ?').bind(eventCutoff).run()).meta.changes

    // 3. Enforce the total storage cap from the accounting table (R2 has no
    //    cheap recursive stat): oldest sessions die first until under cap.
    //    The list+delete sweeps stale twins and orphans under the prefix too.
    const { results: perSession } = await db
      .prepare('SELECT sid, SUM(bytes) AS size, MIN(created_at) AS oldest FROM replay_chunks GROUP BY sid ORDER BY oldest')
      .all<{ sid: string, size: number, oldest: number }>()
    let total = perSession.reduce((sum, d) => sum + d.size, 0)
    let capDeleted = 0
    for (const d of perSession) {
      if (total <= REPLAY_CAP_BYTES) break
      let cursor: string | undefined
      do {
        const listing = await env.REPLAYS.list({ prefix: `replays/${d.sid}/`, cursor })
        await deleteKeys(env.REPLAYS, listing.objects.map(o => o.key))
        cursor = listing.truncated ? listing.cursor : undefined
      } while (cursor)
      await db.prepare('DELETE FROM replay_chunks WHERE sid = ?').bind(d.sid).run()
      total -= d.size
      capDeleted++
    }

    // 4. Clear has_replay on sessions whose chunks are all gone.
    await db
      .prepare('UPDATE sessions SET has_replay = 0 WHERE has_replay = 1 AND sid NOT IN (SELECT DISTINCT sid FROM replay_chunks)')
      .run()

    // 5. Expired honeypot flags.
    await db.prepare('DELETE FROM honeypot_ips WHERE expires_at <= ?').bind(now).run()

    console.log(
      `[prune] ok: ${expired.length} expired replay chunks, ${eventsGone} old events, ${capDeleted} sessions evicted for storage cap`,
    )
  } catch (err) {
    console.error('[prune] failed:', err)
  }
}

interface ScheduledHookArgs {
  env: CfBindings
  context: { waitUntil: (p: Promise<unknown>) => void }
}

export default defineNitroPlugin((nitroApp) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(nitroApp.hooks.hook as any)('cloudflare:scheduled', ({ env, context }: ScheduledHookArgs) => {
    context.waitUntil(pruneOnce(env))
  })
})
