import type { D1Database } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import { isPublicIp } from './ip'

/**
 * server/utils/rdns.ts — optional reverse DNS for the session IP (contract C.9).
 *
 * Only when `rdnsEnabled && !ipAnonymize` (a PTR of a zeroed octet is
 * meaningless, D4), only on a session's FIRST envelope, and at most one DoH
 * fetch per IP per day: answers (positive 7 d, negative 1 d) live in
 * `rdns_cache`. With the flag on, visitor IPs are sent to Cloudflare's public
 * DoH resolver — same vendor, different service; the docs say so.
 */

export const RDNS_POSITIVE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const RDNS_NEGATIVE_TTL_MS = 24 * 60 * 60 * 1000
const HOST_MAX = 120
const DOH_TIMEOUT_MS = 1500

/** `1.2.3.4` → `4.3.2.1.in-addr.arpa`; IPv6 → 32 reversed nibbles + `.ip6.arpa`; null when unparsable. */
export function reverseName(ip: string): string | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const octets = ip.split('.').map(Number)
    if (octets.some((o) => o > 255)) return null
    return `${octets.reverse().join('.')}.in-addr.arpa`
  }
  if (ip.includes(':')) {
    const nibbles = expandIpv6(ip)
    if (!nibbles) return null
    return `${nibbles.split('').reverse().join('.')}.ip6.arpa`
  }
  return null
}

/** Expand an abbreviated IPv6 address to its 32 hex nibbles (lowercase), or null. */
export function expandIpv6(ip: string): string | null {
  const head = ip.split('%')[0] as string
  if (!/^[0-9a-fA-F:.]+$/.test(head)) return null
  let body = head
  // Embedded IPv4 tail (::ffff:1.2.3.4) → two hex groups.
  const v4 = body.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (v4) {
    const o = (v4[1] as string).split('.').map(Number)
    if (o.some((x) => x > 255)) return null
    const hex = ((o[0] as number) << 8 | (o[1] as number)).toString(16) + ':' + ((o[2] as number) << 8 | (o[3] as number)).toString(16)
    body = body.slice(0, -(v4[1] as string).length) + hex
  }
  const parts = body.split('::')
  if (parts.length > 2) return null
  const left = parts[0] ? parts[0].split(':').filter((g) => g.length > 0) : []
  const right = parts.length === 2 && parts[1] ? parts[1].split(':').filter((g) => g.length > 0) : []
  const missing = 8 - left.length - right.length
  if (missing < 0 || (parts.length === 1 && missing !== 0)) return null
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((g) => g.length > 4)) return null
  return groups.map((g) => g.toLowerCase().padStart(4, '0')).join('')
}

/** Cache read for the first envelope of a session. `undefined` = miss (resolve), null = cached negative. */
export async function cachedRdns(db: D1Database, ip: string, now: number): Promise<string | null | undefined> {
  const row = await db
    .prepare('SELECT host FROM rdns_cache WHERE ip = ? AND expires_at > ?')
    .bind(ip, now)
    .first<{ host: string | null }>()
  if (!row) return undefined
  return row.host
}

interface DohAnswer {
  type?: number
  data?: string
}

/** One DoH PTR query (1 fetch subrequest). Null when there is no PTR / on any failure. */
export async function resolvePtr(ip: string): Promise<string | null> {
  const name = reverseName(ip)
  if (!name) return null
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=PTR`, {
    headers: { accept: 'application/dns-json' },
    signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
  })
  if (!res.ok) return null
  const json = (await res.json()) as { Answer?: DohAnswer[] }
  const ptr = json.Answer?.find((a) => a.type === 12)?.data
  if (typeof ptr !== 'string') return null
  const host = ptr.trim().replace(/\.$/, '').toLowerCase()
  if (host.length === 0 || !/^[a-z0-9._-]+$/.test(host)) return null
  return host.slice(0, HOST_MAX)
}

/** Resolve, cache (positive 7 d / negative 1 d) and back-fill `session_net.rdns_host` for `sid`. */
export async function resolveAndStore(db: D1Database, ip: string, sid: string): Promise<void> {
  let host: string | null = null
  try {
    host = await resolvePtr(ip)
  } catch (err) {
    console.warn('[rdns] lookup failed:', (err as Error)?.message ?? err)
  }
  const now = Date.now()
  const expires = now + (host ? RDNS_POSITIVE_TTL_MS : RDNS_NEGATIVE_TTL_MS)
  try {
    const stmts = [
      db.prepare('INSERT OR REPLACE INTO rdns_cache (ip, host, resolved_at, expires_at) VALUES (?, ?, ?, ?)').bind(ip, host, now, expires),
    ]
    if (host) stmts.push(db.prepare('UPDATE session_net SET rdns_host = ? WHERE sid = ? AND rdns_host IS NULL').bind(host, sid))
    await db.batch(stmts)
  } catch (err) {
    console.warn('[rdns] cache write failed:', (err as Error)?.message ?? err)
  }
}

/** Is rDNS worth attempting for this request / IP at all? */
export function rdnsApplies(event: H3Event, ip: string): boolean {
  const cfg = useRuntimeConfig(event)
  return Boolean(cfg.rdnsEnabled) && !cfg.ipAnonymize && isPublicIp(ip)
}

/**
 * Fire-and-forget resolution after the response (Workers `waitUntil` when
 * available, a detached promise locally). Never throws.
 */
export function scheduleRdns(event: H3Event, db: D1Database, ip: string, sid: string): void {
  const ctx = event.context as {
    waitUntil?: (p: Promise<unknown>) => void
    cloudflare?: { context?: { waitUntil?: (p: Promise<unknown>) => void } }
  }
  const waitUntil = ctx.waitUntil ?? ctx.cloudflare?.context?.waitUntil
  const p = resolveAndStore(db, ip, sid).catch((err) => console.warn('[rdns] failed:', err))
  if (typeof waitUntil === 'function') {
    try {
      waitUntil(p)
    } catch {
      /* detached */
    }
  }
}
