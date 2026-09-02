# RILEY BETTS — RÉSUMÉ (MOCK BETTSUITE UI)

A résumé built as a working mock Riley Bettsuite ERP account. The career
is presented the way Bettsuite presents data: a Home dashboard (Role
Center) of portlets, an Employee record with subtabs and sublists, an
Employment History list and Project records.

The costume is built against Bettsuite's own published design tokens and
Riley's own screenshots rather than from memory, so the details are the
real ones: the light `#f1efed` masthead with its stacked RILEY/Bettsuite
lockup, the flat `#325c72` Main Menu with icon-only Recent Records /
Shortcuts / Home tabs, single-column dropdowns opening with
"<Tab> Overview", full-bleed white record pages with no card, field
labels above their values in 12px uppercase, flat `#DFE4EB` group bars,
subtabs that are bold-plus-underline rather than folder tabs, and
sublists with Bettsuite's signature pale-yellow row hover.

Global search, the menu flyouts, sortable and filterable lists,
collapsible portlets, subtab switching and the contact form all work.

Underneath it runs its own first-party analytics pipeline, session replay
included. No third-party trackers, nothing leaves the account. It deploys
to Cloudflare Workers: D1 holds the analytics, R2 holds the replay
chunks, a cron trigger prunes both — all inside the free tier.

| Route | What |
| --- | --- |
| `/` | Home dashboard — the Role Center |
| `/employee` | the Employee record — bio, skills sublist, system notes |
| `/positions`, `/positions/:id` | Employment History list + Position records |
| `/projects`, `/projects/:id` | Projects list + Project records |
| `/colophon` | Customization > Scripting — how the site is built |
| `/contact` | compose a message (opens your mail client) |
| `/ops` | admin console: overview, pages, flows, organizations, visitors, sessions (+ rrweb replay player), intent, performance, technology, errors, SQL console, CSV/NDJSON export |
| `POST /api/collect`, `POST /api/replay` | telemetry intake |
| `GET /api/ops/*` | the console's read API (password-gated) |
| `GET /void.html` | bot honeypot — never linked visibly, disallowed in robots.txt |
| `GET /api/health` | liveness (503 when D1 or R2 is unreachable) |

## SEG 01 // QUICKSTART (DEV)

```sh
npm install
npm run db:migrate:local   # once: create the local D1 schema (safe to re-run)
npm run dev                # http://localhost:3000
```

Dev mode runs without secrets (the /ops password is `dev`).
`nitro-cloudflare-dev` provides the D1/R2 bindings from `wrangler.jsonc`
inside `nuxt dev`; local state lives under `.wrangler/state/`.

## SEG 02 // EDITING CONTENT

Every word on the page lives in `app/data/resume.ts`, the single source of
truth, shaped as Bettsuite records: the account/masthead, the Main Menu
tree, the Employee record and its skills, dashboard
KPIs/meter/trend/reminders, the work history positions, project records,
contact details, the colophon and the privacy notice. Edit that one typed
file and the site follows.

Components never hardcode copy; if you want to change what the site says,
you never have to touch a `.vue` file. The Bettsuite look lives in
`app/assets/css/bettsuite.css` (scoped under `body.ns`); the private `/ops`
console keeps its own dark theme from `tokens.css` / `base.css`.

## SEG 03 // DEPLOY (CLOUDFLARE WORKERS, FREE TIER)

One-time setup:

```sh
npx wrangler login
npx wrangler d1 create resume-analytics    # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create resume-replays
npm run db:migrate:remote                  # apply the schema to the real D1
npx wrangler secret put NUXT_ADMIN_PASSWORD
npx wrangler secret put NUXT_SESSION_PASSWORD   # 32+ chars: openssl rand -hex 32
```

Then, and for every deploy after:

```sh
npm run db:migrate:remote   # FIRST — new tables/columns; a no-op when nothing changed
npm run deploy              # nuxt build + wrangler deploy
```

**Migrate before you deploy.** The previous Worker tolerates the new
columns; the new Worker needs them. Migrations live in `migrations/`:
`0001_init.sql` (never edited), `0002_side_tables.sql` (fully idempotent —
can be re-run on any database) and `0003_session_columns.sql` (the
`ALTER TABLE … ADD COLUMN` list, which SQLite cannot make re-runnable).
If a migration goes wrong:

