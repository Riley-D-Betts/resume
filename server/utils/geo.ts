import type { H3Event } from 'h3'
import { readCf } from './cf'

export interface GeoInfo {
  country: string | null
  region: string | null
  city: string | null
  lat: number | null
  lon: number | null
}

/**
 * City-level geo from Cloudflare's edge (request.cf) — attached to every
 * request for free, no GeoIP database needed. Thin wrapper over cf.ts
 * (contract C.6): `""` placeholders from miniflare map to null there, and
 * `country === 'T1'` (Tor exit) is kept verbatim with `is_tor` set alongside.
 * Null when Cloudflare has neither country nor city for the request.
 */
export function lookupGeo(event: H3Event): GeoInfo | null {
  const cf = readCf(event)
  if (!cf.country && !cf.city) return null
  return { country: cf.country, region: cf.region, city: cf.city, lat: cf.lat, lon: cf.lon }
}
