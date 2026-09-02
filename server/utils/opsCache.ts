// server/utils/opsCache.ts — 30 s per-isolate response cache for the /ops
// aggregate routes (contract §D): keyed by the full request URL, LRU capped
// at 200 entries. Never used for live / sessions / detail / events /
// visitors detail / sql / export. Errors are not cached.

import type { H3Event } from 'h3'
import { getRequestURL, setHeader } from 'h3'

interface Entry {
  exp: number
  value: unknown
}

export const OPS_CACHE_TTL_MS = 30_000
export const OPS_CACHE_MAX = 200

const store = new Map<string, Entry>()

export function opsCacheKey(event: H3Event): string {
  const u = getRequestURL(event)
  return `${u.pathname}${u.search}`
}

/** Serve `fn()`'s value from the isolate cache for `ttlMs`; sets `x-rb-cache: hit|miss`. */
export async function opsCached<T>(event: H3Event, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const key = opsCacheKey(event)
  const now = Date.now()
  const hit = store.get(key)
  if (hit && hit.exp > now) {
    store.delete(key)
    store.set(key, hit) // refresh LRU position
    setHeader(event, 'x-rb-cache', 'hit')
    return hit.value as T
  }
  const value = await fn()
  // Re-setting an existing key keeps its ORIGINAL insertion position, so a
  // busy-but-refreshed entry would be evicted first. Delete, then set (R4-L1).
  store.delete(key)
  store.set(key, { exp: now + ttlMs, value })
  while (store.size > OPS_CACHE_MAX) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
  setHeader(event, 'x-rb-cache', 'miss')
  return value
}
