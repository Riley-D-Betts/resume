# ANALYTICS ARCHITECTURE

How the first-party analytics behind this site is built: what the browser
collects, how it reaches the server, where it's stored, how it's pruned,
and how the `/ops` console reads it back. No third-party trackers, no
external services — every byte stays inside one Cloudflare account, and
the whole thing fits the free tier.

## The big picture

```
  visitor's browser (public pages only)
  ┌────────────────────────────────────────────────────────────────┐
  │ analytics.client.ts  →  app/utils/analytics/*                  │
  │  core      identity, queue, flush, caps, early perf observers  │
  │  pages     pageview / page_leave per page (SPA-aware), scroll, │
  │            active time, heartbeats, visibility                 │
  │  sections  [data-section] dwell per page                       │
  │  interact. clicks, rage/dead, outbound + mailto, copy/select,  │
  │            print, find, hover, exit intent, viewport           │
  │  errors    js / resource / console errors                      │
  │  perf+env  vitals, nav timing, resources, long tasks, env probe│
  │  replay    rrweb, one recording (rid) per document load        │
  └──────┬─────────────────────────────────────┬───────────────────┘
         │ JSON envelopes (v2)                  │ gzipped chunks
         ▼                                      ▼
   POST /api/collect                      POST /api/replay
     sanitize + clamp, rollups,             rb_rt token, per-sid cap,
     rate-limit, enrichment, bot flag       ledger row → R2 put → flip
         │  one atomic db.batch()               │
         ▼                                      ▼
   ┌────────────────────────────┐        ┌────────────────────────┐
   │ D1 (SQLite)                │◀───────│ R2 replays/<sid>/<rid>/│
   │ visitors · sessions        │ ledger │ <seq>.json.gz          │
   │ session_net · session_env  │        └────────────────────────┘
   │ page_visits · page_perf    │                   ▲
   │ events · replay_chunks_v2  │                   │ stitch + inflate
   │ honeypot_hits · rdns_cache │                   │ (byte-budgeted)
   │ login_attempts             │                   │
   └──────────┬─────────────────┘                   │
              │ reads                               │
              ▼                                     │
   GET/POST /api/ops/*  ◀── password-gated /ops console (12 views,
                            SQL console, export, replay player)

   daily cron ──▶ server/plugins/prune.ts ──▶ retention, PII scrub, caps
```

Two write paths in, one read path out, one janitor. Everything below is
the detail.

## File map

| Piece | File |
| --- | --- |
| Wire contract (31 event types, payload types, caps) | `shared/analytics/events.ts` |
| Ops API response types | `shared/analytics/ops.ts` |
| SQL console presets | `shared/analytics/cookbook.ts` |
| Client plugin (composes the tracker) | `app/plugins/analytics.client.ts` |
| Tracker modules | `app/utils/analytics/{core,pages,sections,interactions,errors,perf,env,replay}.ts` |
| SSR handoff of document-request facts | `server/middleware/nav-capture.ts` → `app/plugins/nav-capture.server.ts` |
| Component bridge (`window.__rbTrack`) | `app/composables/useTrack.ts`, `app/types/rb-track.d.ts` |
| Easter eggs | `app/plugins/egg.client.ts` |
| Event ingest | `server/api/collect.post.ts` |
| Per-event whitelist + rollups | `server/utils/sanitize.ts` |
| Batch SQL + bind arrays + param guard | `server/utils/collectSql.ts`, `server/utils/collectBind.ts`, `server/utils/d1.ts` |
| Replay chunk ingest | `server/api/replay.post.ts` |
| Replay token, R2 key layout, stitcher | `server/utils/replayAuth.ts`, `server/utils/replayKeys.ts`, `server/utils/replayStitch.ts` |
| Cloudflare `request.cf` + header facts | `server/utils/cf.ts`, `server/utils/clientHints.ts` |
| Reverse DNS (opt-in) | `server/utils/rdns.ts` |
| Timezone offsets / owner-tz bucketing | `server/utils/tz.ts`, `server/utils/opsTz.ts` |
| UA parsing / bot wordlist / honeypot | `server/utils/ua.ts`, `server/utils/bots.ts`, `server/routes/void.html.get.ts` |
| IP extraction + anonymization | `server/utils/ip.ts` |
| In-memory rate limiter | `server/utils/ratelimit.ts` |
| Cloudflare bindings accessors | `server/utils/db.ts` |
| Health | `server/api/health.get.ts` |
| Daily retention prune | `server/plugins/prune.ts` |
| D1 schema | `migrations/0001_init.sql`, `0002_side_tables.sql`, `0003_session_columns.sql` |
| /ops auth (sealed cookie, D1 lockout) | `server/utils/auth.ts`, `server/api/ops/login.post.ts` |
| /ops read API | `server/api/ops/**` |
| /ops query surface, cache, SQL guard, CSV | `server/utils/{opsFilters,opsCache,sqlGuard,csv,orgKind,opsDb,opsPercentile}.ts` |
| /ops UI | `app/layouts/ops.vue`, `app/middleware/ops-auth.ts`, `app/composables/useOps*.ts`, `app/components/ops/*`, `app/pages/ops/**` |
| Bindings, cron, plain vars | `wrangler.jsonc` |
| Retention / sampling / privacy config | `nuxt.config.ts` → `runtimeConfig` |
| Seed + tests | `scripts/seed-visit.mjs`, `tests/unit/*.test.ts`, `tests/e2e/*.spec.ts` |

## 1 · The client tracker

`app/plugins/analytics.client.ts` is a Nuxt client-only plugin that
composes the modules under `app/utils/analytics/`. It bails out on `/ops`
pages, for opted-out browsers, and (when `NUXT_PUBLIC_HONOR_GPC=true`) for
browsers that send Global Privacy Control. Every listener is wrapped in a
`safe()` helper that swallows exceptions — the design rule is **fail
open**: an analytics bug must never break the page. (The admin console has
the opposite rule — see §9.)

### Identity

Two identifiers, both random UUIDs, no fingerprinting (§10 explains what
is deliberately *not* collected):

- **`vid`** (visitor id) — `localStorage.rb_vid`, minted once per browser.
- **`sid`** (session id) — `rb_sid` cookie, 30-minute max-age, refreshed on
  every flush and heartbeat, `Secure` on https. The tracker **re-reads the
  cookie before every timer flush and whenever the tab becomes visible**:
  if it has expired (30 min idle) or another tab has rotated it, the
  tracker adopts / mints the new sid, starts a new page visit
  (`pageview kind:'reload'`) and marks the envelope `returning`. Lifecycle
  flushes (hidden / pagehide / outbound) never rotate the sid — their
  events belong to the session that produced them.
