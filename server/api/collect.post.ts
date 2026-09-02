import { ESSENTIAL_TYPES, SESSION_EVENT_CAP } from '#shared/analytics/events'
import {
  EVENTS_ROWS_PER_STATEMENT,
  HEARTBEAT_MS,
  HONEYPOT_CHECK_SQL,
  IP_CAP_SQL,
  PAGE_PERF_SQL,
  PAGE_VISITS_SQL,
  PRECHECK_SQL,
  SESSION_ENV_SQL,
  SESSION_NET_SQL,
  SESSION_SQL,
  VISITORS_SQL,
  eventsSql,
} from '../utils/collectSql'
import { buildCollectBinds } from '../utils/collectBind'
import { bindChecked } from '../utils/d1'
import { readCf, readHeaders } from '../utils/cf'
import { isEmptyEnvelope, parseEnvelope, MAX_BODY_BYTES, type CleanEvent } from '../utils/sanitize'
import { isBotUA, normalizeUa } from '../utils/bots'
import { parseUA } from '../utils/ua'
import { offsetMin } from '../utils/tz'
import { cachedRdns, rdnsApplies, scheduleRdns } from '../utils/rdns'
import { setReplayTokenCookie } from '../utils/replayAuth'

/**
 * POST /api/collect — the analytics ingest (contract C.1–C.5 + plan deltas).
 *
 * Statuses: 204 accepted (also for GPC/DNT-honoured drops and empty
 * envelopes); 400 malformed; 413 body > 256 KiB; 429 rate limit (120/min per
 * IP) or a NEW sid from an IP that already started ≥ 300 sessions today;
 * 500 D1 failure. Every 204 for a stored session refreshes the `rb_rt`
 * replay-upload cookie (delta A7).
 *
 * Subrequests: 1 pre-check batch (session row + honeypot) [+1 IP cap, +1
 * rDNS cache read on a new sid] + 1 atomic write batch.
 */

const ESSENTIAL = new Set<string>(ESSENTIAL_TYPES)
const DAY_MS = 24 * 60 * 60 * 1000
const IP_SESSIONS_PER_DAY = 300
const HEARTBEAT_FALLBACK_WINDOW_MS = 30_000

interface PrecheckRow {
  sid: string
  events_n: number
  last_seen_at: number
  is_bot: number
}

