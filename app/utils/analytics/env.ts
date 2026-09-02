// The one-shot environment probe (contract §B.5): everything the browser
// exposes without a permission prompt. No fingerprint hashes (contract §I).
// Every probe is individually try/caught; anything missing is null.
import type { EnvP } from '#shared/analytics/events'

const PROBE_BUDGET_MS = 3_000
const WEBGPU_TIMEOUT_MS = 1_000
const VOICES_TIMEOUT_MS = 2_000

interface UaBrand {
  brand: string
  version: string
}
interface UaData {
  brands?: UaBrand[]
  mobile?: boolean
  platform?: string
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>
}
interface GpuAdapterInfo {
  vendor?: string
  architecture?: string
  device?: string
  description?: string
}
interface GpuAdapter {
  info?: GpuAdapterInfo
  requestAdapterInfo?: () => Promise<GpuAdapterInfo>
}
interface NetInfo {
  type?: string
  effectiveType?: string
  downlink?: number
  rtt?: number
  saveData?: boolean
}
interface Battery {
  level: number
  charging: boolean
}
interface NavX extends Navigator {
  userAgentData?: UaData
  globalPrivacyControl?: boolean
  connection?: NetInfo
  deviceMemory?: number
  getBattery?: () => Promise<Battery>
  gpu?: { requestAdapter: () => Promise<GpuAdapter | null> }
}
interface PerfMemory {
  jsHeapSizeLimit: number
  usedJSHeapSize: number
}

const nav = navigator as NavX
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')
const mb = (bytes: number): number => Math.round(bytes / 1048576)

/** Run a probe; anything thrown or non-finite becomes the fallback. */
function probe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn()
    return v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v)) ? fallback : v
  } catch {
    return fallback
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))])
}

const mq = (q: string): boolean => probe(() => matchMedia(q).matches, false)

function gpu(): EnvP['gpu'] {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
  if (!gl) return null
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return null
    const vendor = str(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), 100)
    const renderer = str(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), 200)
    return vendor || renderer ? { vendor, renderer } : null
  } finally {
    try {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    } catch {
      /* ignore */
    }
  }
}

async function uadHi(): Promise<EnvP['uadHi']> {
  const ua = nav.userAgentData
  if (!ua?.getHighEntropyValues) return null
  const v = await ua.getHighEntropyValues([
    'architecture',
    'bitness',
    'model',
    'platformVersion',
    'fullVersionList',
    'formFactors',
    'wow64',
  ])
  const list = Array.isArray(v.fullVersionList) ? (v.fullVersionList as UaBrand[]) : []
  const forms = Array.isArray(v.formFactors) ? (v.formFactors as unknown[]) : []
  return {
    architecture: str(v.architecture, 40),
    bitness: str(v.bitness, 10),
    model: str(v.model, 80),
    platformVersion: str(v.platformVersion, 40),
    fullVersionList: list.map((b) => `${b.brand}/${b.version}`).join(';').slice(0, 300),
    formFactors: forms.map((f) => str(f, 20)).join(',').slice(0, 60),
    wow64: v.wow64 === true,
  }
}

async function webgpu(saveData: boolean): Promise<EnvP['webgpu']> {
  if (saveData || !nav.gpu) return null
  const adapter = await nav.gpu.requestAdapter()
  if (!adapter) return null
  const info = adapter.info ?? (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null)
  if (!info) return null
  return {
    vendor: str(info.vendor, 60),
    architecture: str(info.architecture, 60),
    device: str(info.device, 60),
    description: str(info.description, 200),
  }
}

async function battery(): Promise<EnvP['battery']> {
  if (!nav.getBattery) return null
  const b = await nav.getBattery()
  return { level: Math.round(b.level * 100), charging: b.charging === true }
}

async function storage(): Promise<EnvP['storage']> {
  if (!nav.storage?.estimate) return null
  const e = await nav.storage.estimate()
  return { quotaMb: mb(e.quota ?? 0), usageMb: mb(e.usage ?? 0) }
}

/** Counts by kind only — labels are never read. */
async function media(): Promise<EnvP['media']> {
  if (!nav.mediaDevices?.enumerateDevices) return null
  const list = await nav.mediaDevices.enumerateDevices()
  const out = { audioinput: 0, videoinput: 0, audiooutput: 0 }
  for (const d of list) if (d.kind in out) out[d.kind]++
  return out
}

function voices(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const synth = window.speechSynthesis
      if (!synth) return resolve(null)
      const count = (): number | null => {
        const n = synth.getVoices().length
        return n > 0 ? n : null
      }
      const now = count()
      if (now !== null) return resolve(now)
      const done = (): void => {
        synth.removeEventListener('voiceschanged', done)
        resolve(count())
      }
      synth.addEventListener('voiceschanged', done)
      setTimeout(done, VOICES_TIMEOUT_MS)
    } catch {
      resolve(null)
    }
  })
}

