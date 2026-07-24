import { isBotUA } from './bots'

export interface ParsedUA {
  browser: string
  browserVer: string
  os: string
  deviceType: 'mobile' | 'tablet' | 'desktop' | 'bot'
}

// Order matters: Edge and Opera ship a Chrome token, Chrome ships a Safari token.
const BROWSERS: Array<[RegExp, string]> = [
  [/edg(?:e|a|ios)?\/([\d.]+)/i, 'Edge'],
  [/opr\/([\d.]+)/i, 'Opera'],
  [/opera[/ ]([\d.]+)/i, 'Opera'],
  [/fxios\/([\d.]+)/i, 'Firefox'],
  [/firefox\/([\d.]+)/i, 'Firefox'],
  [/crios\/([\d.]+)/i, 'Chrome'],
  [/chrome\/([\d.]+)/i, 'Chrome'],
  [/version\/([\d.]+).*safari/i, 'Safari'],
]

// iOS before macOS ("like Mac OS X"), ChromeOS before Linux.
const OSES: Array<[RegExp, string]> = [
  [/iphone|ipad|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/windows nt|windows phone|win64|win32/i, 'Windows'],
  [/cros/i, 'ChromeOS'],
  [/mac os x|macintosh/i, 'macOS'],
  [/linux|x11/i, 'Linux'],
]

/** Small regex-table UA parser — good enough for a personal-site dashboard. */
export function parseUA(ua: string | null | undefined): ParsedUA {
  const s = ua ?? ''

  let browser = 'Unknown'
  let browserVer = ''
  for (const [re, name] of BROWSERS) {
    const m = s.match(re)
    if (m) {
      browser = name
      browserVer = m[1] ?? ''
      break
    }
  }

  let os = 'Unknown'
  for (const [re, name] of OSES) {
    if (re.test(s)) {
      os = name
      break
    }
  }

  let deviceType: ParsedUA['deviceType'] = 'desktop'
  if (isBotUA(s)) deviceType = 'bot'
  else if (/ipad|tablet/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) deviceType = 'tablet'
  else if (/mobi|iphone|ipod|android/i.test(s)) deviceType = 'mobile'

  return { browser, browserVer, os, deviceType }
}
