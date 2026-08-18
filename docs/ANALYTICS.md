# ANALYTICS ARCHITECTURE

How the first-party analytics behind this site is built: what the browser
collects, how it reaches the server, where it's stored, how it's pruned,
and how the `/ops` console reads it back. No third-party trackers, no
external services — every byte stays inside one Cloudflare account, and
the whole thing fits the free tier.

## The big picture

```
  visitor's browser (public pages only)
  ┌──────────────────────────────────────────────┐
  │ analytics.client.ts     replay.ts (rrweb)    │
  │  · pageview, clicks,     · sampled session   │
  │    scroll, dwell,          recording,        │
  │    vitals, errors,         gzipped chunks    │
  │    heartbeats            ·                   │
  └──────┬───────────────────────┬───────────────┘
         │ batched JSON          │ binary chunks
         ▼                       ▼
   POST /api/collect       POST /api/replay
         │ sanitize, clamp,      │ validate, cap,
         │ rate-limit            │ rate-limit
         ▼                       ▼
   ┌───────────────┐       ┌──────────────────────┐
   │ D1 (SQLite)   │◀──────│ R2  replays/<sid>/…  │
   │ visitors      │ chunk │ (accounting rows in  │
   │ sessions      │ rows  │  D1's replay_chunks) │
   │ events        │       └──────────────────────┘
   │ replay_chunks │               ▲
   │ honeypot_ips  │               │
   └──────┬────────┘               │
          │ reads                  │ stitch + gunzip
          ▼                        │
   GET /api/ops/*  ◀── password-gated /ops console (replay player, charts)

   daily cron ──▶ server/plugins/prune.ts ──▶ retention + storage caps
```

Two write paths in, one read path out, one janitor. Everything below is
the detail.

## File map

| Piece | File |
| --- | --- |
| Client tracker (events) | `app/plugins/analytics.client.ts` |
| Client replay recorder | `app/utils/analytics/replay.ts` |
| Event ingest | `server/api/collect.post.ts` |
| Replay chunk ingest | `server/api/replay.post.ts` |
| Daily retention prune | `server/plugins/prune.ts` |
| D1 schema | `migrations/0001_init.sql` |
| UA parsing / bot wordlist / honeypot | `server/utils/ua.ts`, `server/utils/bots.ts` |
| Honeypot trap route | `server/routes/void.html.get.ts` |
| IP extraction + anonymization | `server/utils/ip.ts` |
| Geo from Cloudflare's edge | `server/utils/geo.ts` |
| In-memory rate limiter | `server/utils/ratelimit.ts` |
| Cloudflare bindings accessors | `server/utils/db.ts` |
| /ops auth (sealed cookie) | `server/utils/auth.ts` |
| /ops read API | `server/api/ops/*.ts` |
| Bindings, cron, plain vars | `wrangler.jsonc` |
| Retention / sampling config | `nuxt.config.ts` → `runtimeConfig` |

## 1 · The client tracker

`app/plugins/analytics.client.ts` is a Nuxt client-only plugin. It bails
out immediately on `/ops` pages and for opted-out browsers, then wires up
the whole pipeline. Every callback is wrapped in a `safe()` helper that
swallows exceptions — the design rule is **fail open**: an analytics bug
must never break the page. (The server side of the admin console has the
opposite rule — see §9.)

### Identity

Two identifiers, both random UUIDs, no fingerprinting:

- **`vid`** (visitor id) — `localStorage.rb_vid`, minted once per browser,
  lives forever. Answers "have I seen this browser before?"
- **`sid`** (session id) — `rb_sid` cookie with a 30-minute max-age,
  refreshed on every flush. When a visitor comes back after 30+ minutes
  of silence, the cookie has expired and a new session begins.