function display(): EnvP['display'] {
  if (mq('(display-mode: standalone)')) return 'standalone'
  if (mq('(display-mode: fullscreen)')) return 'fullscreen'
  if (mq('(display-mode: minimal-ui)')) return 'minimal-ui'
  return 'browser'
}

export async function probeEnv(): Promise<EnvP> {
  const net = probe((): EnvP['net'] => {
    const c = nav.connection
    if (!c) return null
    return {
      type: str(c.type, 20),
      effectiveType: str(c.effectiveType, 10),
      downlink: typeof c.downlink === 'number' ? c.downlink : 0,
      rtt: typeof c.rtt === 'number' ? c.rtt : 0,
      saveData: c.saveData === true,
    }
  }, null)

  const asyncProbes = withTimeout(
    Promise.all([
      withTimeout(uadHi(), PROBE_BUDGET_MS),
      withTimeout(webgpu(net?.saveData === true), WEBGPU_TIMEOUT_MS),
      withTimeout(battery(), PROBE_BUDGET_MS),
      withTimeout(storage(), PROBE_BUDGET_MS),
      withTimeout(media(), PROBE_BUDGET_MS),
      withTimeout(voices(), VOICES_TIMEOUT_MS + 200),
    ]),
    PROBE_BUDGET_MS,
  )

  const ua = nav.userAgentData
  const resolved = probe(() => Intl.DateTimeFormat().resolvedOptions(), null as Intl.ResolvedDateTimeFormatOptions | null)
  const orientation = probe(() => screen.orientation?.type ?? '', '')

  const sync: Omit<EnvP, 'uadHi' | 'webgpu' | 'battery' | 'storage' | 'media' | 'voices'> = {
    webdriver: probe(() => nav.webdriver === true, false),
    uad: probe(
      (): EnvP['uad'] =>
        ua
          ? {
              brands: (ua.brands ?? []).map((b) => `${b.brand}/${b.version}`).join(';').slice(0, 200),
              mobile: ua.mobile === true,
              platform: str(ua.platform, 40),
            }
          : null,
      null,
    ),
    languages: probe(() => (nav.languages ?? [nav.language]).join(',').slice(0, 120), ''),
    maxTouchPoints: probe(() => nav.maxTouchPoints, 0),
    pdfViewer: probe(() => nav.pdfViewerEnabled === true, false),
    cookies: probe(() => nav.cookieEnabled, false),
    gpc: probe(() => nav.globalPrivacyControl === true, false),
    dnt: probe(() => nav.doNotTrack === '1' || (window as { doNotTrack?: string }).doNotTrack === '1', false),
    gpu: probe(gpu, null),
    prefers: {
      scheme: mq('(prefers-color-scheme: dark)') ? 'dark' : mq('(prefers-color-scheme: light)') ? 'light' : 'none',
      reducedMotion: mq('(prefers-reduced-motion: reduce)'),
      contrast: mq('(prefers-contrast: more)')
        ? 'more'
        : mq('(prefers-contrast: less)')
          ? 'less'
          : mq('(prefers-contrast: custom)')
            ? 'custom'
            : 'none',
      forcedColors: mq('(forced-colors: active)'),
      invertedColors: mq('(inverted-colors: inverted)'),
      reducedTransparency: mq('(prefers-reduced-transparency: reduce)'),
    },
    screen: {
      availW: probe(() => screen.availWidth, 0),
      availH: probe(() => screen.availHeight, 0),
      colorDepth: probe(() => screen.colorDepth, 0),
      orientation,
    },
    memory: probe((): EnvP['memory'] => {
      const m = (performance as Performance & { memory?: PerfMemory }).memory
      return m ? { limitMb: mb(m.jsHeapSizeLimit), usedMb: mb(m.usedJSHeapSize) } : null
    }, null),
    net,
    tz: {
      name: str(resolved?.timeZone, 60),
      offsetMin: probe(() => Math.max(-900, Math.min(900, -new Date().getTimezoneOffset())), 0),
    },
    locale: str(resolved?.locale, 20) || probe(() => nav.language, ''),
    display: display(),
    outer: { w: probe(() => outerWidth, 0), h: probe(() => outerHeight, 0) },
    inner: { w: probe(() => innerWidth, 0), h: probe(() => innerHeight, 0) },
    deviceMemory: probe(() => (typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null), null),
    cores: probe(() => (typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null), null),
    platform: str(ua?.platform, 40) || probe(() => nav.platform, ''),
    touch: probe(() => nav.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches, false),
  }

  const results = (await asyncProbes) ?? [null, null, null, null, null, null]
  const [hi, gpuAdapter, bat, sto, med, voiceCount] = results
  return {
    ...sync,
    uadHi: hi ?? null,
    webgpu: gpuAdapter ?? null,
    battery: bat ?? null,
    storage: sto ?? null,
    media: med ?? null,
    voices: voiceCount ?? null,
  }
}
