// rrweb session replay (plan deltas A0 / A14 / A40, contract §I): a sampled
// recording started after `load` in an idle callback, chunk-uploaded to
// /api/replay (gzipped when CompressionStream exists), capped at 10 minutes or
// 5 MB compressed. Every document load is its own recording (`rid`), the
// sampling decision is persisted per sid in `rb_rr`, and a chunk that fails
// its bounded retry is reported as `replay_chunk_lost`. Every path is
// silent-fail — replay must never break the page.
import type { eventWithTime } from 'rrweb'
import type { Track } from './core'

export interface ReplayOptions {
  /** Current session id (mutable, A5) — sent as `x-rb-sid` with every chunk. */
  getSid: () => string
  /** 0..1 chance a *session* gets recorded (public.replaySampleRate). */
  sampleRate: number
  /** Persisted per-sid decision (`rb_rr` cookie) so a reload / second tab never re-rolls. */
  decision: () => '1' | '0' | null
  setDecision: (v: '1' | '0') => void
  /** Resolves once /api/collect acknowledged this sid (the `rb_rt` upload token exists then). */
  whenAcked: () => Promise<void>
  isAcked: () => boolean
  track: Track
}

export interface ReplayControl {
  /** Best-effort tail upload on pagehide; an unsendable tail is kept for a bfcache restore. */
  flushTail: () => void
}

const REPLAY_URL = '/api/replay'
const UPLOAD_INTERVAL_MS = 10_000
const CHUNK_TRIGGER_BYTES = 500 * 1024
/** While an upload waits on the collect ack the buffer keeps growing; stop before it hurts. */
const MAX_BUFFER_BYTES = 4 * 1024 * 1024
const MAX_RECORD_MS = 10 * 60 * 1000
const MAX_COMPRESSED_BYTES = 5 * 1024 * 1024
/** fetch keepalive bodies are quota-limited to 64 KiB — stay under it. */
const KEEPALIVE_LIMIT_BYTES = 60 * 1024
const ACK_WAIT_MS = 30_000
const RETRY_DELAY_MS = 1_000
/** Retries per document load, across all chunks. */
const MAX_RETRIES = 5

async function gzip(json: string): Promise<ArrayBuffer | null> {
  if (typeof CompressionStream === 'undefined') return null
  try {
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))
    return await new Response(stream).arrayBuffer()
  } catch {
    return null
  }
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function setupReplay(opts: ReplayOptions): ReplayControl {
  const rid = crypto.randomUUID()
  const pageStartedAt = String(Math.round(performance.timeOrigin || Date.now()))
  let buffer: eventWithTime[] = []
  let approxBytes = 0
  let seq = 0
  let compressedSent = 0
  let retries = 0
  let stopFn: (() => void) | undefined
  let uploadTimer: number | undefined
  let capTimer: number | undefined
  let inflight = 0
  let stopped = false

  /** Drain the buffer, or null when empty. */
  const takeBuffer = (): eventWithTime[] | null => {
    if (buffer.length === 0) return null
    const events = buffer
    buffer = []
    approxBytes = 0
    return events
  }

  const restore = (events: eventWithTime[]): void => {
    buffer = events.concat(buffer)
    approxBytes += events.length * 64
  }

  const send = (body: BodyInit, chunkSeq: number, gz: '0' | '1', keepalive: boolean): Promise<Response> =>
    fetch(REPLAY_URL, {
      method: 'POST',
      keepalive,
      headers: {
        'content-type': 'application/octet-stream',
        'x-rb-sid': opts.getSid(),
        'x-rb-rid': rid,
        'x-rb-seq': String(chunkSeq),
        'x-rb-gz': gz,
        'x-rb-ps': pageStartedAt,
      },
      body,
    })

  /** One attempt plus a bounded retry; a chunk lost after that is reported (A14). */
  const deliver = async (body: BodyInit, chunkSeq: number, gz: '0' | '1'): Promise<void> => {
    let status: number | null = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await send(body, chunkSeq, gz, false)
        status = res.status
        if (res.ok) return
        // Deterministic rejections never succeed on retry.
        if (status === 400 || status === 413) break
      } catch {
        status = null
      }
      if (attempt === 0 && retries < MAX_RETRIES) {
        retries++
        await delay(RETRY_DELAY_MS)
      } else {
        break
      }
    }
    opts.track('replay_chunk_lost', null, { seq: chunkSeq, rid, status })
  }

  const upload = async (): Promise<void> => {
    if (inflight > 0) return
    const events = takeBuffer()
    if (events === null) return
    inflight++
    try {
      // The upload token cookie is set by /api/collect: never race the first flush.
      await Promise.race([opts.whenAcked(), delay(ACK_WAIT_MS)])
      const chunkSeq = seq++
      const json = JSON.stringify(events)
      const gzipped = await gzip(json)
      if (gzipped) {
        compressedSent += gzipped.byteLength
        await deliver(gzipped, chunkSeq, '1')
      } else {
        await deliver(json, chunkSeq, '0')
      }
      if (compressedSent >= MAX_COMPRESSED_BYTES) stop('cap')
    } catch {
      /* dropped chunk — replay is best-effort */
    } finally {
      inflight--
      // A40: a stop() that landed during this upload must still drain the tail.
      if (stopped && buffer.length > 0 && inflight === 0) void upload()
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
    // Drain what is still buffered; deferred so an in-flight upload (which
    // may be what tripped the byte cap) has released its lock.
    window.setTimeout(() => void upload(), 0)
  }

  /** One roll per sid (A0): a persisted `rb_rr` wins; a rate of 0 never records, whatever the cookie says. */
  const decide = (): boolean => {
    if (!(opts.sampleRate > 0)) return false
    const d = opts.decision()
    if (d === '1') return true
    if (d === '0') return false
    const on = Math.random() < opts.sampleRate
    opts.setDecision(on ? '1' : '0')
    return on
  }

  const start = async (): Promise<void> => {
    try {
      if (!decide()) return
      // Dynamic import so rrweb code-splits into its own lazy chunk.
      const rrweb = await import('rrweb')
      stopFn = rrweb.record({
        emit(event) {
          if (stopped) return
          buffer.push(event)
          approxBytes += JSON.stringify(event).length
          if (approxBytes > MAX_BUFFER_BYTES) stop('backlog')
          else if (approxBytes > CHUNK_TRIGGER_BYTES) void upload()
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
      if (buffer.length === 0) return
      // Without the collect ack the upload token does not exist yet; keep the
      // tail for a possible bfcache restore instead of burning a seq on a 401.
      if (!opts.isAcked()) return
      const events = takeBuffer()
      if (events === null) return
      const json = JSON.stringify(events)
      inflight++
      const done = (): void => {
        inflight--
        if (stopped && buffer.length > 0 && inflight === 0) void upload()
      }
      if (typeof CompressionStream !== 'undefined') {
        // Opportunistic: gzip is async, so if the page dies before the
        // promise settles the tail is lost — acceptable by design.
        void gzip(json)
          .then((gzipped) => {
            if (!gzipped || gzipped.byteLength >= KEEPALIVE_LIMIT_BYTES) {
              restore(events) // A13: nothing was sent — keep the events, keep the seq
              return
            }
            return send(gzipped, seq++, '1', true)
          })
          .catch(() => {})
          .finally(done)
      } else if (json.length < KEEPALIVE_LIMIT_BYTES) {
        void send(json, seq++, '0', true).catch(() => {}).finally(done)
      } else {
        restore(events)
        done()
      }
    } catch {
      /* ignore */
    }
  }

  return { flushTail }
}
