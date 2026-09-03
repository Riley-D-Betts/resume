export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  ssr: true,

  modules: ['@nuxt/fonts'],

  components: [{ path: '~/components', pathPrefix: false }],

  nitro: {
    // Cloudflare Workers (static assets + D1 + R2), deployed with wrangler.
    preset: 'cloudflare_module',
    // Provides the wrangler.jsonc bindings (DB, REPLAYS) inside `nuxt dev`.
    modules: ['nitro-cloudflare-dev'],
  },

  css: [
    // Shared, kept for the private /ops console (dark CRT theme).
    '~/assets/css/tokens.css',
    '~/assets/css/base.css',
    '~/assets/css/crt.css',
    // Public résumé — the Bettsuite costume. Scoped under body.ns.
    '~/assets/css/bettsuite.css',
  ],

  app: {
    head: {
      title: 'Riley Betts — Home | Bettsuite',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'Riley Betts — IT Manager, Ida Milk (Suntado). A résumé built as a working mock Bettsuite ERP account.',
        },
        { name: 'theme-color', content: '#223140' },
        { property: 'og:title', content: 'Riley Betts — Bettsuite Personnel Account' },
        {
          property: 'og:description',
          content: 'IT Manager. Systems builder. This résumé is a working mock Bettsuite UI.',
        },
        { property: 'og:type', content: 'website' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },

  fonts: {
    families: [
      { name: 'Open Sans', provider: 'google', weights: [400, 600, 700, 800] },
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 500] },
    ],
    defaults: { preload: true },
  },

  routeRules: {
    // The console renders untrusted rrweb DOM (session replay), so it gets a
    // CSP (audit A27). 'unsafe-inline' is what the Nuxt SPA shell and the
    // rrweb player stylesheet need; everything stays same-origin. Fonts are
    // served from /_fonts by @nuxt/fonts, replay frames are blob: iframes.
    // frame-ancestors / base-uri / form-action / object-src close the
    // clickjacking, <base> and form-hijack holes (audit S6).
    '/ops/**': {
      headers: {
        'X-Robots-Tag': 'noindex, nofollow',
        'Content-Security-Policy':
          "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' blob:; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      },
      ssr: false,
    },
    '/api/**': { headers: { 'X-Robots-Tag': 'noindex' } },
  },

  runtimeConfig: {
    // Secrets come in as NUXT_* env vars — on Cloudflare set them with
    // `wrangler secret put NUXT_ADMIN_PASSWORD` / `NUXT_SESSION_PASSWORD`;
    // the rest are plain vars in wrangler.jsonc (mirrored in .env.example).
    adminPassword: '',
    sessionPassword: '',
    // Trust x-real-ip / x-forwarded-for when cf-connecting-ip is absent. Only
    // matters off Cloudflare (nuxt dev, non-CF hosts) — the edge header wins.
    trustProxy: true,
    // Retention in days, enforced by the daily prune cron (server/plugins/prune.ts).
    replayRetentionDays: 30,
    // events + page_perf. 180 (not 90): the 500 MB D1 cap is far away at this
    // traffic; the overview's sizeBytes readout says when to lower it.
    eventRetentionDays: 180,
    // page_visits, session_env, session_net.
    sideTableRetentionDays: 365,
    // After this, ip / ua / lat / lon are nulled on old sessions (audit A20).
    piiRetentionDays: 365,
    // 0 = keep sessions/visitors forever (only counters + facts remain after
    // the PII scrub); > 0 deletes whole sessions past that age, ≤ 100 per run.
    sessionRetentionDays: 0,
    // Zero the last IPv4 octet / truncate IPv6 to /48 before storing.
    ipAnonymize: false,
    // Sec-GPC / DNT are always recorded; when true, /api/collect also drops
    // envelopes from GPC/DNT requests. Keep in sync with public.honorGpc.
    honorGpc: false,
    // Reverse DNS via Cloudflare DoH for the session IP (cached in rdns_cache).
    // Ignored while ipAnonymize is on — a PTR of a zeroed octet is meaningless.
    rdnsEnabled: false,
    public: {
      // Fraction of sessions that get rrweb replay recording, 0..1.
      replaySampleRate: 1,
      // Client-side twin of honorGpc: the tracker does not start under GPC.
      honorGpc: false,
    },
  },

  typescript: { strict: true },
})