- **wrangler wants to re-apply 0001** (`table visitors already exists`):
  the database was bootstrapped before wrangler tracked migrations, so it
  has no bookkeeping row. Insert it and retry:
  `npx wrangler d1 execute resume-analytics --remote --command "INSERT INTO d1_migrations (name, applied_at) VALUES ('0001_init.sql', CURRENT_TIMESTAMP)"`
- **0003 stopped part-way** (`duplicate column name …`): apply the
  remaining `ALTER TABLE` lines from the file by hand with
  `npx wrangler d1 execute resume-analytics --remote --command "ALTER TABLE …"`,
  then insert its bookkeeping row the same way (`'0003_session_columns.sql'`).
- **0002 failed**: just run `npm run db:migrate:remote` again.
- Rollback of the code is a redeploy of the previous Worker; the schema
  only ever grows.

### Deploying from GitHub (Workers Builds)

The Worker is connected to this repository, so a push to `main` builds and
deploys it. Two settings under Workers → riley-betts-resume → Settings →
Build configuration:

| Field | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npm run db:migrate:remote && npx wrangler deploy` |

The migration belongs in the **deploy** command, not the build command —
the build command runs on every branch build, while the deploy command
only runs for the production branch, and migrations must not run twice.
Putting `wrangler deploy` in both fields deploys the Worker twice.

`wrangler deploy` reads `wrangler.jsonc` from the repository, so the D1
`database_id` there must be the real UUID (`npx wrangler d1 list`, or the
database's page in the dashboard). It is an identifier, not a secret —
it is meant to be committed. With the placeholder still in place the build
succeeds and the deploy fails with
`binding DB of type d1 must have a valid database_id specified [code: 10021]`.

Attach your domain under Workers → riley-betts-resume → Settings →
Domains & Routes (the domain's DNS must already be on Cloudflare). The
free tier covers all of it: 100k requests/day (Workers), 500 MB per
database with 100k rows written/day (D1), 10 GB (R2), and the daily prune
cron. `docs/ANALYTICS.md` §10 has the arithmetic for how much traffic that
is.

To preview the production build locally before deploying:

```sh
npm run build && npm run preview   # wrangler dev against local D1/R2 state
```

## SEG 04 // ENVIRONMENT

Secrets (set with `wrangler secret put`, never in wrangler.jsonc):

| Secret | Purpose |
| --- | --- |
| `NUXT_ADMIN_PASSWORD` | Password for the `/ops` console. Unset = /ops disabled (fails closed) |
| `NUXT_SESSION_PASSWORD` | Signs the admin session cookie and the replay upload token; 32+ chars (`openssl rand -hex 32`) |

Plain vars (edit in `wrangler.jsonc` → `vars`; mirrored in `.env.example`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NUXT_TRUST_PROXY` | `true` | Trust `x-real-ip` / `x-forwarded-for` when `cf-connecting-ip` is absent. Irrelevant on Cloudflare (the edge header always wins); only matters for `nuxt dev` or another host — set `false` there if the app is reachable without a trusted reverse proxy |
| `NUXT_IP_ANONYMIZE` | `false` | Store IPs anonymized (last IPv4 octet zeroed / IPv6 truncated to /48). Also disables reverse DNS |
| `NUXT_PUBLIC_REPLAY_SAMPLE_RATE` | `1` | Fraction of sessions recorded with rrweb (0..1); rolled once per session |
| `NUXT_REPLAY_RETENTION_DAYS` | `30` | Replay chunks (R2 objects + ledger rows) pruned after this many days |
| `NUXT_EVENT_RETENTION_DAYS` | `180` | `events` and `page_perf` rows pruned after this many days — lower it if the overview shows D1 nearing 500 MB |
| `NUXT_SIDE_TABLE_RETENTION_DAYS` | `365` | `page_visits`, `session_env`, `session_net` rows pruned after this many days |
| `NUXT_PII_RETENTION_DAYS` | `365` | After this many days `ip`, `ua`, `lat`, `lon` are nulled on old sessions |
| `NUXT_SESSION_RETENTION_DAYS` | `0` | `0` keeps sessions + visitors forever (counters and facts only, once the PII scrub has run); `> 0` deletes whole sessions older than this, ≤ 100 per nightly run |
| `NUXT_HONOR_GPC` | `false` | Global Privacy Control / DNT are always *recorded*; `true` makes `/api/collect` and `/api/replay` drop requests that carry `Sec-GPC: 1` or `DNT: 1` |
| `NUXT_PUBLIC_HONOR_GPC` | `false` | Client twin of the above: the tracker does not start for a browser with `navigator.globalPrivacyControl`. Keep the two in sync |
| `NUXT_RDNS_ENABLED` | `false` | Reverse-DNS the session IP through Cloudflare's DoH resolver (cached 7 days). Ignored while `NUXT_IP_ANONYMIZE=true` |

