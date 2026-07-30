import type { H3Event } from 'h3'

export interface GeoInfo {
  country: string | null
  region: string | null
  city: string | null
  lat: number | null
  lon: number | null
}

/** The slice of Cloudflare's request.cf object we read. */
interface CfGeo {
  country?: string
  region?: string
  city?: string
  latitude?: string
  longitude?: string
}

function asCoord(v: string | undefined): number | null {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * City-level geo from Cloudflare's edge (request.cf) — attached to every
 * request for free, no GeoIP database needed. Null on the rare request
 * where Cloudflare has no data (and always in plain local dev).
 */
export function lookupGeo(event: H3Event): GeoInfo | null {
  const ctx = event.context as {
    cf?: CfGeo
    cloudflare?: { request?: { cf?: CfGeo } }
  }
  const cf = ctx.cf ?? ctx.cloudflare?.request?.cf
  if (!cf || (!cf.country && !cf.city)) return null
  return {
    country: cf.country ?? null,
    region: cf.region ?? null,
    city: cf.city ?? null,
    lat: asCoord(cf.latitude),
    lon: asCoord(cf.longitude),
  }
}
