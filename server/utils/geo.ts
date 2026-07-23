import type { CityResponse, Reader } from 'maxmind'

export interface GeoInfo {
  country: string | null
  region: string | null
  city: string | null
  lat: number | null
  lon: number | null
}

// Reader singleton, installed by server/plugins/02.geo.ts once the mmdb is
// available. Until then (or on any geo failure) every lookup returns null.
let reader: Reader<CityResponse> | null = null

export function setGeoReader(r: Reader<CityResponse> | null): void {
  reader = r
}

export function isGeoOnline(): boolean {
  return reader !== null
}

/** City-level lookup. Pass the UN-anonymized IP — anonymized ones won't resolve well. */
export function lookupGeo(ip: string): GeoInfo | null {
  if (!reader || !ip) return null
  try {
    const hit = reader.get(ip)
    if (!hit) return null
    return {
      country: hit.country?.iso_code ?? null,
      region: hit.subdivisions?.[0]?.names.en ?? null,
      city: hit.city?.names.en ?? null,
      lat: hit.location?.latitude ?? null,
      lon: hit.location?.longitude ?? null,
    }
  } catch {
    return null
  }
}