## SEG 05 // THE ANALYTICS

This section is the summary; the full architecture — data flow, event
taxonomy, D1 schema, replay chunk lifecycle, bot defenses, and the
Workers constraints that shaped the design — is documented in
[`docs/ANALYTICS.md`](docs/ANALYTICS.md).

### What is collected

**Behaviour, per page visit.** Pageviews for every page in a session (the
site is an SPA — client-side navigations count, with the previous path and
how long the transition took), active and hidden time, scroll depth,
per-section dwell (portlets, field groups, subtab panels), clicks
(selector path, trimmed text, position), rage and dead clicks, links to
other sites and **mailto / tel clicks**, print, find-in-page, text
selections and copies (length, an ≤ 80-character snippet of copied text,
whether it contained the contact email), global-search terms (≤ 40
characters), exit intent, viewport / zoom / orientation changes, hovers on
the contact links and KPI rows, subtab switches, easter eggs. The contact
form reports its funnel — focus, first input, fields completed, submit /
invalid / reset / abandon, the chosen subject and the message *length* —
never the text. **The contact form composes a `mailto:` link — we count
the handoff to your mail client, not delivery.**

**Environment, once per page load.** Browser / OS / device (parsed
server-side from the User-Agent, plus the UA client hints Chromium
exposes: architecture, bitness, model, platform version, full version
list, form factors), languages, screen and viewport, colour depth, touch
points, GPU vendor + renderer (WebGL / WebGPU adapter strings), battery,
storage estimate, media-device *counts*, `prefers-*` settings (colour
scheme, reduced motion, contrast, forced colours), memory / cores /
network-quality hints, timezone name + offset, locale, display mode,
`navigator.webdriver`, PDF viewer, cookies enabled, GPC / DNT as the
browser reports them.

**Performance, once per page load.** TTFB, FCP, LCP (+ the element),
CLS, INP, DNS / connect / TLS / request / response timing, DOM
interactive / DCL / load, transfer sizes, protocol, a resource summary
(count, bytes, cached, by type, the five slowest as `host/path`), long
tasks and long animation frames, soft-navigation time for SPA visits.

**Errors.** JS errors (message, source, line, stack), failed resource
loads, `console.error` calls — with browser-extension URLs scrubbed to
`<ext>` before storage.

