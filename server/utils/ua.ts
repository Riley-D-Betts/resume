import { isBotUA } from './bots.ts'

export interface ParsedUA {
  browser: string
  browserVer: string
  os: string
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'bot'
}

/** Client-reported facts that the UA string alone cannot settle (audit A30). */
export interface UaHints {
  /** `navigator.maxTouchPoints` — a "Macintosh" UA with > 1 is iPadOS. */
  maxTouchPoints?: number | null
}

export const UA_UNKNOWN = 'Unknown'

// In-app browsers first: they carry a Chrome / Safari token underneath.
const IN_APP: Array<[RegExp, string]> = [
  [/\[linkedinapp\]/i, 'LinkedIn app'],
  [/\bfban\b|\bfbav\//i, 'Facebook app'],
  [/\binstagram\b/i, 'Instagram app'],
]

// Order matters: Edge / Opera / Samsung / Vivaldi / Yandex / DuckDuckGo ship a
// Chrome token, Chrome ships a Safari token.
const BROWSERS: Array<[RegExp, string]> = [
  [/edg(?:e|a|ios)?\/([\d.]+)/i, 'Edge'],
  [/opr\/([\d.]+)/i, 'Opera'],
  [/opera[/ ]([\d.]+)/i, 'Opera'],
  [/samsungbrowser\/([\d.]+)/i, 'Samsung Internet'],
  [/vivaldi\/([\d.]+)/i, 'Vivaldi'],
  [/yabrowser\/([\d.]+)/i, 'Yandex'],
  [/duckduckgo\/([\d.]+)/i, 'DuckDuckGo'],
  [/fxios\/([\d.]+)/i, 'Firefox'],
  [/firefox\/([\d.]+)/i, 'Firefox'],
  [/crios\/([\d.]+)/i, 'Chrome'],
  [/chrome\/([\d.]+)/i, 'Chrome'],
  [/version\/([\d.]+).*safari/i, 'Safari'],
]

/** Engine version used for in-app browsers (their own token rarely carries one). */
const ENGINE_VERSION = /(?:crios|chrome|version|fbav)\/([\d.]+)/i

// iPadOS / iOS before macOS ("like Mac OS X"), ChromeOS before Linux.
const OSES: Array<[RegExp, string]> = [
  [/ipad/i, 'iPadOS'],
  [/iphone|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/windows nt|windows phone|win64|win32/i, 'Windows'],
  [/cros/i, 'ChromeOS'],
  [/mac os x|macintosh/i, 'macOS'],
  [/linux|x11/i, 'Linux'],
]

/**
 * Small regex-table UA parser — good enough for a personal-site dashboard.
 * Unknowns collapse into the single `Unknown` bucket for browser and os
 * (never '' / null), so the ops console gets one "??" bar (audit A30).
 */
export function parseUA(ua: string | null | undefined, hints?: UaHints): ParsedUA {
  const s = ua ?? ''

  let browser = UA_UNKNOWN
  let browserVer = ''
  for (const [re, name] of IN_APP) {
    if (re.test(s)) {
      browser = name
      browserVer = s.match(ENGINE_VERSION)?.[1] ?? ''
      break
    }
  }
  if (browser === UA_UNKNOWN) {
    for (const [re, name] of BROWSERS) {
      const m = s.match(re)
      if (m) {
        browser = name
        browserVer = m[1] ?? ''
        break
      }
    }
  }

  let os = UA_UNKNOWN
  for (const [re, name] of OSES) {
    if (re.test(s)) {
      os = name
      break
    }
  }
  // iPadOS 13+ asks for the desktop site and says "Macintosh"; only the
  // client's maxTouchPoints tells it apart from a Mac.
  const touchPoints = hints?.maxTouchPoints
  const ipadAsMac = os === 'macOS' && typeof touchPoints === 'number' && touchPoints > 1
  if (ipadAsMac) os = 'iPadOS'

  let deviceType: ParsedUA['deviceType'] = 'desktop'
  if (isBotUA(s)) deviceType = 'bot'
  else if (ipadAsMac || /ipad|tablet/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) deviceType = 'tablet'
  else if (/mobi|iphone|ipod|android/i.test(s)) deviceType = 'mobile'

  return { browser, browserVer, os, deviceType }
}