- **`rb_rr`** — the replay sampling decision (`1|0`), persisted per sid so a
  reload or second tab never re-rolls it.
- **`rb_rt`** — set by the *server* on every accepted `/api/collect`
  response (HttpOnly): the replay upload token, see §4.

`returning` is validated by the server but no longer stored — the server
derives `is_returning` / `visit_n` from the `visitors` row it upserts.

### Page lifecycle (the SPA fix)

The site is an SPA after hydration, so "one pageview per load" would count
sessions, not pages. `pages.ts` keeps one **visit** object per page:

- `pageview` fires at init (`kind` from the Navigation Timing entry:
  `initial | reload | back_forward | prerender`), on every router
  navigation once `page:finish` has fired (`spa`, or `spa_back` after a
  `popstate`, with `softNavMs`), on a bfcache restore (`bfcache`) and on a
  sid rotation (`reload`). Each visit has its own `pvid`; the id of the
  *document* load (`docPvid`) is pinned so `vitals` / `perf` always
  reference the page that actually loaded.
- `page_leave` fires on route change (`reason:'spa'`) and `pagehide`
  (`'unload'`) with exact active / hidden ms, blurs, max scroll %, scroll
  px / reversals / velocity, sections seen, click / pointer / touch / key
  counts, console errors and the page's text length (for reading speed).
- `heartbeat` every 15 s while the tab is visible **and** there was input
  in the last 30 s, carrying `{ pvid, activeMs, maxScrollPct }` so a
  discarded mobile tab still leaves its active time behind.
- `visibility` snapshots on hide / show; open sections are force-exited on
  hide and re-armed on show, so dwell never counts a hidden tab.
- Scroll milestones (25 / 50 / 75 / 90 / 100 %) reset per visit and are
  measured on mount, route change and resize (a page that fits the
  viewport is 100 %). Milestone measuring is re-armed two animation frames
  after `page:finish` — after the router has issued its scroll-to-top — so
  the restore itself is not counted as reading; the arming assumes that
  scroll is instant, which is why `scroll-behavior` on the document matters
  to it.
- The initial `pageview.path` is `location.pathname` captured at init —
  it drives `sessions.entry_path`; `pageview.nav` carries the
  document-request facts the SSR middleware captured (`Sec-Fetch-*`,
  `Referer`, `cf-ray`, `Early-Data`) — the only trustworthy
  "typed URL vs came from elsewhere" signal.

### What gets tracked

31 event types (`EVENT_TYPES` in `shared/analytics/events.ts`); the server
rejects anything else. Every event carries `t` (client clock, order only),
`type`, `name`, `u` (pathname at emit, ≤ 200) and a typed payload `p`:

| Type | Fired when | Payload highlights |
| --- | --- | --- |
| `pageview` | init / route change / bfcache / sid rotation | `pvid`, `path`, `from`, `kind`, `softNavMs`; initial loads add referrer, UTM ×5, screen / viewport, tz + offset, lang, `nav` doc facts |
| `page_leave` | route change / `pagehide` | the visit's time + scroll + input accounting, `textLen`, `reason` |
| `heartbeat` | 15 s, visible + recent input | `pvid`, `activeMs`, `maxScrollPct` — **merged, never stored as a row** |
| `visibility` | tab hidden / shown | `state`, `ms`; hidden snapshots carry `pvid`, `activeMs`, `maxScrollPct` |
| `section_enter` / `section_exit` | a `[data-section]` sub-block is ≥ 50 % visible or fills ≥ 60 % of the viewport, for ≥ 500 ms | `dwellMs`, `pvid` on exit — enter is deferred 500 ms so the two are always a pair |
| `scroll_depth` | 25 / 50 / 75 / 90 / 100 % per visit | `pct` |
| `click` | any primary `pointerdown` or keyboard activation | selector path, text (60), x / y, `section` / `zone`, tag, `button` (0 / 1 / 2), `kind` (pointer / touch / pen / keyboard), `href`, modifier |
| `rage_click` | 3+ clicks within 700 ms and 30 px | `n`, selector, section |
| `dead_click` | a click on nothing interactive that changed nothing in 400 ms | selector, text, section |
| `outbound` | a link to another origin **or** `mailto:` / `tel:` | `name` = host / `mailto` / `tel`; href (subject / body stripped), label, section / zone, `newTab` — followed by a keepalive flush |
| `print` | `beforeprint` / `afterprint` | `phase`, `ms` |
| `copy` / `select` | copy / cut / a ≥ 20-char selection — **never inside inputs, textareas or contenteditable** | `len`, `hasEmail`, ≤ 80-char snippet (copy only), section |
| `form` | the contact form funnel via `useTrack()` | `step ∈ focus / input / field / submit / invalid / reset / abandon`, field name, subject, body length — **never values**; `submit` = a `mailto:` was composed and handed to the mail client |
| `find` | Ctrl / Cmd + F, F3 | — |
| `site_search` | global search Enter / pick / blur | lowercased term ≤ 40, result count, chosen |
| `exit_intent` | pointer leaves through the top edge (fine pointers) | x / y |
| `viewport` | resize / zoom / pinch / orientation | size, scale, dpr, orientation, cause |
| `first_interaction` | first pointer / touch / key / wheel | ms since load, kind |
| `hover` | ≥ 300 ms over `[data-track-hover]` (email, GitHub, contact CTA, KPI rows) | `name` = key, `ms` |
| `subtab` | a record subtab actually changes | `name` = label, `index` |
| `env` | once per document load, at idle after `load` | see below — **merged into `session_env`, never a row** |
| `vitals` | first hide / `pagehide` | TTFB, FCP, LCP (+ element selector / size), CLS (max session window: ≤ 1 s gap, ≤ 5 s span), INP (`interactionId > 0` only) — **merged into `page_perf`** |
| `perf` | `load` + 3 s or first hide | nav-timing phases, transfer sizes, protocol, resource summary (count / bytes / cached / by type / 5 slowest as `host/path`), long tasks, LoAF — **merged into `page_perf`** |
| `js_error` / `resource_error` / `console_error` | `error` (capture phase), `unhandledrejection`, a `console.error` wrapper | message / source / stack; browser-extension URLs are scrubbed to `<ext>` on both sides |
| `easter_egg` | `console` / `konami` | — |
| `replay_stopped` / `replay_chunk_lost` | the recorder hit a cap / a chunk upload failed after its retry | reason / `seq`, `rid`, status |

