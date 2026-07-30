import type { H3Event } from 'h3'
import { getDb } from './db'

const BOT_RE
  = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|python|curl|wget|scrapy|httpclient|node-fetch|axios/i

/** Empty UA or anything matching the crawler/tooling wordlist counts as a bot. */
export function isBotUA(ua: string | null | undefined): boolean {
  return !ua || ua.trim().length === 0 || BOT_RE.test(ua)
}

const HONEYPOT_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Mark an IP as a honeypot visitor for 24h and retro-flag its recent
 * sessions. Flags live in D1 (Workers isolates are many and short-lived,
 * so process memory can't hold them). Pass the STORAGE form of the IP
 * (getStorageIp) so the sessions.ip match works.
 */
export async function flagHoneypot(event: H3Event, ip: string): Promise<void> {
  if (!ip) return
  const now = Date.now()
  try {
    const db = getDb(event)
    await db.batch([
      db.prepare(
        'INSERT INTO honeypot_ips (ip, expires_at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET expires_at = excluded.expires_at',
      ).bind(ip, now + HONEYPOT_TTL_MS),
      db.prepare('UPDATE sessions SET is_bot = 1 WHERE ip = ? AND started_at >= ?').bind(ip, now - HONEYPOT_TTL_MS),
      db.prepare('DELETE FROM honeypot_ips WHERE expires_at <= ?').bind(now),
    ])
  } catch (err) {
    console.error('[bots] honeypot flag failed:', err)
  }
}

export async function isHoneypotFlagged(event: H3Event, ip: string): Promise<boolean> {
  if (!ip) return false
  try {
    const row = await getDb(event)
      .prepare('SELECT ip FROM honeypot_ips WHERE ip = ? AND expires_at > ?')
      .bind(ip, Date.now())
      .first()
    return row !== null
  } catch {
    return false
  }
}
