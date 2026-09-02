// server/utils/clientHints.ts — low-entropy UA client hints (contract C.6).
//
// PURE MODULE (no Nitro auto-imports): unit-tested by tests/unit/clientHints.test.ts.
//
// `Sec-CH-UA` is a structured-header list such as
//   "Chromium";v="126", "Google Chrome";v="126", "Not.A/Brand";v="8"
// with a GREASE brand that changes punctuation per Chromium version. It is
// parsed as a list (never string-matched) and GREASE entries are dropped.

const CH_UA_MAX = 200
const BRAND_MAX = 40
const VERSION_MAX = 20
const PLATFORM_MAX = 40

/** `Not A Brand` in every punctuation Chromium has shipped, or any char outside `[A-Za-z0-9 .]`. */
const GREASE_WORDS = /^not[^a-z0-9]?a[^a-z0-9]?brand$/i
const LEGIT_CHARS = /^[A-Za-z0-9 .]+$/

export function isGreaseBrand(name: string): boolean {
  const s = name.trim()
  if (s.length === 0) return true
  if (GREASE_WORDS.test(s)) return true
  if (!LEGIT_CHARS.test(s)) return true
  // "Not A Brand" with the letters spread by anything the regexes above miss.
  const letters = s.toLowerCase().replace(/[^a-z]/g, '')
  return letters === 'notabrand'
}

export interface ChBrand {
  brand: string
  version: string
}

/** Parse a structured `Sec-CH-UA` list into its non-GREASE brands (in header order). */
export function parseBrands(header: string | null | undefined): ChBrand[] {
  if (typeof header !== 'string' || header.length === 0) return []
  const out: ChBrand[] = []
  const re = /"((?:[^"\\]|\\.)*)"\s*;\s*v\s*=\s*"((?:[^"\\]|\\.)*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(header)) !== null && out.length < 8) {
    const brand = (m[1] ?? '').replace(/\\(.)/g, '$1').trim().slice(0, BRAND_MAX)
    const version = (m[2] ?? '').replace(/\\(.)/g, '$1').trim().slice(0, VERSION_MAX)
    if (isGreaseBrand(brand)) continue
    if (!/^[0-9][0-9.]*$/.test(version) && version.length > 0) continue
    out.push({ brand, version })
  }
  return out
}

/** `Sec-CH-UA` → `"Chromium/126;Google Chrome/126"` (≤ 200) or null. */
export function parseSecChUa(header: string | null | undefined): string | null {
  const brands = parseBrands(header)
  if (brands.length === 0) return null
  const s = brands.map((b) => (b.version ? `${b.brand}/${b.version}` : b.brand)).join(';')
  return s.slice(0, CH_UA_MAX)
}

/** `Sec-CH-UA-Mobile`: `?1` → 1, `?0` → 0, anything else → null. */
export function parseChMobile(header: string | null | undefined): 0 | 1 | null {
  if (header === '?1') return 1
  if (header === '?0') return 0
  return null
}

/** `Sec-CH-UA-Platform`: quotes stripped, ≤ 40, empty → null. */
export function parseChPlatform(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null
  const s = header.trim().replace(/^"+|"+$/g, '').trim()
  if (s.length === 0 || !LEGIT_CHARS.test(s)) return null
  return s.slice(0, PLATFORM_MAX)
}
