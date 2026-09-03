<script setup lang="ts">
import type { StatusReadout } from '~/data/resume'
import type { BotReason, SessionEnvRow, SessionFull, SessionNetRow } from '#shared/analytics/ops'

type Facts = Record<string, unknown>

/** A session with optionally partial side rows (the detail endpoint may send either). */
export type EnvSession = Omit<Partial<SessionFull>, 'net' | 'env'> & {
  net?: Partial<SessionNetRow> | null
  env?: Partial<SessionEnvRow> | null
}

/**
 * Grouped environment facts for one session: NETWORK · DOCUMENT · CLIENT
 * HINTS · GRAPHICS · DEVICE · CONNECTION · PREFERENCES · LOCALE (TZ OFFSET
 * MISMATCH lamp) · PRIVACY · BOT MGMT (only when a field is non-null) ·
 * FLAGS (bot + reason, the honeypot UA, webdriver, Tor). Null facts are
 * skipped; empty groups are not rendered. Tolerant of partial rows.
 */
const props = withDefaults(
  defineProps<{
    session: EnvSession
    derived?: { tzMismatch?: boolean; botReason?: BotReason; honeypotUa?: string | null } | null
    testid?: string
  }>(),
  { derived: null, testid: 'env-panel' },
)

const fmt = useOpsFormat()

interface Group {
  title: string
  facts: StatusReadout[]
}

const has = (v: unknown) => v !== null && v !== undefined && v !== ''
const isOn = (v: unknown) => v === 1 || v === true || v === '1'

function fact(label: string, value: unknown, lamp?: StatusReadout['lamp']): StatusReadout | null {
  if (!has(value)) return null
  return { label, value: fmt.str(value), ...(lamp ? { lamp } : {}) }
}

function ynFact(label: string, value: unknown, lampWhenOn?: StatusReadout['lamp']): StatusReadout | null {
  if (!has(value)) return null
  return { label, value: fmt.yn(value), ...(isOn(value) && lampWhenOn ? { lamp: lampWhenOn } : {}) }
}

function dims(w: unknown, h: unknown, extra = ''): string | null {
  if (!has(w) && !has(h)) return null
  return `${fmt.str(w)}×${fmt.str(h)}${extra}`
}

