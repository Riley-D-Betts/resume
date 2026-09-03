import type { H3Event } from 'h3'
import { getDb } from './db.ts'
import { HONEYPOT_CHECK_SQL } from './collectSql.ts'

// `facebookexternalhit`, `whatsapp`, `mastodon` and `pagerenderer` carry no
// `bot` / `crawl` / `preview` token of their own, so every one of them used to
// pass as a human browser. They are named preview fetchers
// (server/utils/previewAgents.ts) and automation either way.
const BOT_RE
  = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|python|curl|wget|scrapy|httpclient|node-fetch|axios|facebookexternalhit|whatsapp|mastodon|pagerenderer/i

/** Empty UA or anything matching the crawler/tooling wordlist counts as a bot. */
export function isBotUA(ua: string | null | undefined): boolean {
  return !ua || ua.trim().length === 0 || BOT_RE.test(ua)
}

/** The UA exactly as `sessions.ua` stores it (≤ 400), so the (ip, ua) keys match. */
export const UA_MAX = 400
export function normalizeUa(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  const s = raw.trim()
  return s.length > UA_MAX ? s.slice(0, UA_MAX) : s
}

export const HONEYPOT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Mark an (ip, ua) pair as a honeypot visitor for 24 h and retro-flag its
 * recent sessions (contract B15 / D26: keying on the UA too means one scanner
 * behind an office NAT no longer hides the office). Flags live in D1 —
 * Workers isolates are many and short-lived. Pass the STORAGE form of the IP
 * (getStorageIp) and the raw UA; both are normalised here the way
 * /api/collect stores them so the `sessions` match works.
 */
export async function flagHoneypot(event: H3Event, ip: string, ua: string): Promise<void> {
  const uaN = normalizeUa(ua)
  if (!ip || !uaN) return
  const now = Date.now()
  try {
    const db = getDb(event)
    await db.batch([
      db.prepare(
        'INSERT INTO honeypot_hits (ip, ua, expires_at) VALUES (?, ?, ?) ON CONFLICT(ip, ua) DO UPDATE SET expires_at = excluded.expires_at',
      ).bind(ip, uaN, now + HONEYPOT_TTL_MS),
      db.prepare('UPDATE sessions SET is_bot = 1 WHERE ip = ? AND ua = ? AND started_at >= ? AND is_bot = 0').bind(
        ip,
        uaN,
        now - HONEYPOT_TTL_MS,
      ),
    ])
  } catch (err) {
    console.error('[bots] honeypot flag failed:', err)
  }
}

/** Is this (ip, ua) currently flagged? Fails open (false) on a DB error. */
export async function isHoneypotFlagged(event: H3Event, ip: string, ua: string): Promise<boolean> {
  const uaN = normalizeUa(ua)
  if (!ip || !uaN) return false
  try {
    const row = await getDb(event).prepare(HONEYPOT_CHECK_SQL).bind(ip, uaN, Date.now()).first()
    return row !== null
  } catch {
    return false
  }
}
