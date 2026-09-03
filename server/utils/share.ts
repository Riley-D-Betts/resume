// server/utils/share.ts — the share-link primitives: the token grammar, the
// mint-with-collision-retry, the one capture statement and the forwarded rule.
//
// PURE MODULE: no Nuxt/Nitro auto-imports and no runtime dependencies, so
// tests/unit/share.test.ts can import it by relative path under `node --test`
// and exercise the grammar, the retry and the heuristic outside a Worker.
//
// The whole feature is deliberately narrow: a link is minted per NAMED
// recipient and every document request carrying it is recorded server-side.
// There is no URL rewriting, no per-visitor token, no chain and no client-side
// JavaScript. When several distinct people open one link the console says
// "forwarded, recipient unknown" — the true state of knowledge — and only the
// recipient the owner named himself ever gets a name.

/**
 * Unambiguous lowercase alphabet: no `l`, `1`, `o` or `0`, so a token read off
 * a phone screen or dictated over a call cannot be mistyped into someone
 * else's link. 32 symbols × 4 characters = 1 048 576 tokens.
 */
export const SHARE_TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'
export const SHARE_TOKEN_LEN = 4
/** The grammar, anchored: `l`, `o`, `0` and `1` are not in it. */
export const SHARE_TOKEN_RE = /^[a-km-np-z2-9]{4}$/
/** Mint attempts before giving up (each is one indexed PK probe). */
export const SHARE_TOKEN_TRIES = 6

/** The `?k=` query key and the cookie that carries it into /api/collect. */
export const SHARE_QUERY_KEY = 'k'
export const SHARE_COOKIE = 'rb_k'
/** 90 days — long enough that a link still explains a visit weeks later. */
export const SHARE_COOKIE_MAX_AGE_S = 90 * 24 * 60 * 60

/**
 * The opt-out flag, mirrored into a cookie by the tracker plugin so the SERVER
 * can honour it. The tracker's own gate reads `localStorage.rb_optout`, which
 * a middleware cannot see, and the share capture runs before any client
 * JavaScript — without this cookie an opted-out browser opening a `?k=` link
 * would still be recorded, which the footer's promise does not allow.
 */
export const OPTOUT_COOKIE = 'rb_optout'
export const OPTOUT_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60

/** Field caps for a minted link (clamped with sanitize.clampStr). */
export const SHARE_LABEL_MAX = 120
export const SHARE_NOTE_MAX = 400
export const SHARE_CHANNEL_MAX = 40

/**
 * ONE statement, no separate read (contract: an unknown token must cost
 * nothing and must not be usable to write rows). The `WHERE EXISTS` makes the
 * insert a no-op for a token that was never minted, so scanning `?k=` values
 * writes nothing at all.
 *
 * 9 params: token, ts, kind, agent, as_org, country, referrer_host, path,
 * token again for the EXISTS.
 */
export const SHARE_HIT_SQL = `INSERT INTO share_hits (token, ts, kind, agent, as_org, country, referrer_host, path)
SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM share_links WHERE token = ?)`

/** Is this a well-formed token? Cheap enough to run before any I/O. */
export function isShareToken(v: unknown): v is string {
  return typeof v === 'string' && SHARE_TOKEN_RE.test(v)
}

/** Uniform [0, 1) from the platform CSPRNG, falling back to Math.random. */
function cryptoRandom(): number {
  try {
    const buf = new Uint32Array(1)
    globalThis.crypto.getRandomValues(buf)
    return (buf[0] as number) / 4_294_967_296
  } catch {
    return Math.random()
  }
}

/**
 * One candidate token. The alphabet is 32 symbols — a power of two — so
 * scaling a uniform [0, 1) is unbiased.
 */
export function newShareToken(rand: () => number = cryptoRandom): string {
  let out = ''
  for (let i = 0; i < SHARE_TOKEN_LEN; i++) {
    const idx = Math.min(SHARE_TOKEN_ALPHABET.length - 1, Math.max(0, Math.floor(rand() * SHARE_TOKEN_ALPHABET.length)))
    out += SHARE_TOKEN_ALPHABET[idx]
  }
  return out
}

/**
 * A token no existing link holds, or null after SHARE_TOKEN_TRIES collisions.
 * `taken` answers "does this token already exist?" — the caller supplies the
 * D1 probe, so the retry logic itself stays pure and testable.
 */
export async function mintShareToken(
  taken: (token: string) => Promise<boolean>,
  rand: () => number = cryptoRandom,
): Promise<string | null> {
  for (let i = 0; i < SHARE_TOKEN_TRIES; i++) {
    const candidate = newShareToken(rand)
    if (!(await taken(candidate))) return candidate
  }
  return null
}

/**
 * Host of a referring URL, lowercased, `www.` stripped — or null when there is
 * no usable referrer. Only the HOST is kept: the full referring URL of a
 * private chat or ATS page is more than this feature needs to answer "where
 * was the link pasted".
 */
export function refererHost(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s.length === 0) return null
  try {
    const host = new URL(s).hostname.toLowerCase()
    if (host.length === 0) return null
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return null
  }
}

/**
 * FORWARDED, recipient unknown: more than one distinct reader (`sessions.vid`,
 * the identity the tracker already mints — preview bots have none) or opens
 * from more than one organisation.
 *
 * It is evidence, never a verdict: the console renders it as
 * "3 people · 2 organisations" beside the flag, and one person on a laptop and
 * a phone is honestly indistinguishable from two people. That is the price of
 * refusing per-visitor tokens, and it is the trade the owner chose.
 */
export function isForwarded(readers: number, orgs: number): boolean {
  return readers > 1 || orgs > 1
}
