export default defineNuxtConfig({
  compatibilityDate: '2026-07-01',
  ssr: true,

  modules: ['@nuxt/fonts'],

  components: [{ path: '~/components', pathPrefix: false }],

  nitro: {
    preset: 'node-server',
  },

  css: [
    '~/assets/css/tokens.css',
    '~/assets/css/base.css',
    '~/assets/css/crt.css',
  ],

  app: {
    head: {
      title: 'RILEY BETTS // OPS CONSOLE',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        {
          name: 'description',
          content:
            'Riley Betts — IT Manager, Ida Milk (Suntado). The person who runs the systems that run a dairy plant. Founder, Fobech.',
        },
        { name: 'theme-color', content: '#070a0b' },
        { property: 'og:title', content: 'RILEY BETTS // OPS CONSOLE' },
        {
          property: 'og:description',
          content: 'IT Manager. Systems builder. Founder of Fobech. This résumé has a boot sequence.',
        },
        { property: 'og:type', content: 'website' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    },
  },

  fonts: {
    families: [
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 500, 700] },
      { name: 'Archivo Black', provider: 'google', weights: [400] },
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
