// server/utils/shareOps.ts — the read side of the share links, shared by
// GET /api/ops/share and GET /api/ops/share/[token] so the list and the detail
// can never disagree about what "forwarded" means.
//
// Only counts and coarse facts leave here: opens by kind, distinct readers,
// organisations, countries, unfurl platforms. The ONE named identity is
// `label` — what the owner himself typed when he minted the link. Everybody
// else is described by organisation, country and device, because that is all
// this feature can honestly know.

import type { ShareHitKind, ShareLinkRow } from '../../shared/analytics/ops.ts'
import type { Row } from './opsDb.ts'
import { jsonStrings, toNum, toStr } from './opsDb.ts'
import { isForwarded } from './share.ts'

/** Newest links first. The owner mints these by hand, so the cap is generous. */
export const SHARE_LINKS_LIMIT = 200
/** Hit-log page on the detail view. */
export const SHARE_HITS_LIMIT = 200
/** Attributed sessions on the detail view. */
export const SHARE_SESSIONS_LIMIT = 100

export const SHARE_LINKS_SQL
  = 'SELECT token, label, note, channel, created_at, revoked FROM share_links ORDER BY created_at DESC LIMIT ?'

export const SHARE_LINK_ONE_SQL
  = 'SELECT token, label, note, channel, created_at, revoked FROM share_links WHERE token = ?'

/**
 * Per-token hit rollup (idx_share_hits_token_ts). `one` scopes it to a single
 * token for the detail view; the list groups every token in one statement.
 */
export function shareHitRollupSql(one = false): string {
  return (
    "SELECT token, COUNT(*) AS opens, COALESCE(SUM(kind = 'view'), 0) AS views, "
    + "COALESCE(SUM(kind = 'unfurl'), 0) AS unfurls, COALESCE(SUM(kind = 'bot'), 0) AS bots, "
    + 'MIN(ts) AS firstHit, MAX(ts) AS lastHit, '
    + 'json_group_array(DISTINCT as_org) AS orgs, json_group_array(DISTINCT country) AS countries, '
    + 'json_group_array(DISTINCT agent) AS platforms '
    + `FROM share_hits${one ? ' WHERE token = ?' : ''} GROUP BY token`
  )
}

/**
 * Sessions attributed to a link through `session_net.share_token`
 * (idx_session_net_share). READERS are DISTINCT `sessions.vid` — the visitor
 * identity the tracker already mints — over NON-BOT sessions: preview bots run
 * no JavaScript and have no vid at all, so they can never inflate a headcount.
 */
export function shareSessionRollupSql(one = false): string {
  return (
    'SELECT n.share_token AS token, COALESCE(SUM(s.is_bot = 0), 0) AS sessions, '
    + 'COUNT(DISTINCT CASE WHEN s.is_bot = 0 THEN s.vid END) AS readers '
    + 'FROM session_net n JOIN sessions s ON s.sid = n.sid '
    + `WHERE n.share_token IS NOT NULL${one ? ' AND n.share_token = ?' : ''} GROUP BY n.share_token`
  )
}

/** The link to send for a token. */
export function shareUrl(origin: string, token: string): string {
  return `${origin}/?k=${token}`
}

/** `share_hits.kind` as the console's union (anything unexpected reads as automation). */
export function shareHitKind(v: unknown): ShareHitKind {
  return v === 'view' || v === 'unfurl' ? v : 'bot'
}

/**
 * Fold the three result sets into the console rows. A link with no hits and no
 * sessions still renders — a minted link that nobody has opened is a fact
 * worth seeing.
 */
export function foldShareLinks(
  links: readonly Row[],
  hits: readonly Row[],
  sessions: readonly Row[],
  origin: string,
): ShareLinkRow[] {
  const hitBy = new Map(hits.map((r) => [toStr(r.token) ?? '', r]))
  const sessBy = new Map(sessions.map((r) => [toStr(r.token) ?? '', r]))
  return links.map((l) => {
    const token = toStr(l.token) ?? ''
    const h = hitBy.get(token)
    const s = sessBy.get(token)
    const orgs = jsonStrings(h?.orgs)
    const readers = toNum(s?.readers)
    return {
      token,
      label: toStr(l.label) ?? '',
      note: toStr(l.note),
      channel: toStr(l.channel),
      createdAt: toNum(l.created_at),
      revoked: toNum(l.revoked) === 1,
      url: shareUrl(origin, token),
      opens: toNum(h?.opens),
      views: toNum(h?.views),
      unfurls: toNum(h?.unfurls),
      bots: toNum(h?.bots),
      readers,
      sessions: toNum(s?.sessions),
      orgs,
      countries: jsonStrings(h?.countries),
      platforms: jsonStrings(h?.platforms),
      firstHit: h?.firstHit === null || h?.firstHit === undefined ? null : toNum(h.firstHit),
      lastHit: h?.lastHit === null || h?.lastHit === undefined ? null : toNum(h.lastHit),
      forwarded: isForwarded(readers, orgs.length),
    }
  })
}
