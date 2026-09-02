import type { MaybeRefOrGetter, Ref } from 'vue'

/**
 * Data fetching for the /ops console.
 *
 * - Request-sequence guard (audit A25): every call to `refresh()` takes a
 *   ticket; a response is only committed when its ticket is still the newest,
 *   so a slow 24H response can never land on top of the ALL response that
 *   was requested after it. Covers data, error AND status.
 * - 401 → `/ops/login` (audit A45): an expired cookie sends the console back
 *   to the login page instead of showing LINK FAULT every poll.
 * - `useFetch`-shaped surface: `{ data, status, error, refresh }`.
 *
 * Built on `$fetch` rather than `useFetch` so the guard is explicit; the ops
 * routes render client-only (`ssr: false`), so there is no payload to hydrate.
 */

export type OpsFetchStatus = 'idle' | 'pending' | 'success' | 'error'

export interface OpsFetchError {
  statusCode: number | null
  message: string
}

export interface OpsFetchOptions<T> {
  query?: MaybeRefOrGetter<Record<string, unknown> | undefined>
  method?: 'GET' | 'POST'
  body?: MaybeRefOrGetter<unknown>
  headers?: Record<string, string>
  /** Fetch on creation (client only). Default true. */
  immediate?: boolean
  /** Refetch when `url` / `query` / `body` change. Default true. */
  watch?: boolean
  transform?: (raw: unknown) => T
}

export interface OpsFetchResult<T> {
  data: Ref<T | null>
  status: Ref<OpsFetchStatus>
  error: Ref<OpsFetchError | null>
  pending: Ref<boolean>
  refresh: () => Promise<void>
}

/** HTTP status from an ofetch / fetch error, or null. */
export function errorStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { statusCode?: unknown; status?: unknown; response?: { status?: unknown } }
  const s = e.statusCode ?? e.status ?? e.response?.status
  return typeof s === 'number' ? s : null
}

/** Error text: the API's `{ error }` / `statusMessage` when present, else the message. */
export function errorText(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err ?? 'unknown')
  const e = err as { data?: { error?: unknown; statusMessage?: unknown; message?: unknown }; statusMessage?: unknown; message?: unknown }
  const d = e.data
  const cand = [d?.error, d?.statusMessage, d?.message, e.statusMessage, e.message]
  for (const c of cand) if (typeof c === 'string' && c) return c
  return 'unknown'
}

export function isUnauthorized(err: unknown): boolean {
  return errorStatus(err) === 401
}

/** Send the console back to the login page once (no-op when already there). */
export function redirectToLogin(): void {
  if (!import.meta.client) return
  if (window.location.pathname === '/ops/login') return
  void navigateTo('/ops/login')
}

/** The canonical `LINK FAULT // 503 OVERVIEW UNAVAILABLE` string for a failed block. */
export function opsFault(err: OpsFetchError | null | undefined, what: string): string {
  const code = err?.statusCode ? `${err.statusCode} ` : ''
  return `LINK FAULT // ${code}${what.toUpperCase()} UNAVAILABLE`
}

function toError(err: unknown): OpsFetchError {
  return { statusCode: errorStatus(err), message: errorText(err) }
}

/**
 * One-shot fetch with the same 401 handling (click handlers, LOAD MORE,
 * console runs). Throws the normalised `OpsFetchError` on failure; on 401 it
 * redirects first and then throws so callers can bail out.
 */
export async function opsFetch<T>(
  url: string,
  opts: { query?: Record<string, unknown>; method?: 'GET' | 'POST'; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  try {
    // `url` is a plain string, so ofetch's per-route typing does not apply.
    return (await $fetch(url, {
      method: opts.method ?? 'GET',
      query: opts.query,
      body: opts.body as Record<string, unknown> | undefined,
      headers: opts.headers,
    })) as T
  } catch (err) {
    if (isUnauthorized(err)) redirectToLogin()
    throw toError(err)
  }
}

export function useOpsFetch<T>(url: MaybeRefOrGetter<string>, opts: OpsFetchOptions<T> = {}): OpsFetchResult<T> {
  const data = ref<T | null>(null) as Ref<T | null>
  const status = ref<OpsFetchStatus>('idle')
  const error = ref<OpsFetchError | null>(null)
  const pending = computed(() => status.value === 'pending')

  let latest = 0
  let lastKey = ''

  function requestKey(): string {
    try {
      return JSON.stringify([toValue(url), toValue(opts.query) ?? null, toValue(opts.body) ?? null])
    } catch {
      return String(Date.now())
    }
  }

  async function refresh(): Promise<void> {
    if (!import.meta.client) return
    const seq = ++latest
    lastKey = requestKey()
    status.value = 'pending'
    try {
      const target: string = toValue(url)
      const raw: unknown = await $fetch(target, {
        method: opts.method ?? 'GET',
        query: toValue(opts.query),
        body: toValue(opts.body) as Record<string, unknown> | undefined,
        headers: opts.headers,
      })
      if (seq !== latest) return
      data.value = (opts.transform ? opts.transform(raw) : raw) as T
      error.value = null
      status.value = 'success'
    } catch (err) {
      if (seq !== latest) return
      if (isUnauthorized(err)) {
        redirectToLogin()
        return
      }
      error.value = toError(err)
      status.value = 'error'
    }
  }

  if (opts.watch !== false) {
    // Deep watch, but only refetch when the request actually changed — a
    // rebuilt-but-equal query object (every filter change rebuilds the state)
    // must not hammer the endpoint.
    watch(
      () => [toValue(url), toValue(opts.query), toValue(opts.body)],
      () => {
        if (requestKey() === lastKey) return
        void refresh()
      },
      { deep: true },
    )
  }

  if (opts.immediate !== false && import.meta.client) void refresh()

  return { data, status, error, pending, refresh }
}