A `returning` flag (vid existed, sid cookie didn't) rides along in the
envelope so the server can count *visits* rather than *requests*: the
`visitors.visit_count` upsert only increments when the server sees a sid
it hasn't seen before.

### What gets tracked

The event taxonomy — 13 types, and the server rejects anything else:

| Type | Fired when | Payload highlights |
| --- | --- | --- |
| `pageview` | plugin boot | referrer, UTM ×5, screen/viewport/DPR, timezone, language, platform, touch, deviceMemory, cores, connection type |
| `section_enter` / `section_exit` | an element with `data-section` crosses 40% visibility (IntersectionObserver, thresholds `[0, 0.4]`) | dwell time in ms on exit; open sections are force-exited on `pagehide` so dwell isn't lost |
| `scroll_depth` | page scrolled past 25 / 50 / 75 / 90 / 100% (rAF-throttled, each milestone fires once) | the milestone pct |
| `click` | any `pointerdown` (capture phase) | CSS selector path, trimmed text (60 chars), x/y, enclosing section |
| `outbound` | a click resolves to an `http(s)` link on another origin | host, href, link label, section — followed by an immediate flush, since navigation may kill the page |
| `heartbeat` | every 15 s while the tab is visible **and** there was input in the last 30 s | empty — its existence is the data; the server turns each one into 15 s of `duration_ms`, so session duration means *active* time, not wall-clock |
| `vitals` | once, on first `visibilitychange: hidden` / `pagehide` | TTFB, LCP, CLS, INP — hand-rolled from `PerformanceObserver`, no web-vitals dependency |
| `js_error` | `window.onerror` + `unhandledrejection`, capped at 10/page | message (300), source (200), line, stack (1000) |
| `boot_done` / `boot_skipped` | the loading splash finished or was skipped | — |
| `easter_egg` | someone found one (`console` or `konami`) | — |
| `replay_stopped` | the rrweb recorder hit a cap | reason |

Components outside the plugin (the boot splash, the easter eggs) report
through `window.__rbTrack`, so the plugin remains the single owner of the
queue.

### Batching and delivery

Events accumulate in an in-memory queue, flushed as one JSON envelope
when any of these fires: **20 events queued**, a **5-second timer**, the
tab going **hidden**, **`pagehide`**, or an **outbound click**. Lifecycle
flushes prefer `navigator.sendBeacon` (survives page teardown) and fall
back to `fetch(…, { keepalive: true })`; delivery failures are dropped
silently — this is telemetry, not transactions.

### Opt-out

Visiting any URL with `?optout=1` writes `localStorage.rb_optout`; from
then on the plugin returns before doing anything. There's no
server-side state — the tracked browser simply stops talking.

## 2 · Session replay (client)

`app/utils/analytics/replay.ts` records a sampled subset of sessions with
[rrweb](https://www.rrweb.io/), tuned to stay cheap and private:

- **Sampled and lazy.** `public.replaySampleRate` (0..1) decides per
  session. Recording starts after `window.load` inside
  `requestIdleCallback`, and rrweb itself is a dynamic import, so
  non-sampled visitors never download it.
- **Privacy defaults.** `maskAllInputs: true` (keystrokes are recorded as
  `*`), plus a `rr-block` CSS class to redact any element wholesale.
- **Chunked uploads.** Events buffer in memory and ship to
  `POST /api/replay` every 10 s or at ~500 KB, gzipped with the native
  `CompressionStream` when the browser has it. Each chunk carries three
  headers: `x-rb-sid`, `x-rb-seq` (0..9999), `x-rb-gz`.
- **Hard caps.** Recording stops at 10 minutes or 5 MB compressed,
  whichever comes first, and reports a `replay_stopped` event with the
  reason. On `pagehide` a final tail chunk is sent only if it fits the
  ~64 KiB `fetch keepalive` quota — losing the tail is acceptable by
  design.

## 3 · Ingest: POST /api/collect

`server/api/collect.post.ts` trusts nothing it receives. The pipeline,
in order:

1. **Rate limit** — 60 requests/min per IP (raw, un-anonymized IP; see §5).
2. **Size guards** — body over 256 KB → 413, checked against both the
   declared `Content-Length` and the actual received bytes.
3. **Envelope validation** — must be `{ v: 1, vid, sid, returning, url,
   events[] }` with vid/sid matching `^[0-9a-fA-F-]{16,64}$`. Max 100
   events per envelope; extras are dropped.
4. **Per-event sanitization** — a whitelist `switch` on the 13 known
   types. Every string is length-clamped, every number checked with
   `Number.isFinite`, scroll percentages must be one of the five
   milestones, easter-egg names one of the two known eggs. Timestamps
   are clamped into `[now − 7 d, now + 60 s]` so a wrong client clock
   can't scatter rows across the timeline. Serialized payloads over
   4 KB are nulled. Unknown or malformed events are silently dropped —
   never an error, so a hostile client learns nothing.
5. **Enrichment** — UA parsed into browser/OS/device (§5), geo read off
   Cloudflare's request metadata (§5), bot flag computed (§6).
6. **One atomic write** — everything lands in a single `db.batch()`:

   - `visitors` upsert: bump `last_seen_at`, increment `visit_count`
     only if this sid is new.
   - `sessions` upsert: `pageviews` and `duration_ms` *accumulate*,
     `max_scroll_pct` takes the max. Upserts with `excluded.*` are used
     instead of read-then-write because D1 has no interactive
     transactions — but a batch is atomic, so concurrent envelopes from
     the same session can't lose updates.
   - `events` inserts, 20 rows per statement: D1 caps a statement at 100
     bound parameters, and 20 rows × 5 columns = exactly 100.

Success is a `204` with no body — the client never gets data back, only
an acknowledgment.

## 4 · Ingest: POST /api/replay

`server/api/replay.post.ts` accepts one chunk per request:

- Rate limit 30/min per IP; chunk ≤ 2 MB; session total ≤ 15 MB
  (computed from D1's `replay_chunks` accounting rows, excluding a chunk
  the same seq would replace).
- The sid regex (`^[0-9a-fA-F-]{16,64}$`) doubles as **key-injection
  defense**: the sid becomes part of an R2 object key, and hex-and-dashes
  can't traverse or collide with anything.
- Objects are stored as `replays/<sid>/<00042>.json[.gz]` — zero-padded
  seq so lexicographic order is playback order. A re-sent seq may have
  flipped compression, so the stale twin extension is deleted.
- Bookkeeping is a batch: `INSERT OR REPLACE` into `replay_chunks`
  (bytes, compressed, created_at — this table is how both the 15 MB
  session cap and the global 2 GB cap are enforced without ever listing
  R2), plus `UPDATE sessions SET has_replay = 1`. The session row may
  not exist yet if the replay chunk raced ahead of the first
  `/api/collect` — the UPDATE is then a no-op and the chunk is still
  accepted.

## 5 · Server-side enrichment

**User agent** (`server/utils/ua.ts`) — a small ordered regex table, not
a library: Edge and Opera ship Chrome tokens and Chrome ships a Safari
token, so order is the parser. Good enough for a personal-site dashboard.

**Geo** (`server/utils/geo.ts`) — Cloudflare attaches country / region /
city / lat / lon to every request (`request.cf`) for free, so there is no
GeoIP database to license, ship, or update. Locally it's simply null.

**IP** (`server/utils/ip.ts`) — two forms, used for different things:

- `getClientIp` (raw): `cf-connecting-ip` first (set by Cloudflare's
  edge, unspoofable), then `x-real-ip` / `x-forwarded-for` when
  `trustProxy` is on, then the socket. Used for **rate limiting** only.
- `getStorageIp` (stored): the same IP, anonymized first when
  `NUXT_IP_ANONYMIZE=true` — last IPv4 octet zeroed, IPv6 truncated to
  its /48. This is the only form that ever reaches the database. Geo is
  unaffected either way, since it comes from the edge, not the stored IP.

## 6 · Bot detection

Two layers, both resulting in `sessions.is_bot = 1` — flagged, not
blocked, so bot traffic is *visible* in /ops (toggleable) but excluded
from the headline numbers:

1. **UA wordlist** (`isBotUA`): empty UA, or anything matching
   `bot|crawl|spider|headless|curl|python|…`.
2. **Honeypot**: `GET /void.html` is a trap route no human is meant to
   reach. Any visit flags that IP in D1's `honeypot_ips` for 24 h *and*
   retro-flags the IP's sessions from the previous 24 h. The flag lives
   in D1 rather than process memory because Workers isolates are many
   and short-lived — an in-memory flag would evaporate mid-crawl.
   `/api/collect` checks the table on every envelope.

## 7 · Storage

### D1 (SQLite at the edge)

Five tables, defined in `migrations/0001_init.sql`:

| Table | Grain | Notes |
| --- | --- | --- |
| `visitors` | one row per browser (`vid`) | first/last seen, visit_count, first-touch referrer + UTM |
| `sessions` | one row per session (`sid`) | timing, stored IP, UA + parsed browser/OS/device, screen/viewport, geo, referrer/UTM, entry path, pageviews, max scroll, `is_bot`, `has_replay`; indexed on `started_at` and `vid` |
| `events` | one row per event | `sid` FK (`ON DELETE CASCADE`), ts, type, name, JSON payload; indexed on `(sid, ts)` and `(type, ts)` |
| `replay_chunks` | one row per uploaded chunk | PK `(sid, seq)`, bytes, compressed flag — the accounting ledger for every size cap |
| `honeypot_ips` | one row per flagged IP | `expires_at` for the 24 h TTL |

### R2 (object storage)

Replay payloads only, under `replays/<sid>/<seq>.json[.gz]`. R2 is never
listed on the hot path — all size accounting goes through
`replay_chunks` — the only listing happens inside the prune job when it
sweeps a whole session prefix.

## 8 · Retention: the daily prune

`wrangler.jsonc` registers a cron trigger (`17 9 * * *` UTC); Cloudflare
invokes the Worker's `scheduled()` export, which Nitro surfaces as the
`cloudflare:scheduled` hook that `server/plugins/prune.ts` listens on.
Each run:

1. Deletes replay chunks older than `NUXT_REPLAY_RETENTION_DAYS`
   (default 30) — R2 objects first, then their D1 rows.
2. Deletes events older than `NUXT_EVENT_RETENTION_DAYS` (default 180).
3. Enforces a **2 GB global replay cap** from the accounting table:
   oldest sessions are evicted whole (a prefix list + delete that also
   sweeps stale twins and orphans) until under the cap.
4. Clears `has_replay` on sessions whose chunks are all gone.
5. Drops expired honeypot flags.

Visitor and session rows are deliberately kept — they're tiny, and
they're the long-term "who visited when" record.

## 9 · The /ops console

The admin UI at `/ops` is a client-rendered Nuxt island (`ssr: false`,
`X-Robots-Tag: noindex`) with its own dark theme, reading exclusively
from `GET /api/ops/*`:

| Endpoint | Returns |
| --- | --- |
| `overview` | visits today, active-now (last 60 s), uniques, avg active time, replay storage totals, 30-day daily series (gap-filled), top outbound hosts, recent sessions |
| `aggregates` | top-12 breakdowns (referrers, countries, cities, devices, browsers, languages), per-section dwell, scroll-depth funnel, recent JS errors |
| `sessions` | paged listing with range / bots / has-replay / country filters (LIKE-escaped) |
| `sessions/:id` | the full session row + its first 2000 events as a timeline |
| `replay/:id` | every stored chunk fetched from R2, gunzipped via `DecompressionStream`, stitched into one flat rrweb event array for the player; damaged or pruned chunks are skipped |

All of them start with `requireAdmin(event)`, and auth is where the
failure philosophy flips — the admin side **fails closed**:

- Login (`POST /api/ops/login`) is throttled to 5 attempts/min per IP
  and compares against `NUXT_ADMIN_PASSWORD` in constant time (both
  sides SHA-256'd to a fixed length first, so `timingSafeEqual` can
  never throw or leak length). Success seals `admin: true` into an
  iron-encrypted `rbops` cookie (7-day max-age, SameSite=Lax). No
  password set in production → `/ops` is disabled entirely, not open.
- The cookie's sealing key is `NUXT_SESSION_PASSWORD` when set; otherwise
  it's derived as `sha256("rbops-session:" + adminPassword)`. A nice
  side effect: **rotating the admin password force-logs-out every
  existing session**, because the old cookies can no longer be unsealed.
- Bot rows are excluded from every ops query by default; `?bots=1` opts
  them back in.

The client tracker also refuses to run on `/ops` pages — the admin
watching the dashboard doesn't show up in it.

## 10 · Why it's shaped this way (Workers constraints)

Several decisions only make sense against the Cloudflare Workers runtime:

| Constraint | Consequence in this codebase |
| --- | --- |
| D1 has no interactive transactions | All writes are single `db.batch()` calls (atomic) with `ON CONFLICT … excluded.*` upserts carrying the increments |
| D1 caps 100 bound params per statement | Event inserts go 20 rows × 5 columns at a time |
| Workers isolates are many + ephemeral | Rate limiter is per-isolate in-memory (effective limit ≈ limit × isolates — fine for throttling, zero D1 reads on the hot path); honeypot flags must live in D1 |
| R2 has no cheap recursive stat | Every size cap reads the `replay_chunks` ledger instead of listing the bucket |
| `fetch keepalive` bodies cap at 64 KiB | The replay tail flush skips itself when the final chunk won't fit |
| `request.cf` carries geo for free | No GeoIP database anywhere |
| Cron triggers are a first-class Worker event | Retention is one daily `scheduled()` run, no external scheduler |

And the two failure philosophies, stated once more because they're the
spine of the design: the **collection path fails open** (a broken tracker
must never break the résumé), the **admin path fails closed** (a missing
password must never expose the data).

## Trying it locally

```sh
npm run db:migrate:local   # create the local D1 schema once
npm run dev                # bindings provided by nitro-cloudflare-dev
npm run seed               # synthetic visit + assertions straight from the local SQLite file
```

The seed script (`scripts/seed-visit.mjs`) exercises the entire pipeline
— pageview, dwell, scrolls, clicks, outbound, heartbeats, vitals, two
gzipped replay chunks — then opens the local D1 file and asserts every
row landed, including the 429 rate-limit path and bot flagging. The
Playwright suite (`tests/`) does the same with a real browser, replay
player included. Deployment and configuration knobs live in the main
[README](../README.md) (SEG 03–04).
