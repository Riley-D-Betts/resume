// server/utils/replayKeys.ts — R2 key layout for rrweb replay chunks.
//
// PURE MODULE (no Nitro auto-imports) shared by /api/replay, the prune cron
// and the ops stitcher (WP4). Two layouts coexist (migration 0002):
//   * rid === LEGACY_RID  → replays/<sid>/<00000>.json[.gz]        (pre-rid rows)
//   * otherwise           → replays/<sid>/<rid>/<00000>.json[.gz]

/** Mirrors `LEGACY_RID` in shared/analytics/events.ts (kept literal so this file stays dependency-free). */
export const LEGACY_RID = 'legacy'

export const REPLAY_PREFIX = 'replays/'

/** Strict id shape — doubles as key-injection defence (hex + dashes only). */
export const ID_RE = /^[0-9a-fA-F-]{16,64}$/

export function padSeq(seq: number): string {
  return String(seq).padStart(5, '0')
}

/** Object key for one chunk. */
export function replayKey(sid: string, rid: string, seq: number, compressed: boolean | number): string {
  const ext = compressed ? '.json.gz' : '.json'
  return rid === LEGACY_RID
    ? `${REPLAY_PREFIX}${sid}/${padSeq(seq)}${ext}`
    : `${REPLAY_PREFIX}${sid}/${rid}/${padSeq(seq)}${ext}`
}

/** Both compression twins of one chunk (`[gz, plain]`). */
export function replayKeyPair(sid: string, rid: string, seq: number): [string, string] {
  return [replayKey(sid, rid, seq, true), replayKey(sid, rid, seq, false)]
}

/** Prefix that covers every object of a session in BOTH layouts. */
export function sessionPrefix(sid: string): string {
  return `${REPLAY_PREFIX}${sid}/`
}

export interface ParsedReplayKey {
  sid: string
  rid: string
  seq: number
  compressed: boolean
}

const LEGACY_KEY_RE = /^replays\/([0-9a-fA-F-]{16,64})\/(\d{5})\.json(\.gz)?$/
const RID_KEY_RE = /^replays\/([0-9a-fA-F-]{16,64})\/([0-9a-fA-F-]{16,64})\/(\d{5})\.json(\.gz)?$/

/** Inverse of replayKey; null for keys outside either layout (never delete those blindly). */
export function parseReplayKey(key: string): ParsedReplayKey | null {
  let m = RID_KEY_RE.exec(key)
  if (m) return { sid: m[1] as string, rid: m[2] as string, seq: Number(m[3]), compressed: m[4] === '.gz' }
  m = LEGACY_KEY_RE.exec(key)
  if (m) return { sid: m[1] as string, rid: LEGACY_RID, seq: Number(m[2]), compressed: m[3] === '.gz' }
  return null
}
