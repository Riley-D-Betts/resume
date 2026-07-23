import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { open as openMmdb } from 'maxmind'
import type { CityResponse } from 'maxmind'

async function initGeo(mmdbPath: string): Promise<void> {
  if (!existsSync(mmdbPath)) {
    const dir = dirname(mmdbPath)
    mkdirSync(dir, { recursive: true })
    console.log('[geo] mmdb missing — downloading GeoLite2-City (background)…')
    const { downloadDbs, GeoIpDbName } = await import('geolite2-redist')
    await downloadDbs({ path: dir, dbList: [GeoIpDbName.City] })
    if (!existsSync(mmdbPath)) {
      // downloadDbs always writes <dir>/GeoLite2-City.mmdb — fall back when a
      // custom geoipMmdbPath pointed at a differently-named missing file.
      const fallback = join(dir, 'GeoLite2-City.mmdb')
      if (!existsSync(fallback)) throw new Error('download finished but mmdb not found')
      mmdbPath = fallback
    }
  }
  const reader = await openMmdb<CityResponse>(mmdbPath)
  setGeoReader(reader)
  console.log(`[geo] online (${mmdbPath})`)
}

export default defineNitroPlugin(() => {
  const cfg = useRuntimeConfig()
  const mmdbPath = cfg.geoipMmdbPath || join(getDataDir(), 'geo', 'GeoLite2-City.mmdb')

  // Fire-and-forget: a first-boot download (~60MB) must never block or crash
  // the server. Until the reader is set, lookupGeo() simply returns null.
  void initGeo(mmdbPath).catch((err: unknown) => {
    setGeoReader(null)
    console.warn(`[geo] OFFLINE (${err instanceof Error ? err.message : String(err)})`)
  })
})