Per-visit caps (`PAGE_CAPS`) bound the chatty types (100 clicks, 5 scroll
milestones, 20 copies …) and a per-session budget of **400 stored event
rows** (`SESSION_EVENT_CAP`) lets only `ESSENTIAL_TYPES` (pageview,
page_leave, vitals, perf, js_error, form, outbound, heartbeat) through
afterwards. The client counts in `sessionStorage.rb_ev_n` as a courtesy;
the server enforces it from `sessions.events_n`.

### The `env` probe

Everything the browser exposes without a permission prompt, probed once
at idle after `load` (3 s budget, each probe individually try/caught):
`navigator.webdriver`, low- and high-entropy UA client hints
(`getHighEntropyValues`: architecture, bitness, model, platform version,
full version list, form factors, wow64), languages, touch points, PDF
viewer, cookies, GPC / DNT as the browser reports them, GPU vendor +
renderer (`WEBGL_debug_renderer_info` on a 1×1 canvas, context released
immediately), WebGPU adapter info (1 s timeout, skipped under Save-Data),
battery, storage estimate, media-device **counts** (labels never read),
`prefers-*` media queries, screen / orientation / colour depth,
`performance.memory`, Network Information, speech-voice count, timezone
name + offset, locale, display mode, outer / inner size, device memory,
cores, platform, touch. **No canvas / audio / font-list hashes** — see §10.

Components outside the plugin (the contact form, subtabs, global search,
the easter eggs) report through `useTrack()` → `window.__rbTrack`, which
validates the type against `EVENT_TYPES` before queueing, so the plugin
remains the single owner of the queue.

### Batching and delivery

Events accumulate in an in-memory queue, flushed as one JSON envelope
`{ v: 2, vid, sid, returning, url, events[] }` (≤ 100 events per envelope)
when any of these fires: **20 events queued**, a **5-second timer**, the
tab going **hidden**, **`pagehide`**, or an **outbound click**. Timer
flushes are plain `fetch`; an outbound click uses `fetch keepalive`;
hidden / pagehide prefer `navigator.sendBeacon` with a keepalive fetch as
fallback. A timer flush that is rejected (network error) is re-queued once,
bounded to 100 events per document load — telemetry, not transactions.

### Opt-out

Visiting any URL with `?optout=1` writes `localStorage.rb_optout`; from
then on the plugin returns before doing anything. The footer's privacy
notice renders that link. There's no server-side state — the tracked
browser simply stops talking. Independently, `NUXT_PUBLIC_HONOR_GPC=true`
makes the tracker stay silent for browsers with `navigator.globalPrivacyControl`.

## 2 · Session replay (client)

