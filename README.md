# RILEY BETTS // OPS CONSOLE

A one-page résumé built like a mission-control terminal — boot sequence,
status lamps, section-by-section telemetry — with a **built-in first-party
analytics pipeline** including session replay. No third-party trackers, no
external analytics service, no cookies leaving the box. One Node process,
one SQLite file.

- **Public page** — `/` — the résumé itself (Nuxt 4, GSAP choreography)
- **Admin console** — `/ops` — traffic overview, session explorer, rrweb replay player
- **Telemetry intake** — `POST /api/collect`, `POST /api/replay`
- **Liveness** — `GET /api/health`

## SEG 01 // QUICKSTART (DEV)

```sh
npm install
npm run dev        # http://localhost:3000
```

Dev mode runs without secrets. A production build refuses to boot until
`NUXT_ADMIN_PASSWORD` and `NUXT_SESSION_PASSWORD` (32+ chars) are set.

## SEG 02 // EDITING CONTENT

Every word on the page lives in **`app/data/resume.ts`** — the single source
of truth. Name, hero copy, work history, the Fobech panel, project bays,
contact links: edit that one typed file and the site follows. The project
blurbs shipped as reasonable drafts — polish them there.

Components never hardcode copy; if you want to change what the site says,
you never have to touch a `.vue` file.

## SEG 03 // BUILD & SELF-HOST (BARE)

```sh
npm run build

NUXT_ADMIN_PASSWORD='choose-a-password' \
NUXT_SESSION_PASSWORD="$(openssl rand -hex 32)" \
node .output/server/index.mjs
```

Listens on `:3000` (`NITRO_PORT` to change). All runtime data — SQLite DB,
replay files, GeoIP database — lands in `./data` (`NUXT_DATA_DIR` to move
it). The `.output` directory is fully self-contained, including the
better-sqlite3 native binding — build on the same OS/arch/Node you deploy on.

## SEG 04 // DOCKER

```sh
cp .env.example .env    # fill in both passwords
mkdir -p data && sudo chown -R 1000:1000 data   # container runs as uid 1000
docker compose up -d --build
```

Compose fails fast with a readable error if either secret is missing. Data
persists in `./data` on the host (mounted at `/data` in the container). The
image is multi-stage on `node:22-alpine`, runs as the unprivileged `node`
user, and healthchecks `GET /api/health`.

## SEG 05 // ENVIRONMENT VARIABLES

| Variable | Default | Purpose |
| --- | --- | --- |
| `NUXT_ADMIN_PASSWORD` | — (required in prod) | Password for the `/ops` console |
| `NUXT_SESSION_PASSWORD` | — (required in prod) | Signs the admin session cookie; 32+ chars (`openssl rand -hex 32`) |
| `NUXT_DATA_DIR` | `./data` (`/data` in Docker) | Where SQLite, replays and the GeoIP db live |
| `NUXT_TRUST_PROXY` | `true` | Trust `X-Real-IP` / `X-Forwarded-For` for client IPs. Set `false` if exposed directly |
| `NUXT_IP_ANONYMIZE` | `false` | Store IPs anonymized (last IPv4 octet zeroed / IPv6 truncated to /48) |
| `NUXT_REPLAY_RETENTION_DAYS` | `30` | Session replay files pruned after this many days |
| `NUXT_EVENT_RETENTION_DAYS` | `180` | Raw analytics events pruned after this many days |
| `NUXT_GEOIP_MMDB_PATH` | auto | Point at an existing `GeoLite2-City.mmdb` instead of auto-downloading |
| `NUXT_PUBLIC_REPLAY_SAMPLE_RATE` | `1` | Fraction of sessions recorded with rrweb (0..1) |
| `NITRO_PORT` | `3000` | HTTP port |

## SEG 06 // REVERSE PROXY

Forwarded IP headers are **required for real client IPs and geo** — without
them every visitor is the proxy's address.

Caddy (sets `X-Forwarded-For` itself; add `X-Real-IP` explicitly):

```caddy
resume.example.com {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {remote_host}
    }
}
```

nginx:

