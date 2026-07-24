import { getDb } from './db'

const BOT_RE
  = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|python|curl|wget|scrapy|httpclient|node-fetch|axios/i

/** Empty UA or anything matching the crawler/tooling wordlist counts as a bot. */
export function isBotUA(ua: string | null | undefined): boolean {
  return !ua || ua.trim().length === 0 || BOT_RE.test(ua)
}

const HONEYPOT_TTL_MS = 24 * 60 * 60 * 1000

// ip → expiresAt (epoch ms). In-memory on purpose: single-process deployment,
// and a honeypot flag that dies with the process is acceptable.
const flagged = new Map<string, number>()

function sweep(now: number): void {
  for (const [ip, expires] of flagged) {
    if (expires <= now) flagged.delete(ip)
  }
}

/**
 * Mark an IP as a honeypot visitor for 24h and retro-flag its recent sessions.
 * Pass the STORAGE form of the IP (getStorageIp) so the sessions.ip match works.
 */
export function flagHoneypot(ip: string): void {
  if (!ip) return
  const now = Date.now()
  flagged.set(ip, now + HONEYPOT_TTL_MS)
  try {
    getDb()
      .prepare('UPDATE sessions SET is_bot = 1 WHERE ip = ? AND started_at >= ?')
      .run(ip, now - HONEYPOT_TTL_MS)
  } catch (err) {
    console.error('[bots] honeypot session flag failed:', err)
  }
  sweep(now)
}

export function isHoneypotFlagged(ip: string): boolean {
  const expires = flagged.get(ip)
  if (expires === undefined) return false
  if (expires <= Date.now()) {
    flagged.delete(ip)
    return false
  }
  return true
}