`app/utils/analytics/replay.ts` records a sampled subset of sessions with
[rrweb](https://www.rrweb.io/), tuned to stay cheap and private:

- **Sampled and lazy.** `public.replaySampleRate` (0..1) is rolled once
  per sid and persisted in `rb_rr`. Recording starts after `window.load`
  inside `requestIdleCallback`; rrweb is a dynamic import, so non-sampled
  visitors never download it.
- **One recording per document load.** Each load mints a recording id
  (`rid`); chunks are keyed `(sid, rid, seq)` with the page's
  `performance.timeOrigin` as `page_started_at`. A reload or a second tab
  inside the 30-minute session therefore becomes a *second segment*
  instead of overwriting the first one's `seq 0`.
- **Privacy defaults.** `maskAllInputs: true` (keystrokes are `*`),
  `slimDOM`, plus an `rr-block` class to redact any element wholesale.
- **Chunked uploads.** Events buffer in memory and ship to
  `POST /api/replay` every 10 s or at ~500 KB, gzipped with the native
  `CompressionStream`. Headers: `x-rb-sid`, `x-rb-rid`, `x-rb-seq`
  (0..9999), `x-rb-gz`, `x-rb-ps`; the `rb_rt` cookie rides along. The
  **first chunk waits for the first `/api/collect` ack** (that is when the
  token cookie comes into existence), up to 30 s.
- **Bounded retries.** One retry per chunk (never on 400 / 413), at most
  five per document load; a chunk lost after that is reported as
  `replay_chunk_lost { seq, rid, status }` so gaps are visible in /ops.
- **Hard caps.** Recording stops at 10 minutes, 5 MB compressed sent, or a
  4 MB unsent backlog, and reports `replay_stopped` with the reason; the
  stop always drains what is still buffered. On `pagehide` a tail chunk is
  sent only if it fits the ~64 KiB `fetch keepalive` quota — otherwise it
  is kept for a possible bfcache restore.

## 3 · Ingest: POST /api/collect

`server/api/collect.post.ts` trusts nothing it receives. The pipeline,
in order:

1. **Rate limit** — 120 requests/min per raw IP (per isolate).
2. **GPC / DNT** — with `NUXT_HONOR_GPC=true`, a request carrying
   `Sec-GPC: 1` or `DNT: 1` is answered 204 and **nothing is stored**.
   With it off (default) the flags are recorded on the session.
3. **Size guards** — body over 256 KiB → 413, checked against both the
   declared `Content-Length` and the received bytes.
4. **Envelope validation** — `v ∈ {1, 2}` (v1 envelopes from the old
   single-page tracker are still accepted; their events fall back to the
   envelope `url` for `path`), vid / sid matching `^[0-9a-fA-F-]{16,64}$`,
   a boolean `returning`, a `url`, ≤ 100 events.
5. **Per-event sanitisation** (`server/utils/sanitize.ts`) — a whitelist
   `switch` over the 31 types. Every string is length-clamped, every number
   `Number.isFinite`-checked and clamped into a plausible range
   (durations ≤ 6 h, vitals ≤ 120 s, CLS ≤ 10, heartbeats ≤ ⌈wall-clock
   since the last envelope ÷ 15 s⌉ + 1, per-envelope counter caps),
   timestamps clamped into `[now − 7 d, now + 60 s]`, `u` must be a
   same-origin pathname, section names must match `[a-z0-9._:-]{1,40}`,
   hover keys their fixed set, `mailto:` / `tel:` hrefs their scheme +
   address only, serialised payloads over 4 KB (env 6 KB, perf 8 KB) are
   nulled, extension URLs scrubbed. Unknown or malformed events are
   silently dropped — never an error, so a hostile client learns nothing.
   The same pass computes the **rollups**: per-session counters (prints,
   copies, email copies, form steps, mailto clicks, rage / dead / right
   clicks, errors, hovers, …), `entry_path` / `exit_path` / `last_path`,
   the `page_visits` merges keyed by `pvid`, the `page_perf` merges, and
   the typed `session_env` row. **Heartbeats, env, vitals and perf never
   become `events` rows** — they are counted or merged into the typed
   tables.
6. **Pre-check** — one batch: the session row (exists? events budget, last
   envelope time, already a bot?) and the honeypot flag for this
   `(ip, ua)`. An unknown sid with nothing to store gets a 204 and **no
   row** (so the rate-limit burst and empty beacons leave nothing behind).
   A new sid from a storage IP that already started ≥ 300 sessions in 24 h
   → 429 (existing sids always pass).
7. **Enrichment** (§5) — UA parsed into browser / OS / device, `request.cf`
   mapped to typed columns, headers read, optional reverse DNS scheduled.
8. **Bot flag** (§6) — a bot session writes only `sessions` + `session_net`.
9. **One atomic `db.batch()`**, statements in FK order:
   ① `visitors` upsert (13 params, only when the sid is new; `visit_count`
   increments inside the batch only if the sid does not exist yet, so a
   beacon + fetch race can never double-count) → ② `sessions` Statement A
   (70 params: identity, first-write attribution / device / geo, counters
   accumulated with `sessions.col + excluded.col`, `MAX` for flags and
   scroll, `MIN(started_at)`, `exit_path` / `last_path` only from the
   envelope with the newest `last_seen_at`; `is_returning` / `visit_n`
   come from the `visitors` row ① just wrote) → ③ `session_net`
   (39 params, first envelope or whenever the SSR handoff / tz offset
   arrives later; first-write on those columns) → ④ `session_env`
   (62 params, latest non-null wins) → ⑤ `page_visits` ×n (19 params,
   order-independent `MIN` / `MAX` / `COALESCE` merge) → ⑥ `page_perf` ×n
   (38 params, first-write per column) → ⑦ `events` in statements of
   16 rows × 6 columns = 96 params.

   `bindChecked()` (`server/utils/d1.ts`) refuses a statement whose bind
   count differs from its placeholder count, exceeds 100, or contains
   `undefined` / `NaN` (D1 throws `D1_TYPE_ERROR` on `undefined` and fails
   the whole batch — one missed `?? null` would be a total collection
   outage). `tests/unit/collectSql.test.ts` pins every count.
10. **Response** — `204` with the `rb_rt` cookie (§4). The client never
    gets data back, only an acknowledgment.

`sessions.started_at` is the **server receipt time** of the first envelope
(`MIN` on conflict); the client clock only orders events. Each accepted
heartbeat adds 15 s to `sessions.duration_ms` — that number is *heartbeat
time*; the console's "active time" is always `Σ page_visits.active_ms`.

## 4 · Ingest: POST /api/replay

`server/api/replay.post.ts` accepts one chunk per request:

- Rate limit 30/min per IP; GPC honoured the same way as collect; headers
  validated (`x-rb-sid` / `x-rb-rid` by the id regex — which doubles as
  **key-injection defence**, since both become part of the R2 key —
  `x-rb-seq` 0..9999, `x-rb-ps` clamped to `[now − 7 d, now + 60 s]`);
  chunk ≤ 2 MB; per-sid total ≤ 15 MB across all recordings.
- **Authentication.** `/api/collect` answers every accepted envelope with
  `rb_rt = sha256("rb-replay:" + secret + ":" + sid)` (HttpOnly, 30 min,
  `Secure` on https; the secret is `NUXT_SESSION_PASSWORD`, else the admin
  password, else a dev constant). `/api/replay` requires the cookie to
  match `x-rb-sid` in constant time (**401**) and the sid to have a
  non-bot `sessions` row (**403**). A stranger who knows or guesses a sid
  can no longer write chunks into it, and a chunk can never race ahead of
  its session.
- **Write order** (crash-safe): one batch inserts the
  `replay_chunks_v2` accounting row with `pending = 1` — gated by the
  15 MB cap *inside* the statement so concurrent uploads cannot race past
  it — then `bucket.put`, then a stale compression twin is deleted only
  when the previous row says one exists, then a second batch flips
  `pending = 0` and sets `sessions.has_replay = 1` **only once a `seq 0`
  row for that recording is on disk**. A crash between the row and the
  flip leaves a pending row the prune sweeps after 10 minutes.
- Objects are stored as `replays/<sid>/<rid>/<00042>.json[.gz]`
  (`server/utils/replayKeys.ts`); rows migrated from the pre-rid table keep
  the legacy layout `replays/<sid>/<00042>.json[.gz]` under `rid = 'legacy'`.

## 5 · Server-side enrichment

**User agent** (`server/utils/ua.ts`) — an ordered regex table, not a
library: Edge / Opera / Samsung Internet / Vivaldi / Yandex / DuckDuckGo
and the LinkedIn / Facebook / Instagram in-app browsers ship Chrome or
Safari tokens, so order is the parser; iPadOS is told apart from macOS by
`maxTouchPoints` from the env probe; everything else lands in one
`Unknown` bucket.

**`request.cf`** (`server/utils/cf.ts`) — Cloudflare attaches these to every
request for free; read defensively (every field optional, `""` / `0`
placeholders become NULL):

| `cf` field | Column |
| --- | --- |
| `asn`, `asOrganization` | `sessions.asn`, `sessions.as_org` — the free path to "which network / company" |
| `country` (`T1` = Tor → `is_tor`), `region`, `city`, `latitude`, `longitude` | `sessions.*` |
| `colo`, `httpProtocol`, `tlsVersion`, `tlsCipher`, `clientTcpRtt` / `clientQuicRtt` (+ kind), `requestPriority`, `clientAcceptEncoding` | `session_net.*` |
| `tlsClientCiphersSha1`, `tlsClientExtensionsSha1`, `tlsClientHelloLength` | `session_net.tls_*` — automation signals only, see §10 |
| `continent`, `regionCode`, `postalCode`, `metroCode`, `timezone`, `isEUCountry` | `session_net.*`; `cf_tz_offset_min` is computed server-side and compared with the client's offset (a mismatch is a VPN / proxy hint) |
| `botManagement.{score, verifiedBot, ja3Hash, ja4}`, `verifiedBotCategory`, `clientTrustScore` | `session_net.*` — paid-plan fields, NULL on Free; `verifiedBot === true` does flag the session as a bot |

**Headers** on the collect POST: `Accept-Language` (ranked), `Sec-GPC`,
`DNT`, `Save-Data`, low-entropy `Sec-CH-UA` / `-Mobile` / `-Platform`
(GREASE brands filtered), `cf-ray`. The navigation-level headers
(`Sec-Fetch-Site/Mode/Dest/User`, the document `Referer`, `Early-Data`)
only exist on the HTML document request, so `server/middleware/nav-capture.ts`
captures them on the SSR response, `app/plugins/nav-capture.server.ts`
hands them to the client through `useState('rbNav')`, the initial
`pageview.nav` carries them back and they land in `session_net.fetch_*`,
`doc_referer`, `early_data`.

**Reverse DNS** (`server/utils/rdns.ts`, opt-in `NUXT_RDNS_ENABLED=true`,
ignored while IPs are anonymised) — a PTR lookup over Cloudflare's DoH
resolver for the session IP, on the first envelope only, cached in
`rdns_cache` (7 d positive, 1 d negative), resolved after the response via
`waitUntil`, back-filled into `session_net.rdns_host`. This is the one
place a visitor IP leaves the Worker — to a Cloudflare resolver, and only
when you switch it on.

**IP** (`server/utils/ip.ts`) — `getClientIp` (raw: `cf-connecting-ip`, then
`x-real-ip` / `x-forwarded-for` when `trustProxy`, then the socket) is
used for **rate limiting** only; `getStorageIp` is the same address,
anonymised first when `NUXT_IP_ANONYMIZE=true` (last IPv4 octet zeroed,
IPv6 truncated to /48). Only the storage form reaches the database. Geo is
unaffected — it comes from the edge, not the stored IP.

## 6 · Bot detection

Three layers, each ending in `sessions.is_bot = 1` — flagged, not blocked,
so bot traffic is *visible* in /ops (INCLUDE BOTS) but excluded from the
headline numbers. A bot session keeps only its `sessions` + `session_net`
rows: no events, no page visits, no env.

1. **UA wordlist** (`isBotUA`): empty UA, or anything matching
   `bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|python|curl|wget|scrapy|httpclient|node-fetch|axios`.
2. **Verified bots**: Cloudflare's `botManagement.verifiedBot` (paid plans;
   NULL and ignored on Free).
