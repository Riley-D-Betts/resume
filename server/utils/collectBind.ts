// server/utils/collectBind.ts — bind arrays for the /api/collect batch.
//
// PURE MODULE (type-only imports besides collectSql): maps a ParsedEnvelope +
// the request facts onto the exact bind order of every statement in
// collectSql.ts (contract C.5), so the handler only does I/O and the arity
// can be exercised against node:sqlite outside a Worker.

import { HEARTBEAT_MS, SESSION_ENV_COLUMNS } from './collectSql.ts'
import type { CfFacts, HeaderFacts } from './cf'
import type { CleanEvent, ParsedEnvelope } from './sanitize'
import type { ParsedUA } from './ua'

export interface CollectFacts {
  now: number
  /** Storage form of the client IP ('' when unknown → null). */
  storeIp: string
  ua: string | null
  dev: ParsedUA
  cf: CfFacts
  hdr: HeaderFacts
  bot: boolean
  /** Heartbeats after the wall-clock cap (A33). */
  heartbeats: number
  /** Event rows after the session cap (already empty for bots). */
  rows: CleanEvent[]
  /** `offsetMin(cf.cfTz, now)`. */
  cfTzOffsetMin: number | null
  rdnsHost: string | null
  /** The `rb_k` cookie the share-capture middleware set, or null. */
  shareToken: string | null
}

export interface CollectBinds {
  /** 13 params. */
  visitors: unknown[]
  /** 70 params (COLLECT_SESSION_COLUMNS order). */
  session: unknown[]
  /** 40 params (SESSION_NET_COLUMNS order). */
  net: unknown[]
  /** 62 params (SESSION_ENV_COLUMNS order) or null when the envelope carried no env. */
  env: unknown[] | null
  /** 19 params each (PAGE_VISIT_COLUMNS order). */
  pageVisits: unknown[][]
  /** 38 params each (PAGE_PERF_COLUMNS order). */
  pagePerf: unknown[][]
  /** 6 params each (EVENT_COLUMNS order). */
  events: unknown[][]
}

export function buildCollectBinds(parsed: ParsedEnvelope, f: CollectFacts): CollectBinds {
  const { sid, vid } = parsed
  const { now, cf, hdr } = f
  const pv = parsed.pv
  const c = parsed.counters
  const s = parsed.sums
  const df = parsed.docFacts

  const visitors: unknown[] = [
    vid, now, now,
    pv?.referrer ?? null, pv?.utmSource ?? null, pv?.utmMedium ?? null, pv?.utmCampaign ?? null,
    cf.asOrg, cf.country, parsed.entryPath, cf.asOrg, cf.country,
    sid,
  ]

  const session: unknown[] = [
    // 33 existing
    sid, vid, now, now, f.heartbeats * HEARTBEAT_MS, f.storeIp || null, f.ua,
    f.dev.browser, f.dev.browserVer, f.dev.os, f.dev.deviceType,
    pv?.screenW ?? null, pv?.screenH ?? null, pv?.viewportW ?? null, pv?.viewportH ?? null,
    pv?.dpr ?? null, pv?.lang ?? null, pv?.tz ?? null,
    cf.country, cf.region, cf.city, cf.lat, cf.lon,
    pv?.referrer ?? null, pv?.utmSource ?? null, pv?.utmMedium ?? null,
    pv?.utmCampaign ?? null, pv?.utmTerm ?? null, pv?.utmContent ?? null,
    parsed.entryPath, parsed.pageviews, parsed.maxScroll, f.bot ? 1 : 0,
    // 10 hot
    parsed.exitPath, parsed.lastPath, parsed.navKind, cf.asn, cf.asOrg,
    parsed.webdriver ? 1 : 0, hdr.gpc, hdr.dnt, hdr.saveData, cf.isTor,
    // 2 vid subqueries
    vid, vid,
    // 25 counters
    c.prints, c.copies, c.emailCopies, c.selects, c.formStarted, c.formSubmitted, c.finds, c.searches,
    c.exitIntents, c.rageClicks, c.deadClicks, c.rightClicks, c.errors, c.outbounds, c.mailtoClicks,
    c.hovers, c.eggs, c.subtabs, s.hiddenMs, s.blurs, s.ptr, s.touch, s.key,
    parsed.firstInteractionMs, f.rows.length,
  ]

  const net: unknown[] = [
    sid, now,
    cf.colo, cf.httpProtocol, cf.tlsVersion, cf.tlsCipher,
    cf.clientRttMs, cf.rttKind, cf.requestPriority, cf.acceptEncoding,
    cf.tlsCiphersSha1, cf.tlsExtSha1, cf.tlsHelloLen, hdr.cfRay,
    cf.continent, cf.regionCode, cf.postalCode, cf.metroCode, cf.cfTz, cf.isEu,
    cf.botScore, cf.verifiedBot, cf.verifiedBotCategory, cf.ja3Hash, cf.ja4, cf.clientTrustScore,
    hdr.acceptLanguage, hdr.chUa, hdr.chMobile, hdr.chPlatform,
    df?.site ?? null, df?.mode ?? null, df?.dest ?? null, df ? (df.user ? 1 : 0) : null,
    df?.referer ?? null, df ? (df.earlyData ? 1 : 0) : null,
    parsed.clientTzOffsetMin, f.cfTzOffsetMin,
    f.rdnsHost,
    f.shareToken,
  ]

  const envRow = parsed.env
  const env = envRow ? [sid, now, ...SESSION_ENV_COLUMNS.slice(2).map((col) => envRow[col] ?? null)] : null

  const pageVisits = [...parsed.pageVisits.values()].map((m) => [
    m.pvid, sid, m.path, m.enteredAt, m.leftAt, m.fromPath, m.navKind, m.softNavMs,
    m.activeMs, m.hiddenMs, m.maxScrollPct, m.scrollPx, m.scrollReversals, m.maxScrollVel,
    m.sectionsSeen, m.clicks, m.textLen, m.consoleErrors, m.leaveReason,
  ])

  const pagePerf = [...parsed.pagePerf.values()].map((p) => [
    p.pvid, sid, p.ts, p.path,
    p.ttfb, p.fcp, p.lcp, p.lcpSel, p.lcpSize, p.cls, p.inp,
    p.dns, p.connect, p.tls, p.request, p.response,
    p.domInteractive, p.dcl, p.load,
    p.transfer, p.encoded, p.decoded, p.redirects, p.protocol, p.navType,
    p.resCount, p.resBytes, p.resCached, p.resByType, p.resSlowest,
    p.longTasks, p.longTaskMs, p.longTaskMaxMs,
    p.loafCount, p.loafMs, p.loafMaxMs, p.loafScript,
    p.softNavMs,
  ])

  const events = f.rows.map((e) => [sid, e.t, e.type, e.name, e.payload, e.path])

  return { visitors, session, net, env, pageVisits, pagePerf, events }
}
