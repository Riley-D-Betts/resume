const ID_RE = /^[0-9a-fA-F-]{16,64}$/
const MAX_BODY_BYTES = 256 * 1024
const MAX_EVENTS = 100
const MAX_PAYLOAD_JSON = 4096
const HEARTBEAT_MS = 15_000
const SCROLL_PCTS = new Set([25, 50, 75, 90, 100])
const EGG_NAMES = new Set(['console', 'konami'])
const EVENT_TYPES = new Set([
  'pageview',
  'section_enter',
  'section_exit',
  'scroll_depth',
  'click',
  'outbound',
  'vitals',
  'js_error',
  'heartbeat',
  'boot_done',
  'boot_skipped',
  'easter_egg',
  'replay_stopped',
])

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== 'string' || v.length === 0) return null
  return v.length > max ? v.slice(0, max) : v
}

function asNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

interface CleanEvent {
  t: number
  type: string
  name: string | null
  payload: string | null
}

interface PageviewInfo {
  referrer: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
  screenW: number | null
  screenH: number | null
  dpr: number | null
  viewportW: number | null
  viewportH: number | null
  tz: string | null
  lang: string | null
}

interface ParsedEnvelope {
  events: CleanEvent[]
  pv: PageviewInfo | null
  pageviews: number
  heartbeats: number
  maxScroll: number
}

/** Whitelist + clamp one raw event. Returns null to drop it. */
function sanitizeEvent(raw: Record<string, unknown>, now: number, out: ParsedEnvelope): CleanEvent | null {
  const type = raw.type
  if (typeof type !== 'string' || !EVENT_TYPES.has(type)) return null
  const t = asNum(raw.t)
  if (t === null) return null
  const ts = Math.min(Math.max(t, now - 7 * 24 * 60 * 60 * 1000), now + 60_000)
  const p = asObj(raw.p)

  let name: string | null = null
  let payload: Record<string, unknown> | null = null

  switch (type) {
    case 'pageview': {
      const utm = asObj(p.utm)
      const screen = asObj(p.screen)
      const viewport = asObj(p.viewport)
      const info: PageviewInfo = {
        referrer: clampStr(p.referrer, 300),
        utmSource: clampStr(utm.source, 120),
        utmMedium: clampStr(utm.medium, 120),
        utmCampaign: clampStr(utm.campaign, 120),
        utmTerm: clampStr(utm.term, 120),
        utmContent: clampStr(utm.content, 120),
        screenW: asNum(screen.w),
        screenH: asNum(screen.h),
        dpr: asNum(screen.dpr),
        viewportW: asNum(viewport.w),
        viewportH: asNum(viewport.h),
        tz: clampStr(p.tz, 64),
        lang: clampStr(p.lang, 24),
      }
      payload = {
        referrer: info.referrer,
        utm: {
          source: info.utmSource,
          medium: info.utmMedium,
          campaign: info.utmCampaign,
          term: info.utmTerm,
          content: info.utmContent,
        },
        screen: { w: info.screenW, h: info.screenH, dpr: info.dpr },
        viewport: { w: info.viewportW, h: info.viewportH },
        tz: info.tz,
        lang: info.lang,
        platform: clampStr(p.platform, 40),
        touch: p.touch === true,
        deviceMemory: asNum(p.deviceMemory),
        cores: asNum(p.cores),
        connection: clampStr(p.connection, 24),
      }
      out.pageviews++
      if (!out.pv) out.pv = info
      break
    }
    case 'section_enter':
      name = clampStr(raw.name, 40)
      if (!name) return null
      break
    case 'section_exit':
      name = clampStr(raw.name, 40)
      if (!name) return null
      payload = { dwellMs: asNum(p.dwellMs) }
      break
    case 'scroll_depth': {
      const pct = asNum(p.pct)
      if (pct === null || !SCROLL_PCTS.has(pct)) return null
      payload = { pct }
      if (pct > out.maxScroll) out.maxScroll = pct
      break
    }
    case 'click':
      payload = {
        sel: clampStr(p.sel, 120),
        text: clampStr(p.text, 60),
        x: asNum(p.x),
        y: asNum(p.y),
        section: clampStr(p.section, 40),
      }
      break
    case 'outbound':
      name = clampStr(raw.name, 120)
      payload = {
        href: clampStr(p.href, 300),
        label: clampStr(p.label, 80),
        section: clampStr(p.section, 40),
      }
      break
    case 'vitals':
      payload = { ttfb: asNum(p.ttfb), lcp: asNum(p.lcp), cls: asNum(p.cls), inp: asNum(p.inp) }
      break
    case 'js_error':
      payload = {
        msg: clampStr(p.msg, 300),
        src: clampStr(p.src, 200),
        line: asNum(p.line),
        stack: clampStr(p.stack, 1000),
      }
      break
    case 'heartbeat':
      payload = {}
      out.heartbeats++
      break
    case 'easter_egg':
      name = clampStr(raw.name, 20)
      if (!name || !EGG_NAMES.has(name)) return null
      break
    case 'replay_stopped':
      payload = { reason: clampStr(p.reason, 80) }
      break
    // boot_done | boot_skipped: no name, no payload
  }

  let json: string | null = null
  if (payload) {
    json = JSON.stringify(payload)
    if (json.length > MAX_PAYLOAD_JSON) json = null
  }
  return { t: ts, type, name, payload: json }
}