3. **Honeypot**: `GET /void.html` is a trap route no human can reach — the
   footer plants a `visibility:hidden`, `pointer-events:none`,
   `aria-hidden`, `tabindex=-1`, 1×1 px link to it and `robots.txt`
   disallows it. A hit flags the **`(ip, ua)` pair** in `honeypot_hits`
   for 24 h and retro-flags that pair's sessions from the previous 24 h —
   keying on the UA too means one scanner behind an office NAT no longer
   hides the office. Only navigation-like requests count
   (`Sec-Fetch-Dest` document or absent, `Sec-Fetch-Site` not
   `cross-site`): an `<img src="…/void.html">` embedded on another site
   can no longer flag a bystander. Flags live in D1 rather than process
   memory because Workers isolates are many and short-lived.

`navigator.webdriver` is stored separately (`sessions.is_webdriver`) and
shown as a lamp / filter — it is *not* folded into `is_bot`. A session
flagged by the honeypot shows its UA in the session detail so collateral
is diagnosable.

## 7 · Storage

### D1 (SQLite at the edge)

| Table | Grain | Notes |
| --- | --- | --- |
| `visitors` | one row per browser (`vid`) | first / last seen, `visit_count`, first-touch referrer + UTM, first / last org + country, first entry path |
| `sessions` | one row per session (`sid`), **71 columns** | timing, stored IP, UA + parsed browser / OS / device, screen / viewport, geo, referrer / UTM, `entry_path` / `exit_path` / `last_path`, `nav_kind`, `asn` / `as_org`, `is_bot`, `is_webdriver`, `gpc` / `dnt` / `save_data` / `is_tor`, `is_returning` / `visit_n`, `has_replay`, `pageviews`, `duration_ms` (heartbeats), `max_scroll_pct`, 25 counters (prints, copies, email_copies, selects, form_started / submitted, finds, searches, exit_intents, rage / dead / right clicks, errors, outbounds, mailto_clicks, hovers, eggs, subtabs, hidden_ms, blurs, ptr / touch / key counts, first_interaction_ms, events_n). Indexes: `started_at`, `(vid, started_at)`, `ip`, `as_org` |
| `session_net` | 1:1 with sessions | `request.cf` network / geo extras, TLS facts, request headers, the document-request `fetch_*` facts, client vs Cloudflare tz offsets, `rdns_host` |
| `session_env` | 1:1 with sessions | the typed `env` probe (62 columns), latest non-null wins |
| `page_visits` | one row per page visit (`pvid`) — **the unit of page analytics** | path, entered / left, `from_path`, `nav_kind`, `soft_nav_ms`, active / hidden ms, scroll stats, sections seen, clicks, text length, leave reason. Indexes: `(sid, entered_at)`, `(path, entered_at)` |
| `page_perf` | one row per document load / SPA visit (`pvid`) | vitals, nav-timing phases, sizes, protocol, resource summary (JSON), long tasks / LoAF, `soft_nav_ms`. Indexes: `ts`, `sid` |
| `events` | one row per stored event | `sid` FK, ts, type, name, JSON payload, **`path`**; indexes `(sid, ts)`, `(type, ts)` — no index on `path` (rows-written budget; page questions go through `page_visits`) |
| `replay_chunks_v2` | one row per uploaded chunk | PK `(sid, rid, seq)`, bytes, compressed, `pending`, `page_started_at`; the ledger every size cap reads. `replay_chunks` (0001) is legacy: never dropped, never written, copied in under `rid = 'legacy'` |
| `honeypot_hits` | one row per flagged `(ip, ua)` | 24 h TTL; `honeypot_ips` (0001) stays for the legacy sweep |
| `rdns_cache` | one row per looked-up IP | host or NULL, `expires_at` |
| `login_attempts` | one row per client IP (/64 for IPv6) | the durable /ops login throttle |

Schema rules, written at the top of every migration: never drop or rename
a column; `ALTER … ADD COLUMN` only with constant defaults (O(1) on D1,
old Worker code keeps working); ≤ 100 columns per table and ≤ 100 bound
params per statement — new per-session facts go to 1:1 side tables;
every index costs one extra row written per insert, so each one is
justified in a comment; D1 **enforces foreign keys**, so every FK child
column is the leading column of some index (a parent delete would
otherwise scan the child — `tests/unit/migrations.test.ts` asserts this).

### Migrations and recovery

