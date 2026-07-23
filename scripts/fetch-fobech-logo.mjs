/**
 * Prebuild: refresh the Fobech logo from fobech.com when reachable.
 * A valid copy is committed at public/fobech/logo.svg, so this script
 * NEVER fails the build — offline just keeps the committed asset.
 */
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const dest = fileURLToPath(new URL('../public/fobech/logo.svg', import.meta.url))
const url = 'https://fobech.com/fobech_logo_color.svg'

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const body = await res.text()
  if (!body.includes('<svg')) throw new Error('response is not an SVG')
  await writeFile(dest, body)
  console.log(`[fobech-logo] refreshed from ${url}`)
} catch (err) {
  console.warn(`[fobech-logo] using committed fallback (${err.message})`)
}