```nginx
server {
    server_name resume.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Defense in depth: allowlist /ops at the proxy on top of its password.
    location /ops {
        allow 203.0.113.0/24;   # your networks
        deny  all;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

If the app is exposed **directly** (no proxy), set `NUXT_TRUST_PROXY=false`
so clients can't spoof their IP with a forged header.

## SEG 07 // THE ANALYTICS

**What is collected** — pageviews (referrer, UTM, screen/viewport, timezone,
language, device hints), per-section enter/exit with dwell time, scroll-depth
milestones, clicks, outbound link clicks, device + geo (city level), web
vitals (TTFB/LCP/CLS/INP), JS errors, active-time heartbeats (15s of visible,
non-idle time each), boot completion/skip, easter eggs, and sampled **rrweb
session replay**.

**Where it lives** — everything under the data dir: `data/analytics.db`
(SQLite, WAL) plus replay chunks as gzipped files under `data/replays/<sid>/`.
Nothing is sent anywhere else, ever.

**Retention** — pruning runs inside the server: replays after **30 days**,
raw events after **180 days** (see env vars above), plus a 2 GB disk cap on
the replays directory.

**Admin** — `/ops`, password-gated, noindexed, client-rendered only.

**Opt-out** — visiting any URL with `?optout=1` sets a localStorage flag and
that browser is never tracked again. The page footer carries a notice linking
to it.

**Privacy posture** — this is first-party analytics for a personal site: data
is collected by the site you're visiting, stored on the box that serves it,
and IPs never leave that box. Bot traffic is flagged, not counted. For extra
caution set `NUXT_IP_ANONYMIZE=true` and IPs are anonymized before they're
stored at all (geo still resolves — lookup happens pre-anonymization,
in memory).

## SEG 08 // GEOIP

On first boot the server downloads a GeoLite2-City database (via
`geolite2-redist`, no license key needed) into `data/geo/` in the background.
Until it arrives — or forever, on an offline box — the console simply shows
**GEO OFFLINE** and every other part of the pipeline works normally. Already
have an `.mmdb`? Point `NUXT_GEOIP_MMDB_PATH` at it and no download happens.

## SEG 09 // BACKUPS

The DB is WAL-mode, so back it up with SQLite's own backup API — **do not**
`cp` a live db file:

```sh
sqlite3 data/analytics.db ".backup 'backup/analytics-$(date +%F).db'"
rsync -a data/replays/ backup/replays/      # replay chunk files
```

Restore = stop the server, put the files back, start it.

## SEG 10 // TESTING

**Seed + smoke-test the pipeline** (server must be running):

```sh
npm run seed
# or explicitly: node scripts/seed-visit.mjs http://localhost:3000 ./data/analytics.db
```

Sends a realistic synthetic visit (pageview, section dwell, scrolls, clicks,
outbound, heartbeats, vitals, two gzipped rrweb chunks), then opens the
SQLite file and asserts everything landed — including rate-limit 429s and
bot flagging. Prints PASS/FAIL per check, exits 1 on any failure. Its final
step exhausts the per-IP rate limit, so wait ~60s before re-running.

**End-to-end (Playwright)** — start a server with the test password first:

```sh
NUXT_ADMIN_PASSWORD=test NUXT_SESSION_PASSWORD="$(openssl rand -hex 32)" npm run dev
# in another terminal, from the repo root:
npx playwright test -c tests
```

Covers the public page (boot, all six sections, console-error-free, reduced
motion), the analytics pipeline (a real browsed session asserted straight
from SQLite, replay chunk included) and the `/ops` console (login gate,
overview, session detail, replay player) on desktop and mobile viewports.
Screenshots land in `test-results/screens/`. `BASE_URL`, `OPS_PASSWORD` and
`DATA_DIR` env vars retarget the suite.

## SEG 11 // TROUBLESHOOTING

- **`better-sqlite3` fails to load (ABI / invalid ELF errors)** — the native
  binding was built for a different Node or libc. Rebuild in the environment
  that runs it: `npm rebuild better-sqlite3`. In Docker this can't happen:
  both image stages share the same base.
- **GEO OFFLINE in /ops** — the GeoLite2 download hasn't finished or the box
  has no outbound network. Analytics still works; geo columns stay null.
  Fix by allowing the download or setting `NUXT_GEOIP_MMDB_PATH`.
- **Blank/instant page with JS blocked** — expected. The page is
  server-rendered; content renders without JavaScript, you just lose the
  boot sequence and animations (and analytics, which is rather the point).
- **429s from /api/collect** — per-IP rate limit (60/min). Normal browsing
  never hits it; the seed script does so deliberately as its last step.
- **Prod build exits immediately at boot** — read the error: missing
  `NUXT_ADMIN_PASSWORD` or a `NUXT_SESSION_PASSWORD` shorter than 32 chars.