function offsetText(min: unknown): string | null {
  if (typeof min !== 'number') return null
  const sign = min >= 0 ? '+' : '−'
  const a = Math.abs(min)
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

const groups = computed<Group[]>(() => {
  const s = props.session as Facts
  const n = (props.session.net ?? {}) as Facts
  const e = (props.session.env ?? {}) as Facts
  const d = props.derived ?? {}
  const out: Group[] = []
  const push = (title: string, facts: (StatusReadout | null)[]) => {
    const f = facts.filter((x): x is StatusReadout => x !== null)
    if (f.length) out.push({ title, facts: f })
  }

  push('NETWORK', [
    fact('IP', s.ip),
    fact('RDNS', n.rdns_host),
    fact('ASN', has(s.asn) ? `AS${fmt.str(s.asn)}${has(s.as_org) ? ` · ${fmt.str(s.as_org)}` : ''}` : s.as_org),
    fact('COLO', n.colo),
    fact('PROTO', n.http_protocol),
    fact('TLS', n.tls_version),
    fact('CIPHER', n.tls_cipher),
    fact('RTT', has(n.client_rtt_ms) ? `${fmt.str(n.client_rtt_ms)} ms${has(n.rtt_kind) ? ` (${fmt.str(n.rtt_kind)})` : ''}` : null),
    fact('PRIORITY', n.request_priority),
    fact('ENCODING', n.accept_encoding),
    ynFact('EARLY DATA', n.early_data),
    fact('RAY', n.cf_ray),
    fact('HELLO LEN', n.tls_hello_len),
    fact('TLS FP', has(n.tls_ciphers_sha1) || has(n.tls_ext_sha1) ? `${fmt.str(n.tls_ciphers_sha1).slice(0, 12)} / ${fmt.str(n.tls_ext_sha1).slice(0, 12)}` : null),
  ])

  push('DOCUMENT', [
    fact('NAV KIND', s.nav_kind),
    fact('REFERER', n.doc_referer),
    fact('FETCH SITE', n.fetch_site),
    fact('FETCH MODE', n.fetch_mode),
    fact('FETCH DEST', n.fetch_dest),
    ynFact('FETCH USER', n.fetch_user),
  ])

  push('CLIENT HINTS', [
    fact('CH UA', n.ch_ua),
    ynFact('CH MOBILE', n.ch_mobile),
    fact('CH PLATFORM', n.ch_platform),
    fact('BRANDS', e.ua_brands),
    fact('VERSIONS', e.ua_full_versions),
    fact('PLATFORM', e.ua_platform),
    fact('PLATFORM VER', e.ua_platform_ver),
    fact('ARCH', has(e.ua_arch) ? `${fmt.str(e.ua_arch)}${has(e.ua_bitness) ? ` · ${fmt.str(e.ua_bitness)}-bit` : ''}` : null),
    fact('MODEL', e.ua_model),
    fact('FORM FACTORS', e.ua_form_factors),
    ynFact('WOW64', e.ua_wow64),
  ])

  push('GRAPHICS', [
    fact('GPU VENDOR', e.gpu_vendor),
    fact('GPU', e.gpu_renderer),
    fact('WEBGPU', has(e.webgpu_vendor) || has(e.webgpu_device) ? [e.webgpu_vendor, e.webgpu_arch, e.webgpu_device].filter(has).map(fmt.str).join(' · ') : null),
    fact('WEBGPU DESC', e.webgpu_desc),
  ])

  push('DEVICE', [
    fact('SCREEN', dims(s.screen_w, s.screen_h, has(s.dpr) ? ` @${fmt.str(s.dpr)}x` : '')),
    fact('AVAIL', dims(e.avail_w, e.avail_h)),
    fact('VIEWPORT', dims(s.viewport_w, s.viewport_h)),
    fact('INNER', dims(e.inner_w, e.inner_h)),
    fact('OUTER', dims(e.outer_w, e.outer_h)),
    fact('DEPTH', has(e.color_depth) ? `${fmt.str(e.color_depth)}-bit` : null),
    fact('ORIENT', e.orientation),
    fact('TOUCH PTS', e.max_touch_points),
    ynFact('TOUCH', e.touch),
    fact('CORES', e.cores),
    fact('MEMORY', has(e.device_memory) ? `${fmt.str(e.device_memory)} GB` : null),
    fact('JS HEAP', has(e.js_heap_used_mb) || has(e.js_heap_limit_mb) ? `${fmt.str(e.js_heap_used_mb)} / ${fmt.str(e.js_heap_limit_mb)} MB` : null),
    // The tracker sends `Math.round(level * 100)` and sanitize clamps it to
    // 0..100, so the stored value IS the percentage — 1 means 1 %, not 100 %
    // (R4-L12; the TECHNOLOGY tile reads the same column the same way).
    fact('BATTERY', has(e.battery_level) ? `${Math.round(Number(e.battery_level))}%${isOn(e.battery_charging) ? ' · CHARGING' : ''}` : null),
    fact('STORAGE', has(e.storage_usage_mb) || has(e.storage_quota_mb) ? `${fmt.str(e.storage_usage_mb)} / ${fmt.str(e.storage_quota_mb)} MB` : null),
    fact('MEDIA', has(e.media_audioinput) || has(e.media_videoinput) || has(e.media_audiooutput) ? `${fmt.str(e.media_audioinput)} MIC · ${fmt.str(e.media_videoinput)} CAM · ${fmt.str(e.media_audiooutput)} OUT` : null),
    fact('VOICES', e.voices),
    fact('PLATFORM', e.platform),
    ynFact('PDF VIEWER', e.pdf_viewer),
    ynFact('COOKIES', e.cookies_enabled),
  ])

  push('CONNECTION', [
    fact('TYPE', e.net_type),
    fact('EFFECTIVE', e.net_effective),
    fact('DOWNLINK', has(e.net_downlink) ? `${fmt.str(e.net_downlink)} Mb/s` : null),
    fact('RTT (JS)', has(e.net_rtt) ? `${fmt.str(e.net_rtt)} ms` : null),
    ynFact('SAVE-DATA', e.net_save_data),
  ])

  push('PREFERENCES', [
    fact('SCHEME', e.color_scheme),
    ynFact('REDUCED MOTION', e.reduced_motion),
    fact('CONTRAST', e.contrast),
    ynFact('FORCED COLORS', e.forced_colors),
    ynFact('INVERTED', e.inverted_colors),
    ynFact('REDUCED TRANSP.', e.reduced_transparency),
    fact('DISPLAY', e.display_mode),
  ])

  const clientOff = has(n.client_tz_offset_min) ? n.client_tz_offset_min : e.tz_offset_min
  const cfOff = n.cf_tz_offset_min
  const mismatch =
    d.tzMismatch !== undefined
      ? d.tzMismatch
      : typeof clientOff === 'number' && typeof cfOff === 'number'
        ? clientOff !== cfOff
        : null
  push('LOCALE', [
    fact('LANG', s.lang),
    fact('LANGUAGES', e.languages),
    fact('ACCEPT-LANG', n.accept_language),
    fact('LOCALE', e.intl_locale),
    fact('TZ', has(s.tz) ? s.tz : e.tz_name),
    fact('TZ OFFSET', offsetText(clientOff)),
    fact('CF TZ', has(n.cf_tz) ? `${fmt.str(n.cf_tz)}${has(cfOff) ? ` (${offsetText(cfOff)})` : ''}` : null),
    mismatch === null
      ? null
      : { label: 'TZ OFFSET MISMATCH', value: mismatch ? 'MISMATCH — VPN / PROXY?' : 'OK', lamp: mismatch ? 'amber' : 'green' },
  ])

  const gpc = has(s.gpc) ? s.gpc : e.gpc_js
  const dnt = has(s.dnt) ? s.dnt : e.dnt_js
  const webdriver = has(s.is_webdriver) ? s.is_webdriver : e.webdriver
  push('PRIVACY', [
    ynFact('GPC', gpc, 'amber'),
    ynFact('DNT', dnt, 'amber'),
    ynFact('SAVE-DATA', s.save_data, 'amber'),
    ynFact('WEBDRIVER', webdriver, 'amber'),
  ])

  if ([n.bot_score, n.verified_bot, n.verified_bot_category, n.client_trust_score].some(has)) {
    push('BOT MGMT', [
      fact('BOT SCORE', n.bot_score),
      ynFact('VERIFIED BOT', n.verified_bot, 'amber'),
      fact('CATEGORY', n.verified_bot_category),
      fact('TRUST SCORE', n.client_trust_score),
    ])
  }

  const reasonWord = d.botReason ? { ua: 'UA', honeypot: 'HONEYPOT', verified: 'VERIFIED BOT', flagged: 'FLAGGED' }[d.botReason] : null
  push('FLAGS', [
    has(s.is_bot)
      ? { label: 'BOT', value: isOn(s.is_bot) ? `YES${reasonWord ? ` — ${reasonWord}` : ''}` : 'NO', ...(isOn(s.is_bot) ? { lamp: 'amber' as const } : {}) }
      : null,
    d.botReason === 'honeypot' ? fact('HONEYPOT UA', d.honeypotUa ?? s.ua) : null,
    ynFact('WEBDRIVER', webdriver, 'amber'),
    ynFact('TOR', s.is_tor, 'amber'),
    ynFact('EU', n.is_eu),
    has(s.ua) && d.botReason !== 'honeypot' ? fact('UA', s.ua) : null,
  ])

  return out
})
</script>

<template>
  <div class="env" :data-testid="testid">
    <div v-if="groups.length === 0" class="env__empty label">NO ENVIRONMENT FACTS</div>
    <section v-for="g in groups" :key="g.title" class="env__group">
      <div class="env__title label">{{ g.title }}</div>
      <Readout v-for="f in g.facts" :key="f.label" :readout="f" />
    </section>
  </div>
</template>

<style scoped>
.env {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
  min-width: 0;
}

.env__empty {
  color: var(--text-faint);
}

.env__group {
  min-width: 0;
}

.env__title {
  margin-bottom: var(--space-1);
  color: var(--text-faint);
}

.env__group :deep(.readout__label) {
  min-width: 8.5em;
}
</style>
