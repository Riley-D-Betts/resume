import type { H3Event } from 'h3'
import type { KN, OpsQuery, TechDim, Technology } from '../../../shared/analytics/ops'
import { requireAdmin } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { OPS_CACHE_TTL_MS, opsCached } from '../../utils/opsCache'
import type { Row } from '../../utils/opsDb'
import { batchAll, bindStmt, pctOf, splitDims, toNum } from '../../utils/opsDb'
import { acceptLanguageFirstSql, buildWhere, parseOpsQuery, parseWindow } from '../../utils/opsFilters'

const SAMPLE = 5000
const TOP = 12

function unk(col: string): string {
  return `COALESCE(NULLIF(${col}, ''), '(unknown)')`
}

function yn(col: string, yes = 'yes', no = 'no'): string {
  return `CASE ${col} WHEN 1 THEN '${yes}' WHEN 0 THEN '${no}' ELSE '(unknown)' END`
}

function txt(col: string): string {
  return `CASE WHEN ${col} IS NULL THEN '(unknown)' ELSE CAST(${col} AS TEXT) END`
}

/** Every dimension of the Technology view over the `base` sample. Never a JA3 / JA4 / SHA-1 column. */
const DIM_EXPR: Record<TechDim | 'storageQuota' | 'voices', string> = {
  gpuVendor: unk('gpu_vendor'),
  gpuRenderer: unk('gpu_renderer'),
  webgpu: "CASE WHEN webgpu_vendor IS NULL AND webgpu_arch IS NULL THEN '(unknown)' ELSE trim(COALESCE(webgpu_vendor, '') || ' ' || COALESCE(webgpu_arch, '')) END",
  arch: unk('ua_arch'),
  bitness: unk('ua_bitness'),
  platformVer: "CASE WHEN ua_platform IS NULL OR ua_platform = '' THEN '(unknown)' ELSE trim(ua_platform || ' ' || COALESCE(ua_platform_ver, '')) END",
  formFactors: unk('ua_form_factors'),
  model: unk('ua_model'),
  brands: unk('ua_brands'),
  colorScheme: unk('color_scheme'),
  reducedMotion: yn('reduced_motion', 'reduce', 'no-preference'),
  contrast: unk('contrast'),
  forcedColors: yn('forced_colors', 'active', 'none'),
  touchPoints: txt('max_touch_points'),
  screens: "CASE WHEN screen_w IS NULL THEN '(unknown)' ELSE screen_w || 'x' || screen_h END",
  dpr: txt('dpr'),
  viewports: "CASE WHEN viewport_w IS NULL THEN '(unknown)' ELSE viewport_w || 'x' || viewport_h END",
  languages: unk('languages'),
  acceptLanguage: acceptLanguageFirstSql('accept_language'),
  netEffective: unk('net_effective'),
  netType: unk('net_type'),
  downlink:
    "CASE WHEN net_downlink IS NULL THEN '(unknown)' WHEN net_downlink < 1 THEN '<1 Mbps' WHEN net_downlink < 5 THEN '1-5 Mbps' WHEN net_downlink < 10 THEN '5-10 Mbps' ELSE '10+ Mbps' END",
  saveData: yn('net_save_data', 'on', 'off'),
  display: unk('display_mode'),
  pdfViewer: yn('pdf_viewer'),
  chUa: unk('ch_ua'),
  acceptEncoding: unk('accept_encoding'),
  protocol: unk('http_protocol'),
  tls: unk('tls_version'),
  cipher: unk('tls_cipher'),
  colo: unk('colo'),
  storageQuota:
    "CASE WHEN storage_quota_mb IS NULL THEN '(unknown)' WHEN storage_quota_mb < 1024 THEN '<1 GB' WHEN storage_quota_mb < 10240 THEN '1-10 GB' WHEN storage_quota_mb < 102400 THEN '10-100 GB' ELSE '100+ GB' END",
  voices: txt('voices'),
}