export default defineEventHandler(async (event) => {
  const rawIp = getClientIp(event) // un-anonymized: rate limiting only
  if (!rateLimit('collect', rawIp, 120, 60_000)) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
  }

  const cfg = useRuntimeConfig(event)
  const hdr = readHeaders(event)
  if (cfg.honorGpc && (hdr.gpc === 1 || hdr.dnt === 1)) {
    // Global Privacy Control honoured: acknowledge, store nothing.
    setResponseStatus(event, 204)
    return null
  }

  const declared = Number(getHeader(event, 'content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })
  const raw = await readRawBody(event, false).catch(() => undefined)
  if (!raw || raw.length === 0) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  if (raw.length > MAX_BODY_BYTES) throw createError({ statusCode: 413, statusMessage: 'Payload Too Large' })

  let body: unknown
  try {
    body = JSON.parse(raw.toString('utf8'))
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  }

  const now = Date.now()
  const parsed = parseEnvelope(body, now)
  if (!parsed) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  const { sid } = parsed

  const storeIp = getStorageIp(event)
  const ua = normalizeUa(getHeader(event, 'user-agent')) || null
  const cf = readCf(event)

  try {
    const db = getDb(event)

    // Pre-check: the session row (exists? events budget, last envelope,
    // already a bot?) and the honeypot flag for this (ip, ua) — one batch.
    const [preRes, hpRes] = await db.batch([
      bindChecked(db, PRECHECK_SQL, [sid], 'precheck'),
      bindChecked(db, HONEYPOT_CHECK_SQL, [storeIp, ua ?? '', now], 'honeypot'),
    ])
    const row = (preRes?.results?.[0] as PrecheckRow | undefined) ?? null
    const honeypot = (hpRes?.results?.length ?? 0) > 0
    const sessionExists = row !== null

    // Nothing to store for an unknown sid → no row (A16 / A34).
    if (!sessionExists && isEmptyEnvelope(parsed)) {
      setResponseStatus(event, 204)
      return null
    }

    // Per-storage-IP cap on NEW sessions (delta A34). Existing sids always pass.
    if (!sessionExists && storeIp) {
      const cap = await bindChecked(db, IP_CAP_SQL, [storeIp, now - DAY_MS], 'ip_cap').first<{ n: number }>()
      if ((cap?.n ?? 0) >= IP_SESSIONS_PER_DAY) {
        throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
      }
    }

    const bot = isBotUA(ua) || honeypot || cf.verifiedBot === 1 || row?.is_bot === 1

    // Plausibility (delta A33): heartbeats per envelope ≤ ⌈ms since the last
    // envelope ÷ 15 s⌉ + 1; a brand-new session gets a 30 s window (cap 3).
    const lastSeen = row?.last_seen_at ?? now - HEARTBEAT_FALLBACK_WINDOW_MS
    const heartbeatCap = Math.ceil(Math.max(0, now - lastSeen) / HEARTBEAT_MS) + 1
    const heartbeats = Math.min(parsed.heartbeats, heartbeatCap)

    // Session event cap: beyond 400 stored rows only ESSENTIAL_TYPES pass.
    // Bot sessions store no event rows at all (D25).
    const budget = Math.max(0, SESSION_EVENT_CAP - (row?.events_n ?? 0))
    const rows: CleanEvent[] = []
    if (!bot) {
      for (const e of parsed.events) {
        if (ESSENTIAL.has(e.type) || rows.length < budget) rows.push(e)
      }
    }

    // Optional reverse DNS, first envelope only (C.9 / D4).
    let rdnsHost: string | null = null
    if (!sessionExists && !bot && rdnsApplies(event, storeIp)) {
      try {
        const cached = await cachedRdns(db, storeIp, now)
        if (cached === undefined) scheduleRdns(event, db, storeIp, sid)
        else rdnsHost = cached
      } catch (err) {
        console.warn('[collect] rdns cache read failed:', (err as Error)?.message ?? err)
      }
    }

    const binds = buildCollectBinds(parsed, {
      now,
      storeIp,
      ua,
      dev: parseUA(ua, { maxTouchPoints: parsed.maxTouchPoints }),
      cf,
      hdr,
      bot,
      heartbeats,
      rows,
      cfTzOffsetMin: offsetMin(cf.cfTz, now),
      rdnsHost,
    })

    const statements: ReturnType<typeof bindChecked>[] = []
    // ① visitors — only for a sid the pre-check did not know (13 params).
    if (!sessionExists) statements.push(bindChecked(db, VISITORS_SQL, binds.visitors, 'visitors'))
    // ② sessions Statement A (70 params).
    statements.push(bindChecked(db, SESSION_SQL, binds.session, 'sessions'))
    // ③ session_net Statement B (39 params) — first envelope, or whenever the
    //    SSR handoff / client tz offset arrives later.
    if (!sessionExists || parsed.docFacts || parsed.clientTzOffsetMin !== null) {
      statements.push(bindChecked(db, SESSION_NET_SQL, binds.net, 'session_net'))
    }
    // Bot sessions (D25): session + network facts only.
    if (!bot) {
      // ④ session_env (62 params), latest non-null wins.
      if (binds.env) statements.push(bindChecked(db, SESSION_ENV_SQL, binds.env, 'session_env'))
      // ⑤ page_visits ×n (19 params each).
      for (const args of binds.pageVisits) statements.push(bindChecked(db, PAGE_VISITS_SQL, args, 'page_visits'))
      // ⑥ page_perf ×n (38 params each), first-write.
      for (const args of binds.pagePerf) statements.push(bindChecked(db, PAGE_PERF_SQL, args, 'page_perf'))
      // ⑦ events ×m — 16 rows × 6 = 96 params per statement.
      for (let i = 0; i < binds.events.length; i += EVENTS_ROWS_PER_STATEMENT) {
        const chunk = binds.events.slice(i, i + EVENTS_ROWS_PER_STATEMENT)
        statements.push(bindChecked(db, eventsSql(chunk.length), chunk.flat(), `events×${chunk.length}`))
      }
    }

    await db.batch(statements)
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    console.error('[collect] persist failed:', err)
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
  }

  // The replay upload token (delta A7): only a browser that /api/collect has
  // seen for this sid can push chunks into it.
  setReplayTokenCookie(event, sid)
  setResponseStatus(event, 204)
  return null
})