**Server-side, per session (from Cloudflare's request metadata and the
request headers).** Country / region / city / postal code / metro code /
latitude / longitude, **ASN and organisation** ("which network or company
is this"), continent, EU flag, Tor flag, Cloudflare datacenter, HTTP
protocol, TLS version and cipher, client RTT, request priority, accept
encoding, `Accept-Language`, `Sec-GPC`, `DNT`, `Save-Data`, low-entropy
client hints, the navigation's `Sec-Fetch-*` headers and `Referer`
(captured on the HTML request — the only trustworthy "typed the URL vs
came from elsewhere" signal), the `cf-ray` id, and — **only when you enable
`NUXT_RDNS_ENABLED`** — the reverse-DNS host of the IP. The EU flag is
recorded and displayed; no behaviour depends on it.

**Session replay.** Sampled rrweb recordings (`NUXT_PUBLIC_REPLAY_SAMPLE_RATE`),
one recording per page load, every input masked, capped at 10 minutes or
5 MB per recording.

**What is deliberately not collected.** No client-computed fingerprints
(no canvas / audio / font-list hashes). Cloudflare's TLS ClientHello
hashes (JA3/JA4 on paid plans, cipher / extension SHA-1s) are stored per
session as bot / automation signals and are never used to identify or
link visitors. No form values, no clipboard or selection text beyond the
80-character copy snippet, no keystrokes, no permission-gated APIs, no
third-party enrichment. **Global Privacy Control / DNT are recorded and
honoured when `NUXT_HONOR_GPC=true`.**

### Where it lives

Analytics rows sit in the `resume-analytics` D1 database (`visitors`,
`sessions`, `session_net`, `session_env`, `page_visits`, `page_perf`,
`events`, the replay ledger); replay chunks are gzipped objects in the
`resume-replays` R2 bucket under `replays/<sid>/<rid>/`. Both live in your
own Cloudflare account. Nothing is sent anywhere else — except, when you
enable reverse DNS, PTR lookups of visitor IPs to Cloudflare's public DoH
resolver (same vendor, different service; off by default).

### Retention

A daily cron trigger (see `wrangler.jsonc`) prunes replays after 30 days,
raw events and performance rows after 180, the per-session side tables
after 365, nulls IP / UA / coordinates on sessions older than 365 days,
and enforces a 2 GB cap on total replay storage — oldest sessions evicted
first (see vars above). Session and visitor rows are kept by default.

### Admin, opt-out, privacy

The admin lives at `/ops`: password-gated, noindexed, client-rendered only,
with a Content-Security-Policy because it plays back untrusted DOM.
Visiting any URL with `?optout=1` sets a localStorage flag and that browser
is never tracked again; the page footer carries the notice with that link.

This is first-party analytics for a personal site. Data is collected by the
site you're visiting and stored in the site owner's own Cloudflare account.
Bot traffic is flagged, not counted. For extra caution set
`NUXT_IP_ANONYMIZE=true` and IPs are anonymized before they're stored at
all (geo is unaffected — it comes from Cloudflare's edge, not the stored IP).

## SEG 06 // BACKUPS

```sh
npx wrangler d1 export resume-analytics --remote --output backup/analytics-$(date +%F).sql
```

The `/ops` console can also export any table as CSV / NDJSON for the
current filter. Replay chunks in R2 are ephemeral by design (30-day
retention); if you want them anyway, `rclone` speaks R2's S3 API.

## SEG 07 // TESTING

### Unit tests (no server needed)

```sh
npm run test:unit    # node --test tests/unit/*.test.ts
```

Pure-module tests on Node's native type stripping: the wire catalogue,
the D1 statement parameter counts (every statement ≤ 100 binds, prepared
against the migrated schema), the migrations (0002 re-applies, every
table ≤ 100 columns, every foreign-key column indexed), the SQL-console
guard (bypass attempts), the cookbook lint, CSV quoting / formula
defusing, client-hint GREASE parsing, org classification, the percentile
query and DST-safe timezone offsets.

### Seed + smoke-test the pipeline

With the dev server running:

```sh
npm run seed                 # a realistic visit through the real API, asserted from the local SQLite file
npm run seed -- --bulk 300   # 300 synthetic sessions over 30 days so every /ops view has data
npm run seed -- --ops        # log in, exercise the SQL console guard + the export
# explicitly: node scripts/seed-visit.mjs http://localhost:3000 [path-to-local-d1.sqlite] [--bulk N] [--ops]
```

The default mode sends a three-page visit (`/` → `/employee` → `/contact`)
carrying every event type, then two gzipped rrweb chunks with the replay
token, and asserts every table landed — page visits, per-page event
paths, merged performance rows, the typed side tables, counters, the
replay ledger. It then covers the edge cases: replay uploads without /
with a forged token (401) and for a bot session (403), a pre-pruned
visitor, a minimal envelope, a v1 envelope, Sec-GPC, a bot UA, the
UA-keyed honeypot (and that a cross-site hit does *not* flag), and — last —
a 150-envelope burst that must trip the 120/min rate limit. Prints
PASS/FAIL per check, exits 1 on any failure. Every request carries an
`x-forwarded-for` address of its own (TEST-NET), so the burst does not
lock out your browser; wait ~60 s before re-running the seed itself.

### End-to-end (Playwright)

Start a dev server with the test password first:

```sh
NUXT_ADMIN_PASSWORD=test NUXT_SESSION_PASSWORD="$(openssl rand -hex 32)" npm run dev
# in another terminal, from the repo root:
npx playwright test -c tests
```

Three specs. `public.spec.ts` runs on **both** projects (desktop + mobile):
Role Center portlets render, record-to-record navigation, subtab
switching, the `data-page` / `data-section` hooks, the honeypot link
(present, hidden, unfocusable, 1×1, `pointer-events: none`), the
`?optout=1` link, reduced motion, console-error-free. `analytics.spec.ts`
is **desktop-only**: a five-page SPA browse asserted straight from the
local D1 file (per-page visits chained by `from_path`, section and scroll
events on the second page, a mailto handoff, the typed side tables, a
replay chunk keyed by its recording id), a deep landing, the scroll-reset
rule, and an intercept test that pins the wire payloads without D1.
`ops.spec.ts` is **desktop-only** and logs in once (the login endpoint
allows 5 attempts a minute): the login gate (a wrong password is refused
through the `role="alert"` denial), the overview (tiles, sparkline, filter
bar, live strip, range switching, COMPARE deltas, the D1 size / ≈ count
readout), a console-error-free smoke of every console page — the `/ops`
CSP is validated there, a violation surfaces as a console error — a
future custom range (`NO SESSIONS IN RANGE`), the seeded replay session's
detail (event timeline, path timeline, environment panel and an rrweb
`.rr-player` that actually mounts), Orgs → detail and Pages → detail, the
SQL console (a comment is whitespace, `SELECT 1; SELECT 2` and `DELETE`
are rejected with the row count unchanged, `EXPLAIN QUERY PLAN` runs, the
schema browser lists `sessions`), the sessions CSV export (button and
endpoint headers) and a 401 sweep of every `/api/ops/*` route without the
cookie. Screenshots land in `test-results/screens/`. `BASE_URL`,
`OPS_PASSWORD`, `D1_DB_PATH` and `PW_EXEC` (path to a Chromium binary)
retarget the suite.

## SEG 08 // TROUBLESHOOTING

- **"Cloudflare bindings unavailable" in dev** — run
  `npm run db:migrate:local` once, then start `npm run dev` from the repo
  root (nitro-cloudflare-dev reads `wrangler.jsonc` for the bindings).
- **`wrangler deploy` fails on database_id** — you haven't pasted the id
  from `wrangler d1 create resume-analytics` into `wrangler.jsonc` yet.
- **`db:migrate:remote` complains a table already exists / a column is a
  duplicate** — see the recovery steps in SEG 03.
- **/ops returns 503 "admin disabled"** — `NUXT_ADMIN_PASSWORD` secret not
  set on the deployed worker (`npx wrangler secret put NUXT_ADMIN_PASSWORD`).
- **/ops login says "locked"** — ten wrong passwords within 15 minutes
  lock that IP with exponential backoff (up to an hour); the lock lives in
  D1's `login_attempts`, so restarting the Worker does not clear it.
- **Geo / ASN / organisation look odd locally** — expected. In dev,
  miniflare fills `request.cf` with what Cloudflare reports for *your
  machine's* public address (fetched once and cached under
  `node_modules/.mf/cf.json`), or with fixed placeholder values
  (Austin TX, colo DFW, ASN 395747, blank organisation) when that fetch
  fails. Blank / zero placeholders are stored as NULL. Deployed traffic
  resolves per visitor at the edge. The tests therefore never assert on
  geo or organisation locally.
- **Sessions look like "Anthropic" / "Google Cloud" / "Amazon"** — an
  office or a hosting network is what the ASN says it is; the Organizations
  view badges cloud / ISP networks and can hide them.
- **Reduced interactivity with JS blocked** — expected. The pages are
  server-rendered; records, lists and the dashboard render without
  JavaScript. You just lose the interactive bits — global search, menu
  dropdowns, list sorting, subtab switching, the loading splash (and
  analytics, which is rather the point).
- **429s from /api/collect** — per-IP rate limit (120/min), or more than
  300 new sessions from one address in a day. Normal browsing never hits
  either; the seed script trips the first deliberately as its last step.
- **A replay is missing / `has_replay` is 0** — the session was not sampled
  (`rb_rr` cookie), or its first chunk (`seq 0`) never landed: the tracker
  reports `replay_chunk_lost` events with the HTTP status, visible in the
  session's event timeline.
- **Nothing is tracked in your own browser** — you visited a URL with
  `?optout=1` at some point (clear `localStorage.rb_optout`), or the
  browser sends Global Privacy Control and `NUXT_PUBLIC_HONOR_GPC` is on.
