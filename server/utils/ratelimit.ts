/**
 * Sliding-window rate limiter, in-memory Map.
 * Single-process assumption: this deployment runs one Nitro node-server
 * process, so no shared store (Redis etc.) is needed. Counters reset on
 * restart, which is fine for abuse throttling.
 */

interface Window {
  hits: number[]
  windowMs: number
}

const windows = new Map<string, Window>()

const SWEEP_INTERVAL_MS = 5 * 60 * 1000
let sweepTimer: ReturnType<typeof setInterval> | null = null

function sweep(): void {
  const now = Date.now()
  for (const [key, w] of windows) {
    const newest = w.hits[w.hits.length - 1]
    if (newest === undefined || newest + w.windowMs <= now) windows.delete(key)
  }
}

/**
 * Returns true when the call is ALLOWED (and records it), false when the
 * key has exhausted `limit` calls within the trailing `windowMs`.
 */
export function rateLimit(bucket: string, key: string, limit: number, windowMs: number): boolean {
  if (!sweepTimer) {
    sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS)
    sweepTimer.unref?.()
  }

  const now = Date.now()
  const id = `${bucket}:${key}`
  let w = windows.get(id)
  if (!w) {
    w = { hits: [], windowMs }
    windows.set(id, w)
  }
  w.windowMs = windowMs

  const cutoff = now - windowMs
  while (w.hits.length > 0 && w.hits[0]! <= cutoff) w.hits.shift()

  if (w.hits.length >= limit) return false
  w.hits.push(now)
  return true
}
