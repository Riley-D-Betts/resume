export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  ssr: true,

  modules: ['@nuxt/fonts'],

  components: [{ path: '~/components', pathPrefix: false }],

  nitro: {
    preset: 'node-server',
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
            'Riley Betts — IT Manager, Ida Milk (Suntado). A résumé built as a working mock Bettsuite ERP account. Founder, Fobech.',
        },
        { name: 'theme-color', content: '#223140' },
        { property: 'og:title', content: 'Riley Betts — Bettsuite Personnel Account' },
        {
          property: 'og:description',
          content: 'IT Manager. Systems builder. Founder of Fobech. This résumé is a working mock Bettsuite UI.',
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
    '/ops/**': { headers: { 'X-Robots-Tag': 'noindex, nofollow' }, ssr: false },
    '/api/**': { headers: { 'X-Robots-Tag': 'noindex' } },
  },

  runtimeConfig: {
    // Override via NUXT_* env vars (see .env.example)
    adminPassword: '',
    sessionPassword: '',
    dataDir: './data',
    trustProxy: true,
    replayRetentionDays: 30,
    eventRetentionDays: 180,
    ipAnonymize: false,
    geoipMmdbPath: '',
    public: {
      replaySampleRate: 1,
    },
  },

  typescript: { strict: true },
})
