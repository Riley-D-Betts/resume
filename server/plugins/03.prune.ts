import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const DAY_MS = 24 * 60 * 60 * 1000
const REPLAY_CAP_BYTES = 2 * 1024 * 1024 * 1024 // 2GB total for the replays dir

function chunkFile(replaysDir: string, sid: string, seq: number, compressed: number): string {
  return join(replaysDir, sid, `${String(seq).padStart(5, '0')}${compressed ? '.json.gz' : '.json'}`)
}

function rmIfEmpty(dir: string): void {
  try {
    if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true })
  } catch {
    // already gone — fine
  }
}

function pruneOnce(): void {
  try {
    const db = getDb()
    const cfg = useRuntimeConfig()
    const now = Date.now()
    const replaysDir = join(getDataDir(), 'replays')

    // 1. Replay chunks past retention: delete files, then rows.
    const replayCutoff = now - Number(cfg.replayRetentionDays) * DAY_MS
    const expired = db
      .prepare('SELECT sid, seq, compressed FROM replay_chunks WHERE created_at < ?')
      .all(replayCutoff) as Array<{ sid: string, seq: number, compressed: number }>
    for (const row of expired) {
      try {
        unlinkSync(chunkFile(replaysDir, row.sid, row.seq, row.compressed))
      } catch {
        // file already missing — keep going
      }
    }
    db.prepare('DELETE FROM replay_chunks WHERE created_at < ?').run(replayCutoff)
    for (const sid of new Set(expired.map(r => r.sid))) rmIfEmpty(join(replaysDir, sid))

    // 2. Events past retention.
    const eventCutoff = now - Number(cfg.eventRetentionDays) * DAY_MS
    const eventsGone = db.prepare('DELETE FROM events WHERE ts < ?').run(eventCutoff).changes

    // 3. Enforce the total disk cap: walk the replays dir (covers orphan files
    //    too), oldest session dirs die first until we fit under the cap.
    let capDeleted = 0
    if (existsSync(replaysDir)) {
      const dirs: Array<{ sid: string, size: number, oldest: number }> = []
      for (const entry of readdirSync(replaysDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(replaysDir, entry.name)
        let size = 0
        let oldest = Number.POSITIVE_INFINITY
        for (const f of readdirSync(dir)) {
          try {
            const st = statSync(join(dir, f))
            if (!st.isFile()) continue
            size += st.size
            if (st.mtimeMs < oldest) oldest = st.mtimeMs
          } catch {
            // raced with a delete — skip
          }
        }
        dirs.push({ sid: entry.name, size, oldest })
      }
      let total = dirs.reduce((sum, d) => sum + d.size, 0)
      dirs.sort((a, b) => a.oldest - b.oldest)
      for (const d of dirs) {
        if (total <= REPLAY_CAP_BYTES) break
        rmSync(join(replaysDir, d.sid), { recursive: true, force: true })
        db.prepare('DELETE FROM replay_chunks WHERE sid = ?').run(d.sid)
        total -= d.size
        capDeleted++
      }
    }

    // 4. Clear has_replay on sessions whose chunks are all gone.
    db.prepare(
      'UPDATE sessions SET has_replay = 0 WHERE has_replay = 1 AND sid NOT IN (SELECT DISTINCT sid FROM replay_chunks)',
    ).run()

    db.pragma('wal_checkpoint(TRUNCATE)')

    console.log(
      `[prune] ok: ${expired.length} expired replay chunks, ${eventsGone} old events, ${capDeleted} sessions evicted for disk cap`,
    )
  } catch (err) {
    console.error('[prune] failed:', err)
  }
}

export default defineNitroPlugin(() => {
  pruneOnce()
  const timer = setInterval(pruneOnce, DAY_MS)
  timer.unref?.()
})
