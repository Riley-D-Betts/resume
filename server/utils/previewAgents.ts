// server/utils/previewAgents.ts — who actually fetched a shared link.
//
// PURE MODULE (its only import is the pure `isBotUA`), so
// tests/unit/share.test.ts can import it by relative path under `node --test`.
//
// A link pasted into Slack, Teams or LinkedIn is fetched by that platform's
// preview bot BEFORE any human clicks it, and preview bots run no JavaScript
// — they never reach /api/collect. The SSR document request is the only trace
// they leave, which is why this table lives next to the capture middleware and
// not in the analytics ingest.
//
// `isBotUA` is one boolean with no provenance, so it cannot say WHICH platform
// unfurled a link. This table can: it maps a user agent to a platform NAME,
// and that name (never the raw header) is what share_hits.agent stores.

import { isBotUA } from './bots.ts'

/** What kind of fetch a request was: a person, a named preview bot, other automation. */
export type FetchKind = 'view' | 'unfurl' | 'bot'

export interface FetchClass {
  kind: FetchKind
  /** Platform name for an `unfurl`; null for `view` and `bot`. */
  agent: string | null
}

/**
 * Named link-preview fetchers, matched case-insensitively against the UA.
 * Order matters only where two patterns could both hit; each entry below is
 * distinct, and the more specific Slack token is listed first for clarity.
 *
 * Deliberately NOT here: general crawlers (Googlebot, Bingbot, Applebot's
 * search crawl is indistinguishable from its preview fetch by UA alone — see
 * the note on Apple). Calling a crawler an "unfurl" would invent evidence of
 * sharing that does not exist.
 */
const PREVIEW_AGENTS: ReadonlyArray<{ re: RegExp; platform: string }> = [
  { re: /slackbot-linkexpanding/i, platform: 'Slack' },
  { re: /slackbot|slack-imgproxy/i, platform: 'Slack' },
  { re: /skypeuripreview/i, platform: 'Teams' },
  { re: /linkedinbot/i, platform: 'LinkedIn' },
  { re: /whatsapp/i, platform: 'WhatsApp' },
  { re: /telegrambot/i, platform: 'Telegram' },
  { re: /discordbot/i, platform: 'Discord' },
  { re: /facebookexternalhit|facebookcatalog/i, platform: 'Facebook' },
  { re: /twitterbot/i, platform: 'X' },
  // Google's link renderer (Chat / Gmail card), not Googlebot.
  { re: /google-pagerenderer/i, platform: 'Google' },
  { re: /bingpreview/i, platform: 'Bing' },
  // Applebot serves both Spotlight/Siri and the iMessage link preview; the
  // preview is by far the likelier reason a freshly minted private link is
  // fetched by it, and it is reported as a platform, never as a person.
  { re: /applebot/i, platform: 'Apple' },
  { re: /mastodon/i, platform: 'Mastodon' },
]

/** Every platform this table can name, in table order (for the console legend / docs). */
export const PREVIEW_PLATFORMS: readonly string[] = [
  ...new Set(PREVIEW_AGENTS.map((a) => a.platform)),
]

/**
 * Classify a document request by its user agent:
 * - `unfurl` — a named preview bot; `agent` is the platform ("Slack").
 * - `bot` — `isBotUA` says automation, but nothing names it.
 * - `view` — everything else, i.e. a browser a person is holding.
 *
 * A `view` is not proof of a human (nothing short of a challenge is), but it
 * is the honest default: the console counts distinct READERS from
 * `sessions.vid`, which only a JavaScript-running browser ever mints.
 */
export function classifyFetch(ua: string | null | undefined): FetchClass {
  const s = typeof ua === 'string' ? ua.trim() : ''
  if (s.length > 0) {
    for (const a of PREVIEW_AGENTS) {
      if (a.re.test(s)) return { kind: 'unfurl', agent: a.platform }
    }
  }
  return isBotUA(s) ? { kind: 'bot', agent: null } : { kind: 'view', agent: null }
}
