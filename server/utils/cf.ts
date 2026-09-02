import type { H3Event } from 'h3'
import { parseChMobile, parseChPlatform, parseSecChUa } from './clientHints'

/**
 * server/utils/cf.ts — everything Cloudflare's edge tells us about a request
 * (`request.cf`) plus the request headers worth keeping, mapped to the
 * `sessions` / `session_net` columns (contract C.6, scratchpad/cf-reference.md).
 *
 * Read defensively: every field is optional, paid-only Bot Management fields
 * are `undefined` on Free, and miniflare's local fallback ships `""` / `0`
 * placeholders — `""`, `0` (asn / rtt) and `undefined` all become null (B14).
 */

export interface CfFacts {
  // sessions
  asn: number | null
  asOrg: string | null
  country: string | null
  region: string | null
  city: string | null
  lat: number | null
  lon: number | null
  isTor: 0 | 1
  // session_net
  colo: string | null
  httpProtocol: string | null
  tlsVersion: string | null
  tlsCipher: string | null
  clientRttMs: number | null
  rttKind: 'tcp' | 'quic' | null
  requestPriority: string | null
  acceptEncoding: string | null
  tlsCiphersSha1: string | null
  tlsExtSha1: string | null
  tlsHelloLen: number | null
  continent: string | null
  regionCode: string | null
  postalCode: string | null
  metroCode: string | null
  cfTz: string | null
  isEu: 0 | 1 | null
  botScore: number | null
  verifiedBot: 0 | 1 | null
  verifiedBotCategory: string | null
  ja3Hash: string | null
  ja4: string | null
  clientTrustScore: number | null
}

export interface HeaderFacts {
  cfRay: string | null
  acceptLanguage: string | null
  gpc: 0 | 1
  dnt: 0 | 1
  saveData: 0 | 1
  chUa: string | null
  chMobile: 0 | 1 | null
  chPlatform: string | null
}

type Dict = Record<string, unknown>

/** The raw `request.cf` object, wherever the platform put it (undefined off-Cloudflare). */
export function rawCf(event: H3Event): Dict | undefined {
  const ctx = event.context as {
    cf?: Dict
    cloudflare?: { request?: { cf?: Dict } }
    _platform?: { cf?: Dict }
  }
  const cf = ctx.cf ?? ctx.cloudflare?.request?.cf ?? ctx._platform?.cf
  return cf && typeof cf === 'object' ? cf : undefined
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s.length === 0) return null
  return s.length > max ? s.slice(0, max) : s
}

/** Finite number or null; `zeroIsNull` for fields where 0 is miniflare's "unknown". */
function num(v: unknown, zeroIsNull = false): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  if (!Number.isFinite(n)) return null
  if (zeroIsNull && n === 0) return null
  return n
}

function int(v: unknown, min: number, max: number, zeroIsNull = false): number | null {
  const n = num(v, zeroIsNull)
  if (n === null) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

function coord(v: unknown): number | null {
  const n = num(v)
  return n === null || n < -180 || n > 180 ? null : n
}

function bool01(v: unknown): 0 | 1 | null {
  if (v === true) return 1
  if (v === false) return 0
  return null
}

function obj(v: unknown): Dict {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {}
}

const EMPTY_CF: CfFacts = {
  asn: null, asOrg: null, country: null, region: null, city: null, lat: null, lon: null, isTor: 0,
  colo: null, httpProtocol: null, tlsVersion: null, tlsCipher: null, clientRttMs: null, rttKind: null,
  requestPriority: null, acceptEncoding: null, tlsCiphersSha1: null, tlsExtSha1: null, tlsHelloLen: null,
  continent: null, regionCode: null, postalCode: null, metroCode: null, cfTz: null, isEu: null,
  botScore: null, verifiedBot: null, verifiedBotCategory: null, ja3Hash: null, ja4: null, clientTrustScore: null,
}

/** Map `request.cf` to typed, null-clean facts. */
export function readCf(event: H3Event): CfFacts {
  const cf = rawCf(event)
  if (!cf) return { ...EMPTY_CF }
  const bm = obj(cf.botManagement)

  const tcp = num(cf.clientTcpRtt, true)
  const quic = num(cf.clientQuicRtt, true)
  const rtt = tcp ?? quic
  const country = str(cf.country, 8)

  return {
    asn: int(cf.asn, 1, 4_294_967_295, true),
    asOrg: str(cf.asOrganization, 120),
    country,
    region: str(cf.region, 80),
    city: str(cf.city, 80),
    lat: coord(cf.latitude),
    lon: coord(cf.longitude),
    isTor: country === 'T1' ? 1 : 0,
    colo: str(cf.colo, 8),
    httpProtocol: str(cf.httpProtocol, 16),
    tlsVersion: str(cf.tlsVersion, 16),
    tlsCipher: str(cf.tlsCipher, 64),
    clientRttMs: rtt === null ? null : Math.min(600_000, Math.max(0, Math.round(rtt))),
    rttKind: rtt === null ? null : tcp !== null ? 'tcp' : 'quic',
    requestPriority: str(cf.requestPriority, 80),
    acceptEncoding: str(cf.clientAcceptEncoding, 80),
    tlsCiphersSha1: str(cf.tlsClientCiphersSha1, 64),
    tlsExtSha1: str(cf.tlsClientExtensionsSha1, 64),
    tlsHelloLen: int(cf.tlsClientHelloLength, 1, 1_000_000, true),
    continent: str(cf.continent, 4),
    regionCode: str(cf.regionCode, 8),
    postalCode: str(cf.postalCode, 16),
    metroCode: str(cf.metroCode, 8),
    cfTz: str(cf.timezone, 64),
    isEu: cf.isEUCountry === '1' ? 1 : cf.isEUCountry === undefined || cf.isEUCountry === '' ? null : 0,
    botScore: int(bm.score, 0, 100),
    verifiedBot: bool01(bm.verifiedBot),
    verifiedBotCategory: str(cf.verifiedBotCategory, 40),
    ja3Hash: str(bm.ja3Hash, 64),
    ja4: str(bm.ja4, 64),
    clientTrustScore: int(cf.clientTrustScore, 0, 100),
  }
}

/** Request headers that survive onto every request (incl. the collect POST). */
export function readHeaders(event: H3Event): HeaderFacts {
  const h = (name: string): string | undefined => {
    const v = getHeader(event, name)
    return typeof v === 'string' ? v : undefined
  }
  return {
    cfRay: str(h('cf-ray'), 40),
    acceptLanguage: str(h('accept-language'), 200),
    gpc: h('sec-gpc') === '1' ? 1 : 0,
    dnt: h('dnt') === '1' ? 1 : 0,
    saveData: (h('save-data') ?? '').toLowerCase() === 'on' ? 1 : 0,
    chUa: parseSecChUa(h('sec-ch-ua')),
    chMobile: parseChMobile(h('sec-ch-ua-mobile')),
    chPlatform: parseChPlatform(h('sec-ch-ua-platform')),
  }
}