`0001_init.sql` is the original schema and must never be edited.
`0002_side_tables.sql` is **fully idempotent** (`CREATE … IF NOT EXISTS`,
`DROP INDEX IF EXISTS`, `INSERT OR IGNORE`) and can be re-run on any
database. `0003_session_columns.sql` holds the `ALTER TABLE … ADD COLUMN`
list, which SQLite cannot make re-runnable, so it lives apart.

Run `npm run db:migrate:remote` **before** `npm run deploy` (the old Worker
tolerates the new columns; the new Worker needs them). If something goes
wrong:

- A database bootstrapped by the pre-wrangler `migrate.ts` has no
  `d1_migrations` row for 0001, so wrangler wants to apply it again and
  fails on `CREATE TABLE visitors`. Insert the bookkeeping row first:
  `npx wrangler d1 execute resume-analytics --remote --command "INSERT INTO d1_migrations (name, applied_at) VALUES ('0001_init.sql', CURRENT_TIMESTAMP)"`
  then run the migration again.
- 0003 failed part-way (some columns exist, wrangler reports `duplicate
  column name`): apply the remaining `ALTER` lines by hand with
  `--command "ALTER TABLE …"`, then insert its bookkeeping row the same way
  (`'0003_session_columns.sql'`).
- 0002 can simply be re-run.

### R2 (object storage)

Replay payloads only, under `replays/<sid>/<rid>/<seq>.json[.gz]`. R2 is
never listed on the hot path — all size accounting goes through
`replay_chunks_v2` — the only listings happen inside the prune job (a
whole-session prefix when evicting under the cap, and one bounded pass for
orphans).

## 8 · Retention: the daily prune

`wrangler.jsonc` registers a cron trigger (`17 9 * * *` UTC); Cloudflare
invokes the Worker's `scheduled()` export, which Nitro surfaces as the
`cloudflare:scheduled` hook that `server/plugins/prune.ts` listens on. A
cron invocation gets **50 subrequests** on Free (every D1 call, R2 call and
fetch counts), so a budget counter wraps every call, the run stops cleanly
at 40 and logs the carry-over, every loop is bounded to ≤ 8 iterations,
and every step logs `changes` / `rows_read` in its own try/catch. Steps:

1. Replay chunks older than `NUXT_REPLAY_RETENTION_DAYS` (30) — R2 objects
   first, then rows.
2. `events` older than `NUXT_EVENT_RETENTION_DAYS` (180), deleted in rolling
   48-hour *session* bands (`sid IN (SELECT sid FROM sessions WHERE
   started_at …)`) so both indexes are used; a missed night drains over the
   following runs.
3. `page_perf` past the same cutoff, by `ts` band.
4. `page_visits`, `session_env`, `session_net` past
   `NUXT_SIDE_TABLE_RETENTION_DAYS` (365), same banding.
5. The **2 GB global replay cap**: oldest sessions are evicted whole
   (prefix list + delete) until under the cap.
6. `has_replay` cleared on sessions whose completed chunks are all gone.
7. Expired honeypot flags (`honeypot_hits` + legacy `honeypot_ips`).
8. Expired `rdns_cache` rows.
9. **PII scrub**: `ip`, `ua`, `lat`, `lon` nulled on sessions older than
   `NUXT_PII_RETENTION_DAYS` (365), 500 rows per statement.
10. Orphan sweeps: `pending = 1` ledger rows older than 10 minutes (both
    compression twins deleted, row dropped) and one bounded R2 list pass
    from a random prefix (keys are UUID-led, so successive nights cover the
    space) deleting objects with no ledger row or a stale twin.
11. When `NUXT_SESSION_RETENTION_DAYS > 0`: ≤ 100 whole sessions per run,
    children deleted explicitly first (≈ 190 rows written per session).
12. `visitors` with no sessions left (≤ 500 per run).

By default visitor and session rows are kept forever — they're tiny and,
after the PII scrub, they're the long-term "who visited when" record with
nothing personal left in them.

## 9 · The /ops console

The admin UI at `/ops` is a client-rendered Nuxt island (`ssr: false`,
`X-Robots-Tag: noindex`, and — because it renders untrusted rrweb DOM — a
Content-Security-Policy that keeps everything same-origin, with `blob:`
frames for the player) under its own dark theme, reading exclusively from
`/api/ops/*`. Every view shares a filter bar (range 24h / 7d / 30d / all /
custom from–to, COMPARE to the previous period, INCLUDE BOTS, org, path,
country, device, browser, OS, returning, has-replay, webdriver, intent
flags, free text) whose state round-trips through the URL; day / hour
buckets are computed in **the owner's timezone** (`?tz=`), never UTC.

| View | Answers |
| --- | --- |
| **Overview** `/ops` | tiles with deltas (sessions, visitors, returning %, pageviews, avg active time = Σ `page_visits.active_ms`, bounce %, mail handoffs, mailto clicks, email copies, ACTIVE NOW = input in the last 60 s, replays), live strip, sessions / pageviews / visitors series, day×hour heatmap, top orgs / pages / referrers (by host) / entry / exit paths, intent tiles, errors (count, not LIMIT), D1 / R2 size readouts |
| **Pages** + detail | per-path pageviews, sessions, entries / exits, avg + p50 active time, scroll %, bounce, errors, reading speed; section dwell and clicks per page; "page-level data since" |
| **Flows** | path→path edges, top 20 sequences (sampled from the newest ≤ 1 000 sessions), the funnel entered → viewed /contact → form focus → mail handoff |
| **Organizations** + detail | "who is looking": grouped by `as_org` with an org / isp / cloud badge (`HIDE ISP/CLOUD`), sessions, visitors, returning, pages read, prints / copies / mail signals, countries, first / last seen, rDNS hosts, drill-down |
| **Visitors** + `[vid]` | per-visitor history, recency / frequency cohorts, total active time, intent, session timeline |
| **Sessions** + `[id]` | keyset-paged list; detail = session facts, visitor, path timeline, env panel (bot reason + honeypot UA, TZ-mismatch lamp), perf, event timeline with LOAD MORE, replay player (segments played in order) |
| **Intent** | prints, copies (email copies), selects, find-in-page, site searches, exit intents, rage / dead clicks by page and selector, form funnel by step and subject, hover keys |
| **Performance** | p50 / p75 / p95 for TTFB, FCP, LCP, CLS, INP, DCL, load, soft-nav — overall and by device / browser / OS / country / page / protocol, computed in SQL over a ≤ 5 000-row sample; LCP series + histogram + elements, nav-phase breakdown, slowest resources, long tasks / LoAF, RTT / protocol / TLS / colo |
| **Technology** | GPU, UA-CH facts, protocols, network quality, `prefers-*`, TZ-offset mismatch, webdriver — top 12 + Other |
| **Errors** | grouped JS / resource / console errors with counts and last seen, by browser / page |
| **SQL console** `/ops/sql` | read-only `SELECT` / `WITH` (+ `EXPLAIN QUERY PLAN`), schema browser with ≈ row counts, cookbook presets, saved queries, COPY CSV |
| **Export** | CSV / NDJSON of sessions / visitors / page_visits / page_perf / events for the current filter |