const ALL_DIMS = Object.keys(DIM_EXPR) as (keyof typeof DIM_EXPR)[]
/** ≤ 5 UNION ALL grouped statements (contract D.2). */
const GROUPS = [ALL_DIMS.slice(0, 7), ALL_DIMS.slice(7, 14), ALL_DIMS.slice(14, 21), ALL_DIMS.slice(21, 27), ALL_DIMS.slice(27)]

const BASE_COLS =
  's.sid, s.is_webdriver, s.gpc, s.dnt, s.screen_w, s.screen_h, s.dpr, s.viewport_w, s.viewport_h, '
  + 'e.webdriver, e.ua_brands, e.ua_platform, e.ua_arch, e.ua_bitness, e.ua_model, e.ua_platform_ver, e.ua_form_factors, e.languages, e.max_touch_points, '
  + 'e.pdf_viewer, e.cookies_enabled, e.gpc_js, e.dnt_js, e.gpu_vendor, e.gpu_renderer, e.webgpu_vendor, e.webgpu_arch, e.battery_level, e.battery_charging, '
  + 'e.storage_quota_mb, e.media_audioinput, e.media_videoinput, e.media_audiooutput, e.color_scheme, e.reduced_motion, e.contrast, e.forced_colors, '
  + 'e.js_heap_limit_mb, e.js_heap_used_mb, e.net_type, e.net_effective, e.net_downlink, e.net_save_data, e.voices, e.display_mode, '
  + 'n.accept_language, n.ch_ua, n.accept_encoding, n.http_protocol, n.tls_version, n.tls_cipher, n.colo, n.client_tz_offset_min, n.cf_tz_offset_min'

function topDim(dim: string, expr: string): string {
  return `SELECT * FROM (SELECT '${dim}' AS dim, ${expr} AS k, COUNT(*) AS n FROM base GROUP BY k ORDER BY n DESC LIMIT ${TOP})`
}

/** Fold the remainder into an "Other" row when the top-12 do not cover the sample. */
function withOther(list: KN[], total: number): KN[] {
  const covered = list.reduce((a, r) => a + r.n, 0)
  const other = total - covered
  return other > 0 && list.length >= TOP ? [...list, { k: 'Other', n: other }] : list
}

