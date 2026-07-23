import type { eventWithTime } from 'rrweb'

type TrackFn = (type: string, name?: string | null, p?: Record<string, unknown>) => void

export interface ReplayOptions {
  /** Session id — sent as x-rb-sid with every chunk. */
  sid: string
  /** 0..1 chance this session gets recorded (public.replaySampleRate). */
  sampleRate: number
  /** Queue an analytics event (used for replay_stopped). */
  track: TrackFn
}

export interface ReplayControl {
  /** Best-effort tail upload on pagehide; losing the tail is acceptable. */
  flushTail: () => void
}

const REPLAY_URL = '/api/replay'
const UPLOAD_INTERVAL_MS = 10_000
const CHUNK_TRIGGER_BYTES = 500 * 1024
const MAX_RECORD_MS = 10 * 60 * 1000
const MAX_COMPRESSED_BYTES = 5 * 1024 * 1024
/** fetch keepalive bodies are quota-limited to 64 KiB — stay under it. */
const KEEPALIVE_LIMIT_BYTES = 60 * 1024

async function gzip(json: string): Promise<ArrayBuffer | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
    return await new Response(stream).arrayBuffer()
  } catch {
    return null
  }
}

/**
 * rrweb session replay: sampled recording started after window load in
 * an idle callback, chunk-uploaded to /api/replay (gzipped when
 * CompressionStream exists), capped at 10 minutes or 5 MB compressed.
 * Every path is silent-fail — replay must never break the page.
 */
export function setupReplay(opts: ReplayOptions): ReplayControl {
  let buffer: eventWithTime[] = []
  let approxBytes = 0
  let seq = 0
  let compressedSent = 0
  let stopFn: (() => void) | undefined
  let uploadTimer: number | undefined
  let capTimer: number | undefined
  let uploading = false
  let stopped = false

  /** Drain the buffer to a JSON array string, or null when empty. */
  const takeBuffer = (): string | null => {
    if (buffer.length === 0) return null
    const events = buffer
    buffer = []
    approxBytes = 0
    return JSON.stringify(events)
  }

  const send = (body: BodyInit, chunkSeq: number, gz: '0' | '1', size: number): Promise<Response> =>
    fetch(REPLAY_URL, {
      method: 'POST',
      keepalive: size < KEEPALIVE_LIMIT_BYTES,
      headers: {
        'content-type': 'application/octet-stream',
        'x-rb-sid': opts.sid,
        'x-rb-seq': String(chunkSeq),
        'x-rb-gz': gz,
      },
      body,
    })

  const upload = async (): Promise<void> => {
    if (uploading) return
    const json = takeBuffer()
    if (json === null) return
    uploading = true
    try {
      const chunkSeq = seq++
      const gzipped = await gzip(json)
      if (gzipped) {
        compressedSent += gzipped.byteLength
        await send(gzipped, chunkSeq, '1', gzipped.byteLength)
      } else {
        await send(json, chunkSeq, '0', json.length)
      }
      if (compressedSent >= MAX_COMPRESSED_BYTES) stop('cap')
    } catch {
      /* dropped chunk — replay is best-effort */
    } finally {
      uploading = false
    }
  }

  const stop = (reason: string): void => {
    if (stopped) return
    stopped = true
    if (uploadTimer !== undefined) clearInterval(uploadTimer)
    if (capTimer !== undefined) clearTimeout(capTimer)
    try {
      stopFn?.()
    } catch {
      /* ignore */
    }
    opts.track('replay_stopped', null, { reason })
    // Drain what is still buffered; deferred so an in-flight upload
    // (which may be what tripped the byte cap) has released its lock.
    window.setTimeout(() => void upload(), 0)
  }

  const start = async (): Promise<void> => {
    try {
      if (Math.random() >= opts.sampleRate) return
      // Dynamic import so rrweb code-splits into its own lazy chunk.
      const rrweb = await import('rrweb')
      stopFn = rrweb.record({
        emit(event) {
          if (stopped) return
          buffer.push(event)
          approxBytes += JSON.stringify(event).length
          if (approxBytes > CHUNK_TRIGGER_BYTES) void upload()
        },
        maskAllInputs: true,
        slimDOMOptions: 'all',
        sampling: { scroll: 150, media: 800, input: 'last' },
        checkoutEveryNms: 60_000,
        blockClass: 'rr-block',
        inlineStylesheet: true,
      })
      if (!stopFn) return
      uploadTimer = window.setInterval(() => void upload(), UPLOAD_INTERVAL_MS)
      capTimer = window.setTimeout(() => stop('cap'), MAX_RECORD_MS)
    } catch {
      /* replay is optional — never let it break the page */
    }
  }

  const schedule = (): void => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => void start())
    } else {
      window.setTimeout(() => void start(), 3000)
    }
  }

  try {
    if (opts.sampleRate > 0) {
      if (document.readyState === 'complete') schedule()
      else window.addEventListener('load', schedule, { once: true })
    }
  } catch {
    /* ignore */
  }

  const flushTail = (): void => {
    try {
      const json = takeBuffer()
      if (json === null) return
      const chunkSeq = seq++
      if (typeof CompressionStream !== 'undefined') {
        // Opportunistic: gzip is async, so if the page dies before the
        // promise settles the tail is lost — acceptable by design.
        void gzip(json)
          .then((gzipped) => {
            if (!gzipped || gzipped.byteLength >= KEEPALIVE_LIMIT_BYTES) return
            return send(gzipped, chunkSeq, '1', gzipped.byteLength)
          })
          .catch(() => {})
      } else if (json.length < KEEPALIVE_LIMIT_BYTES) {
        void send(json, chunkSeq, '0', json.length).catch(() => {})
      }
    } catch {
      /* ignore */
    }
  }

  return { flushTail }
}
