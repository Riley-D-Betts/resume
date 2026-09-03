/**
 * Sliding-window rate limiter, in-memory Map.
 * On Cloudflare Workers the counters are per-isolate, so the effective
 * limit is (limit × concurrent isolates) — looser than single-process but
 * still plenty to blunt abuse, and it costs no D1 reads on the hot path.
 * Counters reset when an isolate is recycled, which is fine for throttling.
 *
 * The map is BOUNDED (audit C2): expired windows are swept opportunistically
 * on insert (no timer — a Workers isolate may be frozen between requests) and
 * the oldest keys are evicted past MAX_KEYS, so a flood of distinct addresses
 * can no longer grow it without limit. IPv6 keys collapse to their /64 prefix,
 * the smallest block a single subscriber is normally given: keying the full
 * address let one host walk 2^64 addresses to get 2^64 fresh budgets.
 */

interface Window {
  hits: number[]
  windowMs: number
}

const windows = new Map<string, Window>()

/** Hard ceiling on tracked keys; the oldest inserted are evicted past it. */
export const MAX_KEYS = 5000
/** Sweep expired windows every N inserts (and always when the map is full). */
const SWEEP_EVERY = 64

let insertsSinceSweep = 0

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/
const IPV6_CHARS_RE = /^[0-9a-fA-F:]+$/

/**
 * The rate-limit identity of a client address: IPv4 as-is, IPv6 truncated to
 * its /64 prefix (`2001:db8:1:2::`). Idempotent — a already-truncated prefix
 * maps to itself. Anything that is not a bare address (a composite key such as
 * `<ip>|<sid>`) is returned unchanged; compose those from this function's
 * output instead.
 */
export function rateLimitKey(ip: string): string {
  if (!ip || IPV4_RE.test(ip)) return ip
  const head = ip.split('%')[0] as string // drop the zone index
  if (!head.includes(':') || !IPV6_CHARS_RE.test(head)) return ip
  const parts = head.split('::')
  if (parts.length > 2) return ip
  const left = parts[0] ? parts[0].split(':').filter((g) => g.length > 0) : []
  if (parts.length === 1) {
    // Fully written address: the first four groups are the /64.
    return left.length >= 4 ? `${left.slice(0, 4).map(normGroup).join(':')}::` : ip
  }
  const right = parts[1] ? parts[1].split(':').filter((g) => g.length > 0) : []
  const missing = 8 - left.length - right.length
  if (missing < 0) return ip
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  return `${groups.slice(0, 4).map(normGroup).join(':')}::`
}

/** Lowercase, no leading zeros — so `2001:0db8:…` and `2001:db8:…` share a bucket. */
function normGroup(g: string): string {
  const s = g.toLowerCase().replace(/^0+(?=.)/, '')
  return s.length === 0 ? '0' : s
}

/** Drop windows whose newest hit is older than their own window. */
function sweep(now: number): void {
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
  const now = Date.now()
  const id = `${bucket}:${rateLimitKey(key)}`
  let w = windows.get(id)
  if (!w) {
    if (++insertsSinceSweep >= SWEEP_EVERY || windows.size >= MAX_KEYS) {
      insertsSinceSweep = 0
      sweep(now)
    }
    // Still full after the sweep: evict the oldest inserted keys (Map keeps
    // insertion order) so the map can never exceed MAX_KEYS.
    while (windows.size >= MAX_KEYS) {
      const oldest = windows.keys().next().value
      if (oldest === undefined) break
      windows.delete(oldest)
    }
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

/** Test hook: forget every window (the module is a singleton per isolate). */
export function resetRateLimits(): void {
  windows.clear()
  insertsSinceSweep = 0
}

/** Test hook: how many windows are currently tracked. */
export function rateLimitSize(): number {
  return windows.size
}