The nav strip lists twelve links, each gated on the route actually
existing, so a partial deploy never 404s.

### The read API

All routes start with `requireAdmin(event)`. Aggregates go through a 30 s
per-isolate LRU cache (200 entries, keyed by URL); `live`, the session
list / detail / events, visitor detail, `sql`, `export` and `replay` are
never cached; `schema` is cached 5 min. Budgets per endpoint: ≤ 20 D1
calls, ≤ 5 000 rows deserialised, no in-JS sort of > 2 000 items,
response ≤ 1 MB.

| Route | Returns |
| --- | --- |
| `GET overview` (`compare=1`) | `Overview`: stats (+ previous period), series, heatmap, top lists, intent, errors, recent, replay + D1 readouts, `activeNow` |
| `GET live` | sessions with input in the last 60 s (scans the last 6 h of `started_at`) |
| `GET aggregates` | top-12 breakdowns (referrers, countries, cities, devices, browsers, OS, orgs, languages, entry / exit paths), section dwell, scroll funnel |
| `GET pages`, `pages/detail?path=` | per-path metrics, sections, clicks |
| `GET flows` (`depth` 2..5) | edges, sequences, funnel |
| `GET orgs` (`sort`, `hideIsp`), `orgs/detail?org=` | grouped by organisation |
| `GET visitors` (`sort`, `limit`, `offset`), `visitors/[vid]` | visitor list + history |
| `GET cohorts` | recency × frequency buckets |
| `GET intent`, `performance?dim=`, `technology`, `errors` | the corresponding views |
| `GET sessions` (`sort`, `dir`, `limit` ≤ 200, `before`, `beforeSid`) | **keyset** pagination (`next: { before, beforeSid }`), `total` on the first page only |
| `GET sessions/[id]`, `sessions/[id]/events` (`after`, `limit` ≤ 2000, `types`) | detail + keyset event pages |
| `GET filters`, `schema` | filter-bar options; tables / columns / indexes with ≈ row counts |
| `POST sql` | the console (below) |
| `GET export` (`entity`, `format`, `after`, `limit` ≤ 1000) | one page of rows; `x-rb-next` carries the cursor, the browser assembles the file (≤ 200 000 rows) |
| `GET replay/[id]` | `{ segments: [{ rid, startedAt, events }], chunks, truncated }` |

Two reading rules are worth stating because they protect the D1 *rows
read* budget: **never `COUNT(*)` an events-sized table on a polled
route** — the overview and schema browser report `MAX(id)` / `MAX(rowid)`
labelled `≈` — and every percentile / histogram / grouping runs in SQL
over a `MATERIALIZED` sample of at most 5 000 rows (labelled SAMPLE n / N).

### SQL console safety

`POST /api/ops/sql` (`{ sql, limit? }`, header `x-rb-ops: 1`, ≤ 8192
chars, 30/min) runs through `server/utils/sqlGuard.ts`, a single-pass
lexer rather than a regex:

1. Comments are whitespace, string literals are skipped, quoted /
   bracketed / backticked identifiers are normalised and recorded;
   `;` and bind placeholders are rejected outright.
2. The statement must start with `SELECT` or `WITH`, optionally preceded by
   `EXPLAIN QUERY PLAN`.
3. A denylist of bare tokens (`INSERT UPDATE DELETE DROP ALTER CREATE
   ATTACH DETACH PRAGMA VACUUM REINDEX COMMIT ROLLBACK SAVEPOINT TRIGGER
   RETURNING UPSERT INTO TRUNCATE LOAD_EXTENSION READFILE WRITEFILE …`) and
   forbidden identifiers (`d1_migrations`, anything starting `_cf_`).
4. The accepted statement is wrapped in `SELECT * FROM (…) AS rb_q LIMIT ?`
   — DML inside `FROM (…)` is a syntax error, an independent second fence.
5. Executed with `.all()` (the only D1 path that returns `meta`; a `raw()`
   result has no meta), 10 s timeout (504), cells > 500 chars truncated,
   response ≤ 1 MB, a `rows_written > 0` canary logged as an invariant
   violation, and an audit line per accepted statement.

`tests/unit/sqlGuard.test.ts` pins the bypass attempts (comment splitting,
`WITH … INSERT`, `REPLACE INTO`, quoted forbidden tables, placeholders).

### Auth

The admin side **fails closed**:

- `POST /api/ops/login` is throttled twice: the in-memory limiter (5/min
  per isolate) and a durable `login_attempts` row in D1 — ≥ 10 failures per
  15-minute window locks the IP (/64 for IPv6) with exponential backoff
  (up to 60 min, `Retry-After`). Passwords are compared in constant time
  (both sides SHA-256'd to a fixed length). Success seals `admin: true`
  into an iron-encrypted `rbops` cookie (7 days, SameSite=Lax). No password
  set in production → `/ops` is disabled entirely, not open.
- The cookie's sealing key is `NUXT_SESSION_PASSWORD` when set; otherwise
  it's derived as `sha256("rbops-session:" + adminPassword)` — rotating
  the admin password force-logs-out every existing session.
- Bot rows are excluded from every ops query by default; `?bots=1` opts
  them back in. The tracker refuses to run on `/ops`, so the admin watching
  the dashboard never shows up in it.

## 10 · Why it's shaped this way (Workers + D1 constraints)

| Constraint (Free plan) | Consequence in this codebase |
| --- | --- |
| **10 ms CPU per invocation** (HTTP and cron alike) | Percentiles / histograms / edges / grouping run in SQL; ≤ 5 000 rows deserialised per request; export ≤ 1 000 rows per request with the file assembled in the owner's browser; SQL console ≤ 1 000 rows / 1 MB; prune bounded per run |
| **50 subrequests per invocation** (every D1 / R2 / fetch call) | collect = 1 pre-check batch + 1 write batch (+1 IP-cap read, +1 rDNS cache read on a new session); ≤ 20 D1 calls per ops endpoint; the prune budget counter stops at 40 with carry-over |
| **100 000 rows written per day — index rows count** | See the arithmetic below. Heartbeats / env / perf / vitals never become event rows; bot sessions write ≈ 8 rows; `idx_sessions_vid` was replaced by the composite it's a prefix of; no index on `events.path` or `sessions.last_seen_at` |
| **5 000 000 rows read per day** | No `COUNT(*)` on events-sized tables on polled routes; prune deletes via indexed session bands; 30 s response cache; the ACTIVE subquery is one index lookup per session in range; performance / technology read ≤ 5 000 sampled rows |
| **500 MB per D1 database** | ≈ 25 KB per typical session (below); the overview shows `page_count × page_size`; lower `NUXT_EVENT_RETENTION_DAYS` when it passes ~350 MB |
| **100 bound parameters per statement, 100 columns per table** | Statement A binds 70, `session_net` 39, `session_env` 62, `page_perf` 38, `page_visits` 19, events 16 × 6 = 96, visitors 13; `sessions` has 71 columns — anything new goes to a side table; `bindChecked` + a unit test regenerate the counts |
| **`LIKE` patterns ≤ 50 bytes** | Free-text and country filters are clamped to 40 UTF-8 bytes before the `%…%` wrap |
| **Foreign keys are enforced** | Every FK child column is indexed; the prune deletes children explicitly; `replay_chunks_v2` deliberately has no FK (a chunk may precede its session) |
| **`raw()` returns no `meta`** | The SQL console executes with `.all()` and only falls back to `raw({ columnNames: true })` to recover the header of an empty result |
| D1 has no interactive transactions | All writes are single `db.batch()` calls (atomic) with `ON CONFLICT … excluded.*` upserts carrying the increments and `MIN` / `MAX` / `COALESCE` merges, so out-of-order envelopes converge |
| Workers isolates are many + ephemeral | The rate limiter is per-isolate in-memory (effective limit ≈ limit × isolates — fine for throttling, zero D1 reads on the hot path); honeypot flags and the login lockout live in D1 |
| R2 has no cheap recursive stat | Every size cap reads the `replay_chunks_v2` ledger instead of listing the bucket |
| `fetch keepalive` bodies cap at 64 KiB | The replay tail flush skips itself when the final chunk won't fit; keepalive is reserved for lifecycle flushes |
| `request.cf` carries geo / ASN for free | No GeoIP database anywhere; locally the values are whatever miniflare fetched for your machine (see the README) |
| Cron triggers are a first-class Worker event | Retention is one daily `scheduled()` run, no external scheduler |

### Rows-written arithmetic

D1 counts every index entry as a row written. An `events` row costs
1 + 2 index entries = **3**; a `page_visits` row 3; a `page_perf` row 3.
A typical human session (3 pages, ~10 envelopes, ~55 stored events):
visitors 3 (first envelope) + sessions 5 (insert) + ~9 updates +
session_net 2 + session_env 2 + page_visits 9 + ~12 merges + page_perf 9 +
~4 merges + events 55 × 3 = 165 → **≈ 220 rows**. That is ≈ **450 typical
sessions per day** on the free budget; a session that hits the 400-event
cap costs ≈ 1 250 rows; a bot session ≈ 8. When the daily budget is
exhausted D1 refuses writes for the rest of the day — the site keeps
serving, the collector logs the failure, that day's tail is lost.

### Size arithmetic

Per typical session: events ≈ 20 KB including index bytes, page_perf
≈ 2 KB, session_net + session_env ≈ 1.5 KB, page_visits ≈ 0.6 KB, the
session row ≈ 1 KB → **≈ 25 KB**. With events + perf kept 180 days, every
steady session-per-day costs ≈ 4 MB of the 500 MB: 25 sessions/day ≈
110 MB, 100 sessions/day ≈ 450 MB. Side tables at 365 days add ≈ 0.8 MB per
session-per-day, sessions kept forever ≈ 0.4 MB per session-per-day per
year. The overview's D1 readout tells you when to lower
`NUXT_EVENT_RETENTION_DAYS` (90 halves the biggest term).

### What is deliberately not collected

- **No client-computed fingerprints** — no canvas, audio or font-list
  hashes, no client-side JA3. Identity is the random `vid` / `sid` pair.
- **Cloudflare's TLS ClientHello hashes** (`tls_ciphers_sha1`,
  `tls_ext_sha1`, `ja3_hash`, `ja4` on paid plans) are stored per session
  as **bot / automation signals only**. No view groups by them, no query
  joins on them, and the cookbook lint test forbids presets that mention
  them; they are never used to identify or link visitors.
- **No form values, clipboard or selection text, keystrokes** — the contact
  form reports steps and lengths, `copy` keeps an 80-char snippet and a
  `hasEmail` flag, replay masks every input.
- **No permission-gated APIs** (geolocation, camera, …) — they prompt.
- **No third-party enrichment** — `asOrganization` plus the opt-in
  Cloudflare-DoH PTR lookup is the ceiling.
- **GPC / DNT** are always recorded; they are *honoured* (envelopes
  dropped, tracker never started) when `NUXT_HONOR_GPC=true` and
  `NUXT_PUBLIC_HONOR_GPC=true`. The EU flag is recorded and displayed; no
  behaviour depends on it.

And the two failure philosophies, stated once more because they're the
spine of the design: the **collection path fails open** (a broken tracker
must never break the résumé), the **admin path fails closed** (a missing
password must never expose the data).

## Trying it locally

```sh
npm run db:migrate:local   # create / update the local D1 schema (idempotent)
npm run dev                # bindings provided by nitro-cloudflare-dev
npm run seed               # synthetic visit + assertions straight from the local SQLite file
npm run seed -- --bulk 300 # 300 synthetic sessions over 30 days so every /ops view renders
npm run seed -- --ops      # log in, exercise the SQL console guard and the export
npm run test:unit          # pure-module unit tests (node --test, no build needed)
```

The seed script (`scripts/seed-visit.mjs`) sends a three-page v2 visit
through the real pipeline — every event type, two gzipped rrweb chunks
with the `rb_rt` token — then opens the local D1 file and asserts every
table landed, including the replay auth rejections (401 / 403), a
pre-pruned visitor, a minimal envelope, a v1 envelope, Sec-GPC, a bot UA,
the UA-keyed honeypot and, last, the 429 rate-limit path. The Playwright
suite (`tests/`) does the same with a real browser: a five-page SPA browse
asserted from SQLite, a deep landing, the scroll-reset rule and an
intercept test that pins the wire payloads. Deployment and configuration
knobs live in the main [README](../README.md) (SEG 03–04, 07–08).
