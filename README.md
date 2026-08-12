# RILEY BETTS — RÉSUMÉ (MOCK BETTSUITE UI)

A résumé built as a working mock Riley Bettsuite ERP account. The career
is presented the way Bettsuite presents data: a Home dashboard (Role
Center) of portlets, an Employee record with subtabs and sublists, an
Employment History list, Project records and a Fobech "subsidiary".

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
| `/fobech` | the Fobech subsidiary record |
| `/colophon` | Customization > Scripting — how the site is built |
| `/contact` | compose a message (opens your mail client) |
| `/ops` | admin console: traffic overview, session explorer, rrweb replay player |
| `POST /api/collect`, `POST /api/replay` | telemetry intake |
| `GET /api/health` | liveness |

## SEG 01 // QUICKSTART (DEV)

```sh
npm install
npm run db:migrate:local   # once: create the local D1 schema
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
the Fobech subsidiary and contact details. Edit that one typed file and
the site follows.

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
npm run deploy        # nuxt build + wrangler deploy
```

Attach your domain under Workers → riley-betts-resume → Settings →
Domains & Routes (the domain's DNS must already be on Cloudflare). The
free tier covers all of it: 100k requests/day (Workers), 5GB (D1),
10GB (R2), and the daily prune cron.

To preview the production build locally before deploying:

```sh
npm run build && npm run preview   # wrangler dev against local D1/R2 state
```

## SEG 04 // ENVIRONMENT

Secrets (set with `wrangler secret put`, never in wrangler.jsonc):

| Secret | Purpose |
| --- | --- |
| `NUXT_ADMIN_PASSWORD` | Password for the `/ops` console. Unset = /ops disabled (fails closed) |
| `NUXT_SESSION_PASSWORD` | Signs the admin session cookie; 32+ chars (`openssl rand -hex 32`) |

Plain vars (edit in `wrangler.jsonc` → `vars`):

| Variable | Default | Purpose |
| --- | --- | --- |
| `NUXT_IP_ANONYMIZE` | `false` | Store IPs anonymized (last IPv4 octet zeroed / IPv6 truncated to /48) |
| `NUXT_REPLAY_RETENTION_DAYS` | `30` | Session replay chunks pruned after this many days |
| `NUXT_EVENT_RETENTION_DAYS` | `180` | Raw analytics events pruned after this many days |
| `NUXT_PUBLIC_REPLAY_SAMPLE_RATE` | `1` | Fraction of sessions recorded with rrweb (0..1) |

## SEG 05 // THE ANALYTICS

This section is the summary; the full architecture — data flow, event
taxonomy, D1 schema, replay chunk lifecycle, bot defenses, and the
Workers constraints that shaped the design — is documented in
[`docs/ANALYTICS.md`](docs/ANALYTICS.md).

### What is collected

Pageviews (referrer, UTM, screen/viewport, timezone, language, device
hints), per-section enter/exit with dwell time, scroll-depth milestones,
clicks, outbound link clicks, device + geo (city level, from Cloudflare's
request metadata — no GeoIP database), web vitals (TTFB/LCP/CLS/INP), JS
errors, active-time heartbeats (each one is 15s of visible, non-idle
time), easter eggs, and sampled rrweb session replay.

### Where it lives

Analytics rows sit in the `resume-analytics` D1 database; replay chunks
are gzipped objects in the `resume-replays` R2 bucket under
`replays/<sid>/`. Both live in your own Cloudflare account; nothing is
sent anywhere else, ever.

### Retention

A daily cron trigger (see `wrangler.jsonc`) prunes replays after 30 days
and raw events after 180 (see vars above), plus a 2GB cap on total replay
storage — oldest sessions evicted first.

### Admin, opt-out, privacy

The admin lives at `/ops`: password-gated, noindexed, client-rendered only.
Visiting any URL with `?optout=1` sets a localStorage flag and that browser
is never tracked again; the page footer carries a notice.

This is first-party analytics for a personal site. Data is collected by the
site you're visiting and stored in the site owner's own Cloudflare account.
Bot traffic is flagged, not counted. For extra caution set
`NUXT_IP_ANONYMIZE=true` and IPs are anonymized before they're stored at
all (geo is unaffected — it comes from Cloudflare's edge, not the stored IP).

## SEG 06 // BACKUPS

```sh
npx wrangler d1 export resume-analytics --remote --output backup/analytics-$(date +%F).sql
```

Replay chunks in R2 are ephemeral by design (30-day retention); if you
want them anyway, `rclone` speaks R2's S3 API.

## SEG 07 // TESTING

### Seed + smoke-test the pipeline

With the dev server running:

```sh
npm run seed
# or explicitly: node scripts/seed-visit.mjs http://localhost:3000 [path-to-local-d1.sqlite]
```

Sends a realistic synthetic visit (pageview, section dwell, scrolls, clicks,
outbound, heartbeats, vitals, two gzipped rrweb chunks), then opens the
local D1 SQLite file (found under `.wrangler/state/`) and asserts everything
landed, including rate-limit 429s and bot flagging. Prints PASS/FAIL per
check, exits 1 on any failure. Its final step exhausts the per-IP rate
limit, so wait ~60s before re-running.

### End-to-end (Playwright)

Start a dev server with the test password first:

```sh
NUXT_ADMIN_PASSWORD=test NUXT_SESSION_PASSWORD="$(openssl rand -hex 32)" npm run dev
# in another terminal, from the repo root:
npx playwright test -c tests
```

Covers the public site (Role Center portlets render, record-to-record
navigation, subtab switching, console-error-free, reduced motion), the
analytics pipeline (a real browsed session asserted straight from the local
D1 file, replay chunk included) and the `/ops` console (login gate,
overview, session detail, replay player) on desktop and mobile viewports.
Screenshots land in `test-results/screens/`. `BASE_URL`, `OPS_PASSWORD` and
`D1_DB_PATH` env vars retarget the suite.

## SEG 08 // TROUBLESHOOTING

- **"Cloudflare bindings unavailable" in dev** — run
  `npm run db:migrate:local` once, then start `npm run dev` from the repo
  root (nitro-cloudflare-dev reads `wrangler.jsonc` for the bindings).
- **`wrangler deploy` fails on database_id** — you haven't pasted the id
  from `wrangler d1 create resume-analytics` into `wrangler.jsonc` yet.
- **/ops returns 503 "admin disabled"** — `NUXT_ADMIN_PASSWORD` secret not
  set on the deployed worker (`npx wrangler secret put NUXT_ADMIN_PASSWORD`).
- **Geo columns are null locally** — expected: Cloudflare's request
  metadata only exists at the real edge. Deployed traffic resolves fine.
- **Reduced interactivity with JS blocked** — expected. The pages are
  server-rendered; records, lists and the dashboard render without
  JavaScript. You just lose the interactive bits — global search, menu
  dropdowns, list sorting, subtab switching, the loading splash (and
  analytics, which is rather the point).
- **429s from /api/collect** — per-IP rate limit (60/min). Normal browsing
  never hits it; the seed script does so deliberately as its last step.