async function build(event: H3Event, q: OpsQuery): Promise<Technology> {
  const w = parseWindow(q)
  const db = getDb(event)
  const where = buildWhere(q, w)
  const base =
    `WITH base AS MATERIALIZED (SELECT ${BASE_COLS} FROM sessions s LEFT JOIN session_env e ON e.sid = s.sid LEFT JOIN session_net n ON n.sid = s.sid `
    + `WHERE ${where.sql} ORDER BY s.started_at DESC LIMIT ${SAMPLE})`

  const res = await batchAll(db, [
    ...GROUPS.map((dims) => bindStmt(db, `${base} ${dims.map((d) => topDim(d, DIM_EXPR[d])).join(' UNION ALL ')}`, where.args)),
    bindStmt(
      db,
      `${base} SELECT COUNT(*) AS n, COALESCE(SUM(is_webdriver = 1 OR webdriver = 1), 0) AS webdriver, COALESCE(SUM(gpc = 1 OR gpc_js = 1), 0) AS gpc, `
        + 'COALESCE(SUM(dnt = 1 OR dnt_js = 1), 0) AS dnt, COALESCE(SUM(cookies_enabled = 0), 0) AS cookiesOff, '
        + 'COALESCE(SUM(client_tz_offset_min IS NOT NULL AND cf_tz_offset_min IS NOT NULL AND client_tz_offset_min <> cf_tz_offset_min), 0) AS tzMismatch, '
        + 'COALESCE(SUM(client_tz_offset_min IS NOT NULL AND cf_tz_offset_min IS NOT NULL), 0) AS tzTotal, '
        + 'COALESCE(AVG(battery_level), 0) AS batteryAvg, COALESCE(SUM(battery_charging = 1), 0) AS charging, COUNT(battery_level) AS batteryN, '
        + 'COALESCE(AVG(media_audioinput), 0) AS audioIn, COALESCE(AVG(media_videoinput), 0) AS videoIn, COALESCE(AVG(media_audiooutput), 0) AS audioOut, '
        + 'COALESCE(AVG(js_heap_limit_mb), 0) AS heapLimit, COALESCE(AVG(js_heap_used_mb), 0) AS heapUsed, '
        + `(SELECT COUNT(*) FROM sessions s WHERE ${where.sql}) AS total FROM base`,
      [...where.args, ...where.args],
    ),
  ])
  const t = res[GROUPS.length]?.[0] ?? {}
  const n = toNum(t.n)
  const dims = splitDims(res.slice(0, GROUPS.length).flat() as Row[], ALL_DIMS)
  const pick = (d: keyof typeof DIM_EXPR): KN[] => withOther(dims[d], n)

  return {
    gpuVendor: pick('gpuVendor'),
    gpuRenderer: pick('gpuRenderer'),
    webgpu: pick('webgpu'),
    arch: pick('arch'),
    bitness: pick('bitness'),
    platformVer: pick('platformVer'),
    formFactors: pick('formFactors'),
    model: pick('model'),
    brands: pick('brands'),
    colorScheme: pick('colorScheme'),
    reducedMotion: pick('reducedMotion'),
    contrast: pick('contrast'),
    forcedColors: pick('forcedColors'),
    touchPoints: pick('touchPoints'),
    screens: pick('screens'),
    dpr: pick('dpr'),
    viewports: pick('viewports'),
    languages: pick('languages'),
    acceptLanguage: pick('acceptLanguage'),
    netEffective: pick('netEffective'),
    netType: pick('netType'),
    downlink: pick('downlink'),
    saveData: pick('saveData'),
    display: pick('display'),
    pdfViewer: pick('pdfViewer'),
    chUa: pick('chUa'),
    acceptEncoding: pick('acceptEncoding'),
    protocol: pick('protocol'),
    tls: pick('tls'),
    cipher: pick('cipher'),
    colo: pick('colo'),
    webdriver: { n: toNum(t.webdriver), total: n },
    gpc: { n: toNum(t.gpc), total: n },
    dnt: { n: toNum(t.dnt), total: n },
    cookiesOff: toNum(t.cookiesOff),
    tzMismatch: { n: toNum(t.tzMismatch), total: toNum(t.tzTotal) },
    battery: { avgLevel: Math.round(toNum(t.batteryAvg)), chargingPct: pctOf(toNum(t.charging), toNum(t.batteryN)), n: toNum(t.batteryN) },
    storageQuota: pick('storageQuota'),
    voices: pick('voices'),
    media: {
      avgAudioIn: Math.round(toNum(t.audioIn) * 10) / 10,
      avgVideoIn: Math.round(toNum(t.videoIn) * 10) / 10,
      avgAudioOut: Math.round(toNum(t.audioOut) * 10) / 10,
    },
    memory: { avgLimitMb: Math.round(toNum(t.heapLimit)), avgUsedMb: Math.round(toNum(t.heapUsed)) },
    sampled: { n, total: toNum(t.total) },
  }
}

/**
 * GET /api/ops/technology — GPU, UA-CH facts, preferences, screens, network
 * quality, protocols: top-12 + Other per dimension from ≤ 5 UNION ALL grouped
 * queries over a MATERIALIZED ≤ 5 000-session sample (sessions LEFT JOIN
 * session_env LEFT JOIN session_net), plus webdriver / GPC / DNT / cookies /
 * TZ OFFSET MISMATCH / battery / storage / media / memory tiles. Never groups
 * by ja3_hash / ja4 / tls_*_sha1. Cached 30 s.
 */
export default defineEventHandler(async (event): Promise<Technology> => {
  await requireAdmin(event)
  const q = parseOpsQuery(getQuery(event) as Record<string, unknown>)
  return opsCached(event, OPS_CACHE_TTL_MS, () => build(event, q))
})