function parseEnvelope(body: unknown, now: number): { vid: string, sid: string, url: string, parsed: ParsedEnvelope } | null {
  const env = asObj(body)
  if (env.v !== 1) return null
  const vid = env.vid
  const sid = env.sid
  if (typeof vid !== 'string' || !ID_RE.test(vid)) return null
  if (typeof sid !== 'string' || !ID_RE.test(sid)) return null
  if (typeof env.returning !== 'boolean') return null
  const url = clampStr(env.url, 300)
  if (!url) return null
  if (!Array.isArray(env.events)) return null

  const parsed: ParsedEnvelope = { events: [], pv: null, pageviews: 0, heartbeats: 0, maxScroll: 0 }
  for (const raw of (env.events as unknown[]).slice(0, MAX_EVENTS)) {
    if (typeof raw !== 'object' || raw === null) continue
    const clean = sanitizeEvent(raw as Record<string, unknown>, now, parsed)
    if (clean) parsed.events.push(clean)
  }
  return { vid, sid, url, parsed }
}

export default defineEventHandler(async (event) => {
  const rawIp = getClientIp(event) // un-anonymized: rate limiting + geo
  if (!rateLimit('collect', rawIp, 60, 60_000)) {
    throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
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
  const envelope = parseEnvelope(body, now)
  if (!envelope) throw createError({ statusCode: 400, statusMessage: 'Bad Request' })
  const { vid, sid, url, parsed } = envelope

  const storeIp = getStorageIp(event)
  const ua = clampStr(getHeader(event, 'user-agent'), 400)
  const bot = isBotUA(ua) || isHoneypotFlagged(storeIp)

  try {
    const db = getDb()
    const sessionExists = db.prepare('SELECT sid FROM sessions WHERE sid = ?').get(sid) as { sid: string } | undefined
    const visitorExists = db.prepare('SELECT vid FROM visitors WHERE vid = ?').get(vid) as { vid: string } | undefined
    const pv = parsed.pv

    db.transaction(() => {
      if (!visitorExists) {
        db.prepare(
          `INSERT INTO visitors (vid, first_seen_at, last_seen_at, visit_count, first_referrer, first_utm_source, first_utm_medium, first_utm_campaign)
           VALUES (?, ?, ?, 1, ?, ?, ?, ?)`,
        ).run(vid, now, now, pv?.referrer ?? null, pv?.utmSource ?? null, pv?.utmMedium ?? null, pv?.utmCampaign ?? null)
      } else {
        // previously-unseen sid on a known visitor = a new visit
        db.prepare('UPDATE visitors SET last_seen_at = ?, visit_count = visit_count + ? WHERE vid = ?')
          .run(now, sessionExists ? 0 : 1, vid)
      }

      if (!sessionExists) {
        const dev = parseUA(ua)
        const geo = lookupGeo(rawIp)
        const startedAt = parsed.events.length > 0 ? Math.min(...parsed.events.map(e => e.t)) : now
        db.prepare(
          `INSERT INTO sessions (
             sid, vid, started_at, last_seen_at, duration_ms, ip, ua,
             browser, browser_ver, os, device_type,
             screen_w, screen_h, viewport_w, viewport_h, dpr, lang, tz,
             country, region, city, lat, lon,
             referrer, utm_source, utm_medium, utm_campaign, utm_term, utm_content,
             entry_path, pageviews, max_scroll_pct, is_bot, has_replay
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        ).run(
          sid, vid, startedAt, now, parsed.heartbeats * HEARTBEAT_MS, storeIp, ua,
          dev.browser, dev.browserVer, dev.os, dev.deviceType,
          pv?.screenW ?? null, pv?.screenH ?? null, pv?.viewportW ?? null, pv?.viewportH ?? null,
          pv?.dpr ?? null, pv?.lang ?? null, pv?.tz ?? null,
          geo?.country ?? null, geo?.region ?? null, geo?.city ?? null, geo?.lat ?? null, geo?.lon ?? null,
          pv?.referrer ?? null, pv?.utmSource ?? null, pv?.utmMedium ?? null,
          pv?.utmCampaign ?? null, pv?.utmTerm ?? null, pv?.utmContent ?? null,
          url, parsed.pageviews, parsed.maxScroll, bot ? 1 : 0,
        )
      } else {
        db.prepare(
          `UPDATE sessions SET
             last_seen_at = ?,
             pageviews = pageviews + ?,
             max_scroll_pct = MAX(max_scroll_pct, ?),
             duration_ms = duration_ms + ?
           WHERE sid = ?`,
        ).run(now, parsed.pageviews, parsed.maxScroll, parsed.heartbeats * HEARTBEAT_MS, sid)
      }

      const insertEvent = db.prepare('INSERT INTO events (sid, ts, type, name, payload) VALUES (?, ?, ?, ?, ?)')
      for (const e of parsed.events) insertEvent.run(sid, e.t, e.type, e.name, e.payload)
    })()
  } catch (err) {
    console.error('[collect] persist failed:', err)
    throw createError({ statusCode: 500, statusMessage: 'Internal Server Error' })
  }

  setResponseStatus(event, 204)
  return null
})
